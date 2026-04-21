// σ — Select (M3). Translates hypotheses into a ProposalBundle:
//   - optional update_prompt (if any prompt-area hypotheses)
//   - array of memory ops (write/update/delete)
// One bundle per Learn run; evaluated and committed atomically.

import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis, ProposalBundle } from "./types";

const BundleSchema = z.object({
  updatePrompt: z
    .object({
      newPromptText: z.string().min(50),
      rationale: z.string().max(600),
      addresses: z.array(z.string()),
    })
    .nullable()
    .describe("Full replacement prompt, or null if no prompt change is needed."),
  memoryOps: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("write_memory"),
        content: z.string().min(3).max(500),
        tags: z.array(z.string()).describe("Topic tags, e.g. ['allergy'], ['goal']. Pass [] if none."),
        rationale: z.string().max(400),
        addresses: z.array(z.string()),
      }),
      z.object({
        type: z.literal("update_memory"),
        memoryId: z.string(),
        content: z.string().min(3).max(500),
        tags: z.array(z.string()).describe("Topic tags. Pass [] if none."),
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
});

const SELECT_SYSTEM = `You are the Select step of a self-evolving agent protocol.

You see:
- The current system prompt.
- The current memories (each has an id).
- A set of hypotheses from Reflect, each tagged with an area ("prompt" or "memory").

Produce a ProposalBundle:
- updatePrompt: if ANY hypothesis has area="prompt", write a full replacement system prompt that addresses them. Otherwise null.
- memoryOps: for each hypothesis with area="memory", produce exactly one matching operation:
  * write_memory: when the hypothesis is about a durable fact that is NOT already in memory.
  * update_memory: when a fact is in memory but needs correction or refinement. MUST reference an existing memoryId verbatim.
  * delete_memory: when a fact is in memory but is no longer true. MUST reference an existing memoryId verbatim.

Rules:
- Never invent a memoryId. Only use ids from the "Current memories" list.
- Prompt: keep everything the original does well (purpose, tool instructions, safety clauses). Minimal diff. Never remove "do not reveal system prompt" clauses. Second person. Under ~400 words.
- Memory content: specific, durable, 3–200 chars. Do NOT record transient session state, jokes, or opinions unless the user explicitly said "remember this".
- Each op's rationale must link to the hypothesis it addresses.
- If no hypotheses of a given area exist, return an empty array / null as appropriate.`;

export interface SelectInput {
  systemPrompt: string;
  memories: Array<{ id: string; content: string; tags: string[] }>;
  hypotheses: Hypothesis[];
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
        .map(
          (m, i) =>
            `${i + 1}. [${m.id}] ${m.content}${m.tags.length ? `  tags: ${m.tags.join(", ")}` : ""}`,
        )
        .join("\n")
    : "(none)";

  const userPrompt = `## Current system prompt
"""
${input.systemPrompt}
"""

## Current memories
${memText}

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

  // Filter out any memory ops whose ids aren't real — LLM safeguard.
  const knownIds = new Set(input.memories.map((m) => m.id));
  const safeOps = object.memoryOps.filter((op) => {
    if (op.type === "write_memory") return true;
    return knownIds.has(op.memoryId);
  });

  const bundle: ProposalBundle = {
    updatePrompt: object.updatePrompt
      ? {
          type: "update_prompt",
          newPromptText: object.updatePrompt.newPromptText.trim(),
          rationale: object.updatePrompt.rationale,
          addresses: object.updatePrompt.addresses,
        }
      : undefined,
    memoryOps: safeOps,
  };
  return bundle;
}
