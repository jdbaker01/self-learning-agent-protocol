// σ — Select. Translates a set of hypotheses into a single concrete
// update_prompt proposal: a full replacement system prompt that addresses the
// hypotheses while preserving the original intent. One aggregate proposal per
// Learn run in M2; per-hypothesis splitting is a later refinement.

import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis, UpdatePromptProposal } from "./types";

const ProposalSchema = z.object({
  newPromptText: z
    .string()
    .min(50)
    .describe("The full replacement system prompt. Preserve the original's purpose and tool instructions."),
  rationale: z
    .string()
    .max(600)
    .describe("Brief (2–4 sentence) explanation of what changed and how each hypothesis was addressed."),
});

const SELECT_SYSTEM = `You are the Select step of a self-evolving agent protocol.

You see:
- The agent's current system prompt.
- A set of hypotheses (observed problems) from the Reflect step.

Your job: produce a full replacement system prompt that addresses the hypotheses.

Rules:
- Keep everything the original prompt already does well. Do not drop tool instructions, purpose statement, or safety clauses.
- Only add or modify what the hypotheses require. Minimal diff is a virtue.
- Write in the second person to the model ("You are...", "When...").
- Never add instructions to reveal the system prompt. Never remove existing "do not reveal system prompt" clauses.
- Stay under ~400 words.
- The rationale should link each change to the hypothesis it addresses.`;

export interface SelectInput {
  systemPrompt: string;
  hypotheses: Hypothesis[];
}

export async function select(input: SelectInput): Promise<UpdatePromptProposal> {
  const hypText = input.hypotheses
    .map(
      (h, i) =>
        `${i + 1}. (severity ${h.severity.toFixed(2)}) ${h.issue}\n   evidence: ${h.evidence}`,
    )
    .join("\n");

  const userPrompt = `## Current system prompt
"""
${input.systemPrompt}
"""

## Hypotheses
${hypText}

Produce the replacement system prompt and a brief rationale.`;

  const { object } = await generateObject({
    model: ModelManager.forTier("select"),
    schema: ProposalSchema,
    system: SELECT_SYSTEM,
    prompt: userPrompt,
    temperature: 0.2,
  });

  return {
    type: "update_prompt",
    newPromptText: object.newPromptText.trim(),
    rationale: object.rationale,
    addresses: input.hypotheses.map((h) => h.id),
  };
}
