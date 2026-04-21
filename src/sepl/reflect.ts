// ρ — Reflect (M3). Sees current prompt, current memories, and the full
// session trace, and returns hypotheses about prompt-level OR memory-level
// improvements.

import { nanoid } from "nanoid";
import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis } from "./types";

const HypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        area: z.enum(["prompt", "memory"]),
        issue: z
          .string()
          .describe("One-sentence observation of a concrete problem or missing knowledge."),
        evidence: z
          .string()
          .describe("Turn index + verbatim quote that supports the issue."),
        severity: z.number().min(0).max(1),
      }),
    )
    .min(0)
    .max(6),
});

const REFLECT_SYSTEM = `You are the Reflect step of a self-evolving agent protocol.

You see:
- The agent's current system prompt.
- The agent's current memories (durable facts about the user the agent has persisted).
- A full session trace (user + assistant turns) that just ended.

Find concrete issues the next session could do better. Classify each hypothesis as one of:
- "prompt": the system prompt itself is wrong or incomplete (it instructs the wrong behavior, misses a rule, contains an outdated constraint).
- "memory": there is a durable fact about the user that surfaced in this session and either (a) was not recorded, (b) was recorded inaccurately, or (c) is recorded but no longer true / has been updated. Memory hypotheses are ONLY for facts that persist across sessions (preferences, allergies, goals, long-term constraints) — not for transient session state.

Rules:
- Ground every hypothesis in a specific turn. Quote evidence verbatim.
- Prefer 1–3 strong hypotheses over many weak ones. Zero is valid if the agent performed well.
- Do not propose tool changes — that phase lands later.
- Severity reflects expected improvement if the hypothesis is addressed. Missed safety facts (allergies, restrictions) = high; minor phrasing = low.`;

export interface ReflectInput {
  systemPrompt: string;
  memories: Array<{ id: string; content: string; tags: string[] }>;
  trace: Array<{ user: string; assistant: string }>;
}

export async function reflect(input: ReflectInput): Promise<Hypothesis[]> {
  const traceText = input.trace
    .map((t, i) => `Turn ${i}:\n  user: ${JSON.stringify(t.user)}\n  assistant: ${JSON.stringify(t.assistant)}`)
    .join("\n\n");

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
    area: h.area,
    issue: h.issue,
    evidence: h.evidence,
    severity: h.severity,
  }));
}
