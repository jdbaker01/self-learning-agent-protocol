// κ — Commit. If the evaluator accepts the candidate, bump the prompt
// resource's head version. Otherwise, no-op (candidate is discarded).

import { PromptRegistry } from "@/src/rspl/registries/prompt";

export interface CommitInput {
  agentId: string;
  learnRunId: string;
  commit: boolean;
  newPromptText: string;
}

export interface CommitResult {
  committed: boolean;
  newVersion?: string;
}

export function commit(input: CommitInput): CommitResult {
  if (!input.commit) return { committed: false };
  const rec = PromptRegistry.updateText(
    input.agentId,
    input.newPromptText,
    `sepl:${input.learnRunId}`,
  );
  return { committed: true, newVersion: rec.version };
}
