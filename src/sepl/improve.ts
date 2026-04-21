// ι — Improve (M3). Apply a ProposalBundle to the baseline EvoState,
// producing a candidate EvoState. Purely in-memory — no DB writes until κ.

import type { EvoState } from "./evaluate";
import type { ProposalBundle } from "./types";

export interface ImprovePreview {
  candidate: EvoState;
  /** The memory set before and after, for streaming diffs to the UI. */
  memoryChanges: Array<{
    op: "write" | "update" | "delete";
    memoryId?: string;
    before?: string;
    after?: string;
  }>;
}

export function improve(
  baseline: EvoState,
  bundle: ProposalBundle,
  baselineMemories: Array<{ id: string; content: string; tags: string[] }>,
): ImprovePreview {
  const systemPrompt = bundle.updatePrompt
    ? bundle.updatePrompt.newPromptText
    : baseline.systemPrompt;

  // Work on a map keyed by memoryId so update/delete are easy.
  const memMap = new Map(
    baselineMemories.map((m) => [m.id, { id: m.id, content: m.content, tags: m.tags }]),
  );
  const changes: ImprovePreview["memoryChanges"] = [];

  for (const op of bundle.memoryOps) {
    if (op.type === "write_memory") {
      // Synthesize a placeholder id — real id assigned at commit time.
      const pseudoId = `__new_${changes.length}`;
      memMap.set(pseudoId, { id: pseudoId, content: op.content, tags: op.tags });
      changes.push({ op: "write", after: op.content });
    } else if (op.type === "update_memory") {
      const before = memMap.get(op.memoryId);
      if (!before) continue;
      memMap.set(op.memoryId, {
        id: op.memoryId,
        content: op.content,
        tags: op.tags,
      });
      changes.push({
        op: "update",
        memoryId: op.memoryId,
        before: before.content,
        after: op.content,
      });
    } else if (op.type === "delete_memory") {
      const before = memMap.get(op.memoryId);
      if (!before) continue;
      memMap.delete(op.memoryId);
      changes.push({ op: "delete", memoryId: op.memoryId, before: before.content });
    }
  }

  const candidate: EvoState = {
    ...baseline,
    systemPrompt,
    memories: Array.from(memMap.values()).map((m) => ({
      content: m.content,
      tags: m.tags,
    })),
  };

  return { candidate, memoryChanges: changes };
}
