// Shared SEPL types (paper §3.2). Scoped to M2: prompt-only proposals.
// In M3/M4 the Proposal union widens to include memory and tool operations.

export interface Hypothesis {
  id: string;
  /** Which evolvable surface the hypothesis implicates. M2 is prompt-only. */
  area: "prompt";
  /** One-sentence statement of the failure mode or improvement opportunity. */
  issue: string;
  /** Reference to the turn + short quote that justifies the hypothesis. */
  evidence: string;
  /** 0..1 — how confident the reflector is that this matters. */
  severity: number;
}

export interface UpdatePromptProposal {
  type: "update_prompt";
  /** Complete replacement prompt text. Diffs are displayed in the UI. */
  newPromptText: string;
  /** Short explanation of what changed and why, referencing the hypotheses. */
  rationale: string;
  /** The hypotheses this proposal addresses. */
  addresses: string[];
}

export type Proposal = UpdatePromptProposal;

/** Streamed to the Learn UI — one event per observable step. */
export type LearnEvent =
  | { type: "start"; learnRunId: string; sessionId: string; agentId: string }
  | { type: "reflect.begin" }
  | { type: "reflect.hypothesis"; hypothesis: Hypothesis }
  | { type: "reflect.end"; count: number }
  | { type: "select.begin" }
  | { type: "select.proposal"; proposal: Proposal }
  | { type: "select.end" }
  | { type: "improve.begin" }
  | { type: "improve.diff"; before: string; after: string }
  | { type: "improve.end" }
  | { type: "evaluate.begin" }
  | { type: "evaluate.progress"; stage: string; note?: string }
  | {
      type: "evaluate.complete";
      ruleGatesPassed: boolean;
      aggregate: "candidate_better" | "baseline_better" | "equivalent" | "rule_gate_fail";
      commit: boolean;
      reason: string;
    }
  | { type: "commit.begin" }
  | {
      type: "commit.decision";
      committed: boolean;
      newVersion?: string;
      reason: string;
    }
  | { type: "error"; message: string }
  | { type: "done" };
