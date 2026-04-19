// Model Manager (paper §3.1.4). Provider-agnostic wrapper over the Vercel ai SDK.
// v1 uses OpenAI. Swap to Anthropic etc. by changing the adapter in one place.

import { openai } from "@ai-sdk/openai";
import type { LanguageModel, EmbeddingModel } from "ai";

export type ModelTier = "chat" | "reflect" | "select" | "judge";

const CHAT_MODEL    = process.env.SLAP_CHAT_MODEL    ?? "gpt-4.1-mini";
const REFLECT_MODEL = process.env.SLAP_REFLECT_MODEL ?? "gpt-4.1";
const SELECT_MODEL  = process.env.SLAP_SELECT_MODEL  ?? "gpt-4.1";
const JUDGE_MODEL   = process.env.SLAP_JUDGE_MODEL   ?? "gpt-4.1-mini";
const EMBED_MODEL   = process.env.SLAP_EMBED_MODEL   ?? "text-embedding-3-small";

const TIER_TO_ID: Record<ModelTier, string> = {
  chat:    CHAT_MODEL,
  reflect: REFLECT_MODEL,
  select:  SELECT_MODEL,
  judge:   JUDGE_MODEL,
};

export const ModelManager = {
  forTier(tier: ModelTier): LanguageModel {
    return openai(TIER_TO_ID[tier]);
  },

  byId(id: string): LanguageModel {
    return openai(id);
  },

  embedder(): EmbeddingModel {
    return openai.textEmbeddingModel(EMBED_MODEL);
  },

  modelIdForTier(tier: ModelTier): string {
    return TIER_TO_ID[tier];
  },
};
