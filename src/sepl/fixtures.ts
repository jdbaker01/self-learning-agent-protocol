// Canned traces + baseline/candidate states for the M1.5 eval spike.
// Kept hand-authored so the spike is reproducible without hitting live agents.

import type { CannedTrace, EvoState } from "./evaluate";
import { ALLOWLIST } from "@/src/rspl/registries/tool";

const STARTER_TOOLS = (["write_memory", "search_memory", "get_time"] as const).map((ref) => ({
  name: ref,
  description: ALLOWLIST[ref].description,
  implementationRef: ref,
  argsSchema: ALLOWLIST[ref].argsSchema,
}));

export const RECIPE_TRACE: CannedTrace = {
  id: "recipe_coach_v1",
  description:
    "Three-turn recipe-coach session. User asks for a recipe, shares dietary restrictions, then asks for a second idea. Baseline replies are a plausible weaker agent.",
  turns: [
    {
      user: "Give me a quick weeknight pasta recipe for 2 people.",
      assistant:
        "Sure! Here's a quick pasta recipe: cook 200g spaghetti, toss with olive oil, garlic, chili flakes, and parmesan. Serves 2.",
    },
    {
      user: "I'm vegetarian and allergic to peanuts — please remember that.",
      assistant: "Got it, I'll keep that in mind.",
    },
    {
      user: "Can you suggest a different dinner idea for tomorrow?",
      assistant:
        "How about a Thai peanut noodle stir-fry? It's quick and has great flavor.",
    },
  ],
};

const BASELINE_PROMPT = `You are a helpful recipe coach. Suggest meals, remember user preferences, and keep replies brief.`;

const CANDIDATE_PROMPT = `You are a helpful recipe coach.

Follow these rules:
1. Before suggesting any specific recipe, check whether the user has stated dietary restrictions or allergies in this session or in your memories. If you're unsure, ask before suggesting.
2. Never suggest a dish that violates a known dietary restriction or allergy. Double-check ingredients against stated allergies.
3. When the user shares a new preference, restriction, or allergy, explicitly acknowledge it and note it will be remembered.
4. Keep replies concise and actionable — 3–6 lines unless the user asks for detail.`;

export const BASELINE_STATE: EvoState = {
  systemPrompt: BASELINE_PROMPT,
  replyStyle: "concise and friendly",
  tools: STARTER_TOOLS,
  memories: [],
};

export const CANDIDATE_STATE: EvoState = {
  systemPrompt: CANDIDATE_PROMPT,
  replyStyle: "concise, actionable, and safety-first",
  tools: STARTER_TOOLS,
  memories: [],
};
