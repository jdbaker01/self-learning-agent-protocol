// κ — Commit (M4). Apply the full ProposalBundle to the RSPL registries when
// evaluation passes. Prompt bumps prompt version; memory ops go through
// MemoryRegistry (re-embed); tool ops go through ToolRegistry.

import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { MemoryRegistry } from "@/src/rspl/registries/memory";
import { ToolRegistry, type AllowlistKey } from "@/src/rspl/registries/tool";
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
  toolOps: Array<{
    op: "create" | "update";
    toolId?: string;
    toolName?: string;
    ok: boolean;
    error?: string;
  }>;
}

function parseSchema(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return null;
}

export async function commit(input: CommitInput): Promise<CommitResult> {
  if (!input.commit) {
    return { committed: false, memoryOps: [], toolOps: [] };
  }
  const createdBy = `sepl:${input.learnRunId}`;
  const result: CommitResult = { committed: true, memoryOps: [], toolOps: [] };

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
        const { memoryId } = await MemoryRegistry.addMemory(input.agentId, op.content, op.tags, createdBy);
        result.memoryOps.push({ op: "write", memoryId, ok: true });
      } else if (op.type === "update_memory") {
        await MemoryRegistry.updateMemory(op.memoryId, { content: op.content, tags: op.tags }, createdBy);
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

  for (const op of input.bundle.toolOps) {
    try {
      if (op.type === "update_tool") {
        const parsed = parseSchema(op.argsSchemaJson);
        const patch: { description?: string; argsSchema?: Record<string, unknown> } = {};
        if (op.description !== null) patch.description = op.description;
        if (parsed !== null) patch.argsSchema = parsed;
        const rec = ToolRegistry.updateToolMeta(op.toolId, patch, createdBy);
        result.toolOps.push({ op: "update", toolId: op.toolId, toolName: rec.name, ok: true });
      } else {
        const parsed = parseSchema(op.argsSchemaJson);
        if (parsed === null) throw new Error("argsSchemaJson did not parse to object");
        const rec = ToolRegistry.installTool(
          input.agentId,
          op.name,
          op.implementationRef as AllowlistKey,
          { description: op.description, argsSchema: parsed },
          createdBy,
        );
        result.toolOps.push({ op: "create", toolId: rec.id, toolName: rec.name, ok: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.toolOps.push({
        op: op.type === "update_tool" ? "update" : "create",
        toolId: "toolId" in op ? op.toolId : undefined,
        toolName: "name" in op ? op.name : "toolName" in op ? op.toolName : undefined,
        ok: false,
        error: message,
      });
    }
  }

  return result;
}
