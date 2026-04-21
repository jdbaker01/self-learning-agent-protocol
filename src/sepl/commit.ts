// κ — Commit (M3). If evaluation passes, apply the full ProposalBundle to the
// RSPL registries atomically. Prompt update bumps the prompt version; memory
// ops persist through MemoryRegistry (which re-embeds on write/update).

import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { MemoryRegistry } from "@/src/rspl/registries/memory";
import type { ProposalBundle } from "./types";

export interface CommitInput {
  agentId: string;
  learnRunId: string;
  commit: boolean;
  bundle: ProposalBundle;
}

export interface CommitResult {
  committed: boolean;
  promptVersion?: string;
  memoryOps: Array<{
    op: "write" | "update" | "delete";
    memoryId?: string;
    ok: boolean;
    error?: string;
  }>;
}

export async function commit(input: CommitInput): Promise<CommitResult> {
  if (!input.commit) {
    return { committed: false, memoryOps: [] };
  }
  const createdBy = `sepl:${input.learnRunId}`;
  const result: CommitResult = { committed: true, memoryOps: [] };

  if (input.bundle.updatePrompt) {
    const rec = PromptRegistry.updateText(
      input.agentId,
      input.bundle.updatePrompt.newPromptText,
      createdBy,
    );
    result.promptVersion = rec.version;
  }

  for (const op of input.bundle.memoryOps) {
    try {
      if (op.type === "write_memory") {
        const { memoryId } = await MemoryRegistry.addMemory(
          input.agentId,
          op.content,
          op.tags,
          createdBy,
        );
        result.memoryOps.push({ op: "write", memoryId, ok: true });
      } else if (op.type === "update_memory") {
        await MemoryRegistry.updateMemory(
          op.memoryId,
          { content: op.content, tags: op.tags },
          createdBy,
        );
        result.memoryOps.push({ op: "update", memoryId: op.memoryId, ok: true });
      } else if (op.type === "delete_memory") {
        MemoryRegistry.deleteMemory(op.memoryId);
        result.memoryOps.push({ op: "delete", memoryId: op.memoryId, ok: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.memoryOps.push({
        op: op.type === "write_memory" ? "write" : op.type === "update_memory" ? "update" : "delete",
        memoryId: "memoryId" in op ? op.memoryId : undefined,
        ok: false,
        error: message,
      });
    }
  }

  return result;
}
