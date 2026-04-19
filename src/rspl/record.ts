// RSPL registration record types. Paper §3.1.1, Definitions C.1 & C.2.

export type EntityType = "prompt" | "agent_policy" | "tool" | "env" | "memory";

/**
 * Resource Entity (Def C.1):
 *   e_{τ,i} = (n, d, φ, g, m)
 * where φ is an input→output mapping we materialize as `impl` (JSON source/config)
 * plus a runtime `run(input)` on the registry.
 */
export interface ResourceEntity {
  id: string;
  agentId: string;
  entityType: EntityType;
  name: string;           // n
  description: string;    // d
  learnable: boolean;     // g (0|1)
  metadata: Record<string, unknown>; // m
}

/**
 * Registration Record (Def C.2):
 *   c_{τ,i} = (e, v, η, θ, F)
 * η = impl descriptor (source / config blob)
 * θ = instantiation parameters
 * F = exported representations (tool-use schema, natural-language contract)
 */
export interface RegistrationRecord<TImpl = unknown> extends ResourceEntity {
  version: string;                      // v
  impl: TImpl;                          // η
  params: Record<string, unknown>;      // θ
  contract: ExportedContract;           // F
}

/**
 * Exported representations (F) — what the LLM sees.
 * For tools: a JSON-Schema describing arguments + a natural-language usage contract.
 * For prompts: typically just the prompt text as `text`.
 * For memory: a retrieval contract (query schema).
 */
export interface ExportedContract {
  kind: "text" | "tool" | "retrieval" | "policy";
  text?: string;
  argsSchema?: Record<string, unknown>;
  usage?: string;
  [key: string]: unknown;
}
