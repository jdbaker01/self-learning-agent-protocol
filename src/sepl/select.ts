// σ — Select (M4). Translates hypotheses into a ProposalBundle of prompt,
// memory, and tool ops. One bundle per Learn run; evaluated and committed
// atomically.

import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis, ProposalBundle, ToolProposal } from "./types";

const BundleSchema = z.object({
  updatePrompt: z
    .object({
      newPromptText: z.string().min(50),
      rationale: z.string().max(600),
      addresses: z.array(z.string()),
    })
    .nullable(),
  memoryOps: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("write_memory"),
        content: z.string().min(3).max(500),
        tags: z.array(z.string()),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
      z.object({
        type: z.literal("update_memory"),
        memoryId: z.string(),
        content: z.string().min(3).max(500),
        tags: z.array(z.string()),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
      z.object({
        type: z.literal("delete_memory"),
        memoryId: z.string(),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
    ]),
  ),
  toolOps: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("update_tool"),
        toolId: z.string(),
        toolName: z.string(),
        description: z.string().nullable().describe("New description; null to keep existing."),
        argsSchemaJson: z
          .string()
          .nullable()
          .describe('JSON-serialized replacement argsSchema; null to keep existing. Example: \'{"type":"object","properties":{...},"required":[...]}\''),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
      z.object({
        type: z.literal("create_tool"),
        name: z.string().min(1).max(40),
        implementationRef: z.string(),
        description: z.string().min(10).max(400),
        argsSchemaJson: z
          .string()
          .describe('JSON-serialized argsSchema for the new tool. Must be type:"object".'),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
    ]),
  ),
});

const SELECT_SYSTEM = `You are the Select step of a self-evolving agent protocol.

You see:
- Current system prompt.
- Current memories (each has an id).
- Current tools (each has an id, name, and implementation ref).
- Allowlist of tool implementations you may reference.
- Hypotheses from Reflect, each with an area and id.

Produce a ProposalBundle:
- updatePrompt: if ANY hypothesis has area="prompt", write a full replacement prompt. Otherwise null.
- memoryOps: for each area="memory" hypothesis, one matching write_memory / update_memory / delete_memory op. Never invent memoryIds.
- toolOps: for each area="tool" hypothesis, one matching update_tool or create_tool op:
  * update_tool: reference an existing toolId from the Current tools list. Change description and/or args schema. implementation_ref is immutable.
  * create_tool: pick an implementationRef from the allowlist that is NOT already installed (or is installed but would serve a distinct role under a new name). Provide a unique tool name, description, and args schema.

Rules:
- Never invent a memoryId, toolId, or implementationRef. Only use values from the provided lists / allowlist.
- argsSchemaJson is a JSON-serialized JSON Schema. Always use {"type":"object", "properties":{...}, "required":[...], "additionalProperties": false}. Return the string, not an object.
- Prompt: preserve original purpose, tool instructions, safety clauses. Never remove "do not reveal system prompt".
- Memory content: specific, durable, 3–200 chars.
- Tool changes are conservative — only propose when the agent clearly needed the capability or was misusing what existed.
- Rationale for each op links back to the hypothesis id.`;

export interface SelectInput {
  systemPrompt: string;
  memories: Array<{ id: string; content: string; tags: string[] }>;
  tools: Array<{ id: string; name: string; description: string; implementationRef: string }>;
  allowlistKeys: readonly string[];
  hypotheses: Hypothesis[];
}

function safeParseSchema(s: string | null): Record<string, unknown> | null {
  if (s == null) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export async function select(input: SelectInput): Promise<ProposalBundle> {
  const hypText = input.hypotheses
    .map(
      (h, i) =>
        `${i + 1}. [${h.id}] area=${h.area} sev=${h.severity.toFixed(2)}\n   issue: ${h.issue}\n   evidence: ${h.evidence}`,
    )
    .join("\n");

  const memText = input.memories.length
    ? input.memories
        .map((m) => `- [${m.id}] ${m.content}${m.tags.length ? `  tags: ${m.tags.join(", ")}` : ""}`)
        .join("\n")
    : "(none)";

  const toolText = input.tools.length
    ? input.tools.map((t) => `- ${t.name} (${t.implementationRef}) [${t.id}]: ${t.description}`).join("\n")
    : "(none)";

  const allowlistText = input.allowlistKeys.map((k) => `- ${k}`).join("\n");

  const userPrompt = `## Current system prompt
"""
${input.systemPrompt}
"""

## Current memories
${memText}

## Current tools
${toolText}

## Allowlist
${allowlistText}

## Hypotheses
${hypText}

Produce the ProposalBundle as JSON per the schema.`;

  const { object } = await generateObject({
    model: ModelManager.forTier("select"),
    schema: BundleSchema,
    system: SELECT_SYSTEM,
    prompt: userPrompt,
    temperature: 0.2,
  });

  // Safety filter: only keep ops referencing real ids / allowlist keys.
  const knownMemIds = new Set(input.memories.map((m) => m.id));
  const knownToolIds = new Set(input.tools.map((t) => t.id));
  const knownToolNames = new Set(input.tools.map((t) => t.name));
  const allowlist = new Set(input.allowlistKeys);

  const safeMem = object.memoryOps.filter((op) => {
    if (op.type === "write_memory") return true;
    return knownMemIds.has(op.memoryId);
  });

  const safeTools: ToolProposal[] = [];
  for (const op of object.toolOps) {
    if (op.type === "update_tool") {
      if (!knownToolIds.has(op.toolId)) continue;
      // Validate argsSchemaJson parses if provided.
      if (op.argsSchemaJson !== null && safeParseSchema(op.argsSchemaJson) === null) continue;
      safeTools.push(op);
    } else {
      if (!allowlist.has(op.implementationRef)) continue;
      if (knownToolNames.has(op.name)) continue; // name collision
      if (safeParseSchema(op.argsSchemaJson) === null) continue;
      safeTools.push(op);
    }
  }

  const bundle: ProposalBundle = {
    updatePrompt: object.updatePrompt
      ? {
          type: "update_prompt",
          newPromptText: object.updatePrompt.newPromptText.trim(),
          rationale: object.updatePrompt.rationale,
          addresses: object.updatePrompt.addresses,
        }
      : undefined,
    memoryOps: safeMem,
    toolOps: safeTools,
  };
  return bundle;
}
