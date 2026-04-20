// Algorithm 1 orchestrator: ρ → σ → ι → ε → κ as an async generator yielding
// LearnEvents. The API route consumes this and streams the events as SSE.

import { nanoid } from "nanoid";
import { getDb } from "@/src/storage/db";
import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { AgentPolicyRegistry } from "@/src/rspl/registries/agent";
import { ToolRegistry, type ToolImpl } from "@/src/rspl/registries/tool";
import type { AllowlistKey } from "@/src/rspl/registries/tool";
import { reflect } from "./reflect";
import { select } from "./select";
import { improve } from "./improve";
import { evaluate, type EvoState, type CannedTrace } from "./evaluate";
import { commit } from "./commit";
import type { LearnEvent } from "./types";

export interface LearnInput {
  sessionId: string;
}

interface SessionRow {
  id: string;
  agent_id: string;
  status: string;
}

interface TurnRow {
  user_message: string;
  assistant_message: string;
}

function loadSession(sessionId: string): SessionRow {
  const row = getDb()
    .prepare<[string], SessionRow>(
      `SELECT id, agent_id, status FROM sessions WHERE id = ?`,
    )
    .get(sessionId);
  if (!row) throw new Error(`session ${sessionId} not found`);
  return row;
}

function loadTrace(sessionId: string): CannedTrace {
  const rows = getDb()
    .prepare<[string], TurnRow>(
      `SELECT user_message, assistant_message FROM turns
       WHERE session_id = ? ORDER BY idx ASC`,
    )
    .all(sessionId);
  return {
    id: sessionId,
    description: `live session ${sessionId}`,
    turns: rows
      .filter((r) => r.assistant_message?.length > 0)
      .map((r) => ({ user: r.user_message, assistant: r.assistant_message })),
  };
}

function loadEvoState(agentId: string): EvoState {
  const policy = AgentPolicyRegistry.getPolicy(agentId);
  const tools = ToolRegistry.listTools(agentId);
  return {
    systemPrompt: PromptRegistry.getSystemPrompt(agentId),
    replyStyle: policy.replyStyle,
    toolRefs: tools.map((t) => (t.impl as ToolImpl).implementationRef as AllowlistKey),
    memories: [], // M2 ignores memory; M3 loads real entries here.
  };
}

function markSessionLearned(sessionId: string): void {
  getDb()
    .prepare(`UPDATE sessions SET status = 'learned' WHERE id = ?`)
    .run(sessionId);
}

function insertLearnRun(agentId: string, sessionId: string): string {
  const id = `lrn_${nanoid(12)}`;
  getDb()
    .prepare(
      `INSERT INTO learn_runs (id, agent_id, session_id, status) VALUES (?, ?, ?, 'running')`,
    )
    .run(id, agentId, sessionId);
  return id;
}

function persistLearnRun(
  learnRunId: string,
  patch: {
    status?: "completed" | "failed";
    hypotheses?: unknown;
    proposals?: unknown;
    evaluation?: unknown;
    commit_decisions?: unknown;
  },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    params.push(typeof v === "string" ? v : JSON.stringify(v));
  }
  if (patch.status === "completed" || patch.status === "failed") {
    sets.push(`completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  }
  params.push(learnRunId);
  getDb()
    .prepare(`UPDATE learn_runs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...(params as [string | number | null]));
}

export async function* runLearnLoop(input: LearnInput): AsyncGenerator<LearnEvent> {
  const session = loadSession(input.sessionId);
  if (session.status === "learned") {
    yield { type: "error", message: "session has already been learned from" };
    return;
  }
  if (session.status === "open") {
    yield { type: "error", message: "session is still open; end it before learning" };
    return;
  }

  const agentId = session.agent_id;
  const trace = loadTrace(input.sessionId);
  if (trace.turns.length === 0) {
    yield { type: "error", message: "session has no completed turns to learn from" };
    return;
  }

  const baseline = loadEvoState(agentId);
  const learnRunId = insertLearnRun(agentId, input.sessionId);
  yield { type: "start", learnRunId, sessionId: input.sessionId, agentId };

  try {
    // --- Reflect ------------------------------------------------------------
    yield { type: "reflect.begin" };
    const hypotheses = await reflect({
      systemPrompt: baseline.systemPrompt,
      trace: trace.turns,
    });
    for (const h of hypotheses) yield { type: "reflect.hypothesis", hypothesis: h };
    yield { type: "reflect.end", count: hypotheses.length };
    persistLearnRun(learnRunId, { hypotheses });

    if (hypotheses.length === 0) {
      yield {
        type: "commit.decision",
        committed: false,
        reason: "no hypotheses — agent is already performing well",
      };
      persistLearnRun(learnRunId, { status: "completed", commit_decisions: [] });
      markSessionLearned(input.sessionId);
      yield { type: "done" };
      return;
    }

    // --- Select -------------------------------------------------------------
    yield { type: "select.begin" };
    const proposal = await select({
      systemPrompt: baseline.systemPrompt,
      hypotheses,
    });
    yield { type: "select.proposal", proposal };
    yield { type: "select.end" };
    persistLearnRun(learnRunId, { proposals: [proposal] });

    // --- Improve ------------------------------------------------------------
    yield { type: "improve.begin" };
    const candidate = improve(baseline, proposal);
    yield {
      type: "improve.diff",
      before: baseline.systemPrompt,
      after: candidate.systemPrompt,
    };
    yield { type: "improve.end" };

    // --- Evaluate -----------------------------------------------------------
    yield { type: "evaluate.begin" };
    yield { type: "evaluate.progress", stage: "rule_gates" };
    yield { type: "evaluate.progress", stage: "judge_replay", note: `replaying ${trace.turns.length} turns, 3 votes each` };
    const evalResult = await evaluate(trace, baseline, candidate, {
      runSeed: 0,
      votesPerTurn: 3,
    });
    const evalAggregate =
      evalResult.judge?.aggregate ??
      (evalResult.ruleGates.passed ? "equivalent" : "rule_gate_fail");
    yield {
      type: "evaluate.complete",
      ruleGatesPassed: evalResult.ruleGates.passed,
      aggregate: evalAggregate,
      commit: evalResult.commit,
      reason: evalResult.reason,
    };
    persistLearnRun(learnRunId, { evaluation: evalResult });

    // --- Commit -------------------------------------------------------------
    yield { type: "commit.begin" };
    const commitResult = commit({
      agentId,
      learnRunId,
      commit: evalResult.commit,
      newPromptText: proposal.newPromptText,
    });
    yield {
      type: "commit.decision",
      committed: commitResult.committed,
      newVersion: commitResult.newVersion,
      reason: evalResult.reason,
    };
    persistLearnRun(learnRunId, {
      status: "completed",
      commit_decisions: [
        {
          proposal: proposal.type,
          committed: commitResult.committed,
          newVersion: commitResult.newVersion,
          reason: evalResult.reason,
        },
      ],
    });
    markSessionLearned(input.sessionId);
    yield { type: "done" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    persistLearnRun(learnRunId, { status: "failed", evaluation: { error: message } });
    yield { type: "error", message };
  }
}
