// Algorithm 1 orchestrator (M3): ρ → σ → ι → ε → κ as an async generator
// yielding LearnEvents. ProposalBundle handles prompt + memory ops together.

import { nanoid } from "nanoid";
import { getDb } from "@/src/storage/db";
import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { AgentPolicyRegistry } from "@/src/rspl/registries/agent";
import { ToolRegistry, type ToolImpl } from "@/src/rspl/registries/tool";
import type { AllowlistKey } from "@/src/rspl/registries/tool";
import { MemoryRegistry, type MemoryImpl } from "@/src/rspl/registries/memory";
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

function loadMemories(agentId: string) {
  return MemoryRegistry.listMemories(agentId).map((m) => {
    const impl = m.impl as MemoryImpl;
    return { id: m.id, content: impl.content, tags: impl.tags };
  });
}

function loadEvoState(
  agentId: string,
  memories: Array<{ id: string; content: string; tags: string[] }>,
): EvoState {
  const policy = AgentPolicyRegistry.getPolicy(agentId);
  const tools = ToolRegistry.listTools(agentId);
  return {
    systemPrompt: PromptRegistry.getSystemPrompt(agentId),
    replyStyle: policy.replyStyle,
    toolRefs: tools.map((t) => (t.impl as ToolImpl).implementationRef as AllowlistKey),
    memories: memories.map((m) => ({ content: m.content, tags: m.tags })),
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

  const baselineMemories = loadMemories(agentId);
  const baseline = loadEvoState(agentId, baselineMemories);
  const learnRunId = insertLearnRun(agentId, input.sessionId);
  yield { type: "start", learnRunId, sessionId: input.sessionId, agentId };

  try {
    // --- Reflect ------------------------------------------------------------
    yield { type: "reflect.begin" };
    const hypotheses = await reflect({
      systemPrompt: baseline.systemPrompt,
      memories: baselineMemories,
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
    const bundle = await select({
      systemPrompt: baseline.systemPrompt,
      memories: baselineMemories,
      hypotheses,
    });
    if (bundle.updatePrompt) {
      yield { type: "select.proposal", proposal: bundle.updatePrompt };
    }
    for (const op of bundle.memoryOps) {
      yield { type: "select.proposal", proposal: op };
    }
    yield {
      type: "select.end",
      promptChanged: !!bundle.updatePrompt,
      memoryOpCount: bundle.memoryOps.length,
    };
    persistLearnRun(learnRunId, {
      proposals: [
        ...(bundle.updatePrompt ? [bundle.updatePrompt] : []),
        ...bundle.memoryOps,
      ],
    });

    const hasChanges = !!bundle.updatePrompt || bundle.memoryOps.length > 0;
    if (!hasChanges) {
      yield {
        type: "commit.decision",
        committed: false,
        reason: "select produced no changes",
      };
      persistLearnRun(learnRunId, { status: "completed", commit_decisions: [] });
      markSessionLearned(input.sessionId);
      yield { type: "done" };
      return;
    }

    // --- Improve ------------------------------------------------------------
    yield { type: "improve.begin" };
    const preview = improve(baseline, bundle, baselineMemories);
    if (bundle.updatePrompt) {
      yield {
        type: "improve.promptDiff",
        before: baseline.systemPrompt,
        after: preview.candidate.systemPrompt,
      };
    }
    for (const ch of preview.memoryChanges) {
      yield {
        type: "improve.memoryOp",
        op: ch.op,
        memoryId: ch.memoryId,
        before: ch.before,
        after: ch.after,
      };
    }
    yield { type: "improve.end" };

    // --- Evaluate -----------------------------------------------------------
    yield { type: "evaluate.begin" };
    yield { type: "evaluate.progress", stage: "rule_gates" };
    yield {
      type: "evaluate.progress",
      stage: "judge_replay",
      note: `replaying ${trace.turns.length} turns, 3 votes each`,
    };
    const evalResult = await evaluate(trace, baseline, preview.candidate, {
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
    const commitResult = await commit({
      agentId,
      learnRunId,
      commit: evalResult.commit,
      bundle,
    });
    yield {
      type: "commit.decision",
      committed: commitResult.committed,
      newVersion: commitResult.promptVersion,
      reason: evalResult.reason,
    };
    persistLearnRun(learnRunId, {
      status: "completed",
      commit_decisions: [
        {
          committed: commitResult.committed,
          promptVersion: commitResult.promptVersion,
          memoryOps: commitResult.memoryOps,
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
