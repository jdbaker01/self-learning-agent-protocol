// One-turn chat executor. Loads the agent's head resources, runs the turn via
// the Vercel ai SDK with tool-use, streams the assistant reply, records trace.

import { nanoid } from "nanoid";
import { streamText, tool, stepCountIs } from "ai";
import { jsonSchema } from "ai";
import { getDb, withTx } from "@/src/storage/db";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { AgentPolicyRegistry } from "@/src/rspl/registries/agent";
import { ToolRegistry, ALLOWLIST, type ToolImpl } from "@/src/rspl/registries/tool";
import { Tracer, type ToolCallTrace, type TurnTrace } from "@/src/rspl/infra/tracer";

export interface ChatTurnInput {
  sessionId: string;
  userMessage: string;
}

export function createSession(agentId: string): { sessionId: string } {
  const sessionId = `ses_${nanoid(12)}`;
  getDb()
    .prepare(`INSERT INTO sessions (id, agent_id, status) VALUES (?, ?, 'open')`)
    .run(sessionId, agentId);
  return { sessionId };
}

export function endSession(sessionId: string): void {
  getDb()
    .prepare(
      `UPDATE sessions SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
    .run(sessionId);
}

export function getSession(sessionId: string) {
  return getDb()
    .prepare<[string], { id: string; agent_id: string; status: string }>(
      `SELECT id, agent_id, status FROM sessions WHERE id = ?`,
    )
    .get(sessionId);
}

export function getSessionHistory(sessionId: string): Array<{ role: "user" | "assistant"; content: string }> {
  const db = getDb();
  type Row = { user_message: string; assistant_message: string };
  const rows = db
    .prepare<[string], Row>(
      `SELECT user_message, assistant_message FROM turns
       WHERE session_id = ? ORDER BY idx ASC`,
    )
    .all(sessionId);
  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const r of rows) {
    msgs.push({ role: "user", content: r.user_message });
    if (r.assistant_message) msgs.push({ role: "assistant", content: r.assistant_message });
  }
  return msgs;
}

/**
 * Run one chat turn, returning a streaming response that the caller can pipe
 * to the client. Records the trace after the stream finishes (onFinish).
 */
export function runChatTurn(input: ChatTurnInput) {
  const session = getSession(input.sessionId);
  if (!session) throw new Error(`session ${input.sessionId} not found`);
  if (session.status !== "open") throw new Error(`session ${input.sessionId} is ${session.status}`);
  const agentId = session.agent_id;

  const systemPrompt = PromptRegistry.getSystemPrompt(agentId);
  const policy = AgentPolicyRegistry.getPolicy(agentId);
  const tools = ToolRegistry.listTools(agentId);

  // Snapshot the resource versions used by this turn (for auditability).
  const resourceVersions: Record<string, string> = {};
  const promptRec = PromptRegistry.get(agentId, "system");
  if (promptRec) resourceVersions[`prompt:${promptRec.name}`] = promptRec.version;
  const policyRec = AgentPolicyRegistry.get(agentId, "policy");
  if (policyRec) resourceVersions[`agent_policy:${policyRec.name}`] = policyRec.version;
  for (const t of tools) resourceVersions[`tool:${t.name}`] = t.version;

  // Build ai-SDK tool descriptors from the current RSPL tool set.
  const toolCallLog: ToolCallTrace[] = [];
  const aiTools = Object.fromEntries(
    tools.map((t) => {
      const impl = t.impl as ToolImpl;
      const entry = ALLOWLIST[impl.implementationRef];
      return [
        t.name,
        tool({
          description: t.description || entry.description,
          inputSchema: jsonSchema(impl.argsSchema as Record<string, unknown>),
          execute: async (args: unknown) => {
            const t0 = Date.now();
            try {
              const result = await ToolRegistry.run(agentId, t.name, args as Record<string, unknown>);
              toolCallLog.push({
                toolName: t.name,
                args,
                result,
                latencyMs: Date.now() - t0,
              });
              return result;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              toolCallLog.push({
                toolName: t.name,
                args,
                error: msg,
                latencyMs: Date.now() - t0,
              });
              return { error: msg };
            }
          },
        }),
      ];
    }),
  );

  // Persist the turn row up-front so we have an id to attach the trace to.
  const turnId = `trn_${nanoid(12)}`;
  const turnIdx = withTx((db) => {
    const { cnt } = db
      .prepare<[string], { cnt: number }>(`SELECT COUNT(*) AS cnt FROM turns WHERE session_id = ?`)
      .get(input.sessionId) ?? { cnt: 0 };
    db.prepare(
      `INSERT INTO turns (id, session_id, idx, user_message) VALUES (?, ?, ?, ?)`,
    ).run(turnId, input.sessionId, cnt, input.userMessage);
    return cnt;
  });

  const history = getSessionHistory(input.sessionId).slice(0, -0); // current turn not yet appended
  // drop the turn we just inserted (content empty)
  const prior = history;

  const effectiveSystem = `${systemPrompt}\n\n# Reply style\n${policy.replyStyle}`;
  const t0 = Date.now();

  const result = streamText({
    model: ModelManager.forTier(policy.modelTier),
    system: effectiveSystem,
    messages: [
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: input.userMessage },
    ],
    tools: aiTools,
    toolChoice: policy.toolChoice,
    stopWhen: stepCountIs(Math.max(1, policy.maxSteps)),
    onFinish: async ({ text, finishReason }) => {
      const latencyMs = Date.now() - t0;
      getDb()
        .prepare(`UPDATE turns SET assistant_message = ? WHERE id = ?`)
        .run(text, turnId);
      const trace: TurnTrace = {
        agentId,
        sessionId: input.sessionId,
        turnId,
        modelId: ModelManager.modelIdForTier(policy.modelTier),
        userMessage: input.userMessage,
        assistantMessage: text,
        toolCalls: toolCallLog,
        latencyMs,
        errors: finishReason === "error" ? ["finishReason=error"] : [],
        resourceVersions,
      };
      Tracer.record(trace);
    },
  });

  return { turnId, turnIdx, result };
}
