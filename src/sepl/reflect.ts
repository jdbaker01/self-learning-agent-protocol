// ρ — Reflect (M4). Sees current prompt, memories, tools, and the full session
// trace; returns hypotheses targeting any of the three evolvable surfaces.

import { nanoid } from "nanoid";
import { z } from "zod";
import { generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import type { Hypothesis } from "./types";

const HypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        area: z.enum(["prompt", "memory", "tool"]),
        issue: z.string(),
        evidence: z.string(),
        severity: z.number().min(0).max(1),
      }),
    )
    .min(0)
    .max(6),
});

const REFLECT_SYSTEM = `You are the Reflect step of a self-evolving agent protocol.

You see:
- The agent's current system prompt.
- The agent's current memories (durable facts about the user).
- The agent's current tool set (pre-audited callable functions).
- The available allowlist of tool implementations (the model can also propose installing a tool not currently configured, by referencing an allowlist key).
- A full session trace (user + assistant turns) that just ended.

Classify each hypothesis by its evolvable surface:
- "prompt": the system prompt itself is wrong or incomplete.
- "memory": a durable fact about the user is missing, stale, or wrong.
- "tool": the tool set is missing a capability the agent needed, or an existing tool's description/args are unclear enough that the agent didn't call it when it should have, or an existing tool is unused and cluttering the set.

Rules:
- Ground every hypothesis in a specific turn or in the current resource list. Quote evidence verbatim when you can.
- Prefer 1–3 strong hypotheses over many weak ones. Zero is valid.
- Memory hypotheses are ONLY for persistent facts, not transient session state.
- Tool hypotheses must reference either an existing tool name (for update) or an allowlist key (for create). Do not invent implementation refs.
- Severity reflects expected improvement if addressed.`;

export interface ReflectInput {
  systemPrompt: string;
  memories: Array<{ id: string; content: string; tags: string[] }>;
  tools: Array<{ id: string; name: string; description: string; implementationRef: string }>;
  allowlistKeys: readonly string[];
  trace: Array<{ user: string; assistant: string }>;
}

export async function reflect(input: ReflectInput): Promise<Hypothesis[]> {
  const traceText = input.trace
    .map((t, i) => `Turn ${i}:\n  user: ${JSON.stringify(t.user)}\n  assistant: ${JSON.stringify(t.assistant)}`)
    .join("\n\n");

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

## Allowlist (tool implementations you may reference for create proposals)
${allowlistText}

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
