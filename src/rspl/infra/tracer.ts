// Tracer (paper §3.1.4). Records per-turn execution traces — the observational
// trace Z that SEPL's Reflect operator consumes.

import { nanoid } from "nanoid";
import { getDb } from "@/src/storage/db";

export interface ToolCallTrace {
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
  latencyMs: number;
}

export interface TurnTrace {
  agentId: string;
  sessionId: string;
  turnId: string;
  modelId: string;
  userMessage: string;
  assistantMessage: string;
  toolCalls: ToolCallTrace[];
  latencyMs: number;
  errors: string[];
  resourceVersions: Record<string, string>; // snapshot of head versions used
}

export const Tracer = {
  record(trace: TurnTrace): string {
    const db = getDb();
    const id = `trc_${nanoid(12)}`;
    db.prepare(
      `INSERT INTO traces (id, turn_id, payload) VALUES (?, ?, ?)`,
    ).run(id, trace.turnId, JSON.stringify(trace));
    return id;
  },

  forSession(sessionId: string): TurnTrace[] {
    const db = getDb();
    const rows = db
      .prepare<[string], { payload: string }>(
        `SELECT traces.payload FROM traces
         JOIN turns ON turns.id = traces.turn_id
         WHERE turns.session_id = ?
         ORDER BY turns.idx ASC`,
      )
      .all(sessionId);
    return rows.map((r) => JSON.parse(r.payload) as TurnTrace);
  },
};
