// Tool registry. Tools are callable functions exposed to the LLM.
// Safety: the impl is an *allowlist key* referring to a pre-audited function —
// the LLM cannot inject arbitrary code. Evolution may mutate description /
// args schema, or register a new tool pointing at another allowlisted impl.

import { z } from "zod";
import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";
import { MemoryRegistry } from "./memory";

export type AllowlistKey =
  | "write_memory"
  | "search_memory"
  | "get_time";

export interface ToolImpl {
  implementationRef: AllowlistKey;
  argsSchema: Record<string, unknown>; // JSON Schema
}

export const ALLOWLIST: Record<AllowlistKey, { description: string; argsSchema: Record<string, unknown>; run: (agentId: string, args: Record<string, unknown>) => Promise<unknown> | unknown }> = {
  write_memory: {
    description: "Persist a single note about the user or conversation for future recall.",
    argsSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory to store." },
        tags:    { type: "array",  items: { type: "string" }, description: "Optional tags." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    run: async (agentId, args) => {
      const schema = z.object({ content: z.string(), tags: z.array(z.string()).optional() });
      const p = schema.parse(args);
      const { memoryId } = await MemoryRegistry.addMemory(agentId, p.content, p.tags ?? []);
      return { stored: true, id: memoryId };
    },
  },
  search_memory: {
    description: "Semantically search stored memories for this agent. Returns up to 5 relevant hits with similarity scores.",
    argsSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "number", description: "Max hits to return (default 5).", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (agentId, args) => {
      const schema = z.object({ query: z.string(), k: z.number().int().min(1).max(10).optional() });
      const p = schema.parse(args);
      const hits = await MemoryRegistry.searchSemantic(agentId, p.query, p.k ?? 5);
      return {
        hits: hits.map((h) => ({
          id: h.id,
          content: h.content,
          tags: h.tags,
          similarity: Number(h.similarity.toFixed(4)),
        })),
      };
    },
  },
  get_time: {
    description: "Return the current ISO-8601 UTC timestamp.",
    argsSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ now: new Date().toISOString() }),
  },
};

class ToolRegistryClass extends ContextManager {
  constructor() {
    super("tool");
  }

  installTool(agentId: string, name: string, ref: AllowlistKey): RegistrationRecord<ToolImpl> {
    const entry = ALLOWLIST[ref];
    return this.register({
      agentId,
      name,
      description: entry.description,
      learnable: true,
      impl: { implementationRef: ref, argsSchema: entry.argsSchema } satisfies ToolImpl,
      contract: { kind: "tool", argsSchema: entry.argsSchema, usage: entry.description },
    }) as RegistrationRecord<ToolImpl>;
  }

  listTools(agentId: string): RegistrationRecord<ToolImpl>[] {
    return this.list(agentId) as RegistrationRecord<ToolImpl>[];
  }

  async run(agentId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const rec = this.get(agentId, toolName);
    if (!rec) throw new Error(`tool ${toolName} not found`);
    const impl = rec.impl as ToolImpl;
    const entry = ALLOWLIST[impl.implementationRef];
    if (!entry) throw new Error(`impl ref ${impl.implementationRef} not on allowlist`);
    return entry.run(agentId, args);
  }
}

export const ToolRegistry = new ToolRegistryClass();
