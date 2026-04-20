// ι — Improve. Apply an update_prompt proposal to the baseline EvoState,
// producing a candidate EvoState. M2 is prompt-only so this is a pure
// field swap; M3/M4 will handle memory and tool operations.

import type { EvoState } from "./evaluate";
import type { UpdatePromptProposal } from "./types";

export function improve(baseline: EvoState, proposal: UpdatePromptProposal): EvoState {
  return {
    ...baseline,
    systemPrompt: proposal.newPromptText,
  };
}
