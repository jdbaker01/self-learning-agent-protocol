// ρ — Reflect. Reads the session trace plus current V_evo (system prompt only
// in M2) and produces structured hypotheses about prompt-level improvements.

import { nanoid } from "nanoid";
import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis } from "./types";

const HypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        issue: z
          .string()
          .describe("One-sentence observation of a concrete problem in the session or an opportunity the current prompt misses."),
        evidence: z
          .string()
          .describe("Turn index + short verbatim quote that supports the issue, e.g. 'turn 2: user said \"...\" but agent replied \"...\"'."),
        severity: z
          .number()
          .min(0)
          .max(1)
          .describe("0..1 — how much impact fixing this would have on the agent's performance."),
      }),
    )
    .min(0)
    .max(5)
    .describe("Up to 5 distinct hypotheses. Fewer is fine — only include ones supported by the trace."),
});

const REFLECT_SYSTEM = `You are the Reflect step of a self-evolving agent protocol.

You see:
- The agent's current system prompt (what it is instructed to do).
- A full session trace (user messages and agent replies) that has just ended.

Your job: find concrete, *prompt-level* problems in how the agent performed, and propose them as hypotheses. Each hypothesis should be something the system prompt could have caused or could fix.

Rules:
- Ground every hypothesis in a specific turn. Quote evidence verbatim.
- Prefer a few strong hypotheses (1–3) over many weak ones. Zero is a valid answer if the agent performed well.
- Do not propose memory or tool changes — this phase is prompt-only.
- Do not propose style nits (emoji, tone) unless they materially hurt the user.
- Severity reflects the expected improvement *if* the prompt caught this. A missed safety-relevant issue (e.g. ignoring a stated allergy) is high severity; a minor phrasing issue is low.`;

export interface ReflectInput {
  systemPrompt: string;
  /** Oldest → newest. Each turn is one user/assistant pair. */
  trace: Array<{ user: string; assistant: string }>;
}

export async function reflect(input: ReflectInput): Promise<Hypothesis[]> {
  const traceText = input.trace
    .map((t, i) => `Turn ${i}:\n  user: ${JSON.stringify(t.user)}\n  assistant: ${JSON.stringify(t.assistant)}`)
    .join("\n\n");

  const userPrompt = `## Current system prompt
"""
${input.systemPrompt}
"""

## Session trace (${input.trace.length} turns)
${traceText}

Return hypotheses as JSON per the schema.`;

  const { object } = await generateObject({
    model: ModelManager.forTier("reflect"),
    schema: HypothesesSchema,
    system: REFLECT_SYSTEM,
    prompt: userPrompt,
    temperature: 0.2,
  });

  return object.hypotheses.map((h) => ({
    id: `hyp_${nanoid(8)}`,
    area: "prompt" as const,
    issue: h.issue,
    evidence: h.evidence,
    severity: h.severity,
  }));
}
