// ι — Improve (M4). Apply a ProposalBundle to the baseline EvoState,
// producing a candidate EvoState + per-op change lists for the UI.
// No DB writes here — all mutation happens in κ.

import type { EvoState, EvoTool } from "./evaluate";
import type { ProposalBundle } from "./types";

export interface MemoryChange {
  op: "write" | "update" | "delete";
  memoryId?: string;
  before?: string;
  after?: string;
}

export interface ToolChange {
  op: "create" | "update";
  toolId?: string;
  toolName: string;
  implementationRef?: string;
  before?: { description: string; argsSchemaJson: string };
  after: { description: string; argsSchemaJson: string };
}

export interface ImprovePreview {
  candidate: EvoState;
  memoryChanges: MemoryChange[];
  toolChanges: ToolChange[];
}

function parseSchema(s: string | null | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!s) return fallback;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function improve(
  baseline: EvoState,
  bundle: ProposalBundle,
  baselineMemories: Array<{ id: string; content: string; tags: string[] }>,
  baselineTools: Array<{ id: string; name: string; description: string; implementationRef: string; argsSchema: Record<string, unknown> }>,
): ImprovePreview {
  const systemPrompt = bundle.updatePrompt
    ? bundle.updatePrompt.newPromptText
    : baseline.systemPrompt;

  // --- Memory ops ---
  const memMap = new Map(
    baselineMemories.map((m) => [m.id, { id: m.id, content: m.content, tags: m.tags }]),
  );
  const memoryChanges: MemoryChange[] = [];
  for (const op of bundle.memoryOps) {
    if (op.type === "write_memory") {
      const pseudoId = `__new_${memoryChanges.length}`;
      memMap.set(pseudoId, { id: pseudoId, content: op.content, tags: op.tags });
      memoryChanges.push({ op: "write", after: op.content });
    } else if (op.type === "update_memory") {
      const before = memMap.get(op.memoryId);
      if (!before) continue;
      memMap.set(op.memoryId, { id: op.memoryId, content: op.content, tags: op.tags });
      memoryChanges.push({ op: "update", memoryId: op.memoryId, before: before.content, after: op.content });
    } else if (op.type === "delete_memory") {
      const before = memMap.get(op.memoryId);
      if (!before) continue;
      memMap.delete(op.memoryId);
      memoryChanges.push({ op: "delete", memoryId: op.memoryId, before: before.content });
    }
  }

  // --- Tool ops ---
  const toolMap = new Map(baselineTools.map((t) => [t.id, { ...t }]));
  const toolChanges: ToolChange[] = [];
  for (const op of bundle.toolOps) {
    if (op.type === "update_tool") {
      const current = toolMap.get(op.toolId);
      if (!current) continue;
      const newDesc = op.description ?? current.description;
      const newArgs = parseSchema(op.argsSchemaJson, current.argsSchema);
      toolMap.set(op.toolId, {
        ...current,
        description: newDesc,
        argsSchema: newArgs,
      });
      toolChanges.push({
        op: "update",
        toolId: op.toolId,
        toolName: current.name,
        implementationRef: current.implementationRef,
        before: {
          description: current.description,
          argsSchemaJson: JSON.stringify(current.argsSchema, null, 2),
        },
        after: {
          description: newDesc,
          argsSchemaJson: JSON.stringify(newArgs, null, 2),
        },
      });
    } else if (op.type === "create_tool") {
      const newArgs = parseSchema(op.argsSchemaJson, { type: "object", properties: {}, additionalProperties: false });
      const pseudoId = `__newtool_${toolChanges.length}`;
      toolMap.set(pseudoId, {
        id: pseudoId,
        name: op.name,
        description: op.description,
        implementationRef: op.implementationRef,
        argsSchema: newArgs,
      });
      toolChanges.push({
        op: "create",
        toolName: op.name,
        implementationRef: op.implementationRef,
        after: {
          description: op.description,
          argsSchemaJson: JSON.stringify(newArgs, null, 2),
        },
      });
    }
  }

  const candidateTools: EvoTool[] = Array.from(toolMap.values()).map((t) => ({
    name: t.name,
    description: t.description,
    implementationRef: t.implementationRef,
    argsSchema: t.argsSchema,
  }));

  const candidate: EvoState = {
    ...baseline,
    systemPrompt,
    tools: candidateTools,
    memories: Array.from(memMap.values()).map((m) => ({ content: m.content, tags: m.tags })),
  };

  return { candidate, memoryChanges, toolChanges };
}
