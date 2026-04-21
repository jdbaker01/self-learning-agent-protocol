// Shared SEPL types (paper §3.2). M3: prompt + memory proposals.
// M4 will add tool proposals.

export interface Hypothesis {
  id: string;
  /** Which evolvable surface the hypothesis implicates. */
  area: "prompt" | "memory" | "tool";
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

export interface WriteMemoryProposal {
  type: "write_memory";
  content: string;
  tags: string[];
  rationale: string;
  addresses: string[];
}

export interface UpdateMemoryProposal {
  type: "update_memory";
  /** Resource id of the memory to modify. */
  memoryId: string;
  content: string;
  tags: string[];
  rationale: string;
  addresses: string[];
}

export interface DeleteMemoryProposal {
  type: "delete_memory";
  memoryId: string;
  rationale: string;
  addresses: string[];
}

export type MemoryProposal =
  | WriteMemoryProposal
  | UpdateMemoryProposal
  | DeleteMemoryProposal;

export interface UpdateToolProposal {
  type: "update_tool";
  /** Resource id of the tool to modify. */
  toolId: string;
  /** Tool name as shown in the trace (for UI context). */
  toolName: string;
  /** New description; null = leave unchanged. */
  description: string | null;
  /** New JSON Schema (stringified then parsed); null = leave unchanged. */
  argsSchemaJson: string | null;
  rationale: string;
  addresses: string[];
}

export interface CreateToolProposal {
  type: "create_tool";
  /** Unique tool name to register under this agent. */
  name: string;
  /** Allowlist key — must exist in tool.ts ALLOWLIST. */
  implementationRef: string;
  description: string;
  /** JSON Schema for the tool's args (stringified; parsed at commit time). */
  argsSchemaJson: string;
  rationale: string;
  addresses: string[];
}

export type ToolProposal = UpdateToolProposal | CreateToolProposal;

export type Proposal = UpdatePromptProposal | MemoryProposal | ToolProposal;

/** The full bundle a single Learn run may commit (or reject) as a unit. */
export interface ProposalBundle {
  updatePrompt?: UpdatePromptProposal;
  memoryOps: MemoryProposal[];
  toolOps: ToolProposal[];
}

/** Streamed to the Learn UI — one event per observable step. */
export type LearnEvent =
  | { type: "start"; learnRunId: string; sessionId: string; agentId: string }
  | { type: "reflect.begin" }
  | { type: "reflect.hypothesis"; hypothesis: Hypothesis }
  | { type: "reflect.end"; count: number }
  | { type: "select.begin" }
  | { type: "select.proposal"; proposal: Proposal }
  | { type: "select.end"; promptChanged: boolean; memoryOpCount: number }
  | { type: "improve.begin" }
  | { type: "improve.promptDiff"; before: string; after: string }
  | {
      type: "improve.memoryOp";
      op: "write" | "update" | "delete";
      memoryId?: string;
      before?: string;
      after?: string;
    }
  | {
      type: "improve.toolOp";
      op: "create" | "update";
      toolId?: string;
      toolName: string;
      implementationRef?: string;
      before?: { description: string; argsSchemaJson: string };
      after: { description: string; argsSchemaJson: string };
    }
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
