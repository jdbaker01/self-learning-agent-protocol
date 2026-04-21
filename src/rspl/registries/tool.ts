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
  | "get_time"
  | "count_words"
  | "get_date_offset"
  | "list_memories";

export const ALLOWLIST_KEYS: readonly AllowlistKey[] = [
  "write_memory",
  "search_memory",
  "get_time",
  "count_words",
  "get_date_offset",
  "list_memories",
] as const;

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
  count_words: {
    description: "Return the number of whitespace-delimited words in a text string.",
    argsSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    run: (_agentId, args) => {
      const p = z.object({ text: z.string() }).parse(args);
      const count = p.text.trim().length === 0 ? 0 : p.text.trim().split(/\s+/).length;
      return { count };
    },
  },
  get_date_offset: {
    description: "Return the ISO date (YYYY-MM-DD) offset from today by N days. Use for 'in X days', 'next week', scheduling.",
    argsSchema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Days from today; negative for past dates." },
      },
      required: ["days"],
      additionalProperties: false,
    },
    run: (_agentId, args) => {
      const p = z.object({ days: z.number().int() }).parse(args);
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + p.days);
      return { date: d.toISOString().slice(0, 10), days: p.days };
    },
  },
  list_memories: {
    description: "List all stored memories for this agent (no query). Returns up to 50 entries ordered by creation. Use when you need a full overview, not a targeted lookup.",
    argsSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (agentId) => {
      const rows = MemoryRegistry.listMemories(agentId);
      return {
        memories: rows.slice(0, 50).map((r) => {
          const impl = r.impl as { content: string; tags: string[] };
          return { id: r.id, content: impl.content, tags: impl.tags };
        }),
      };
    },
  },
};

class ToolRegistryClass extends ContextManager {
  constructor() {
    super("tool");
  }

  installTool(
    agentId: string,
    name: string,
    ref: AllowlistKey,
    overrides?: { description?: string; argsSchema?: Record<string, unknown> },
    createdBy: string = "system",
  ): RegistrationRecord<ToolImpl> {
    const entry = ALLOWLIST[ref];
    const description = overrides?.description ?? entry.description;
    const argsSchema = overrides?.argsSchema ?? entry.argsSchema;
    return this.register({
      agentId,
      name,
      description,
      learnable: true,
      impl: { implementationRef: ref, argsSchema } satisfies ToolImpl,
      contract: { kind: "tool", argsSchema, usage: description },
      createdBy,
    }) as RegistrationRecord<ToolImpl>;
  }

  /**
   * Edit description and/or argsSchema of an existing tool. implementation_ref
   * is immutable via update (use installTool + delete for a swap). Bumps version.
   */
  updateToolMeta(
    toolId: string,
    patch: { description?: string; argsSchema?: Record<string, unknown> },
    createdBy: string = "system",
  ): RegistrationRecord<ToolImpl> {
    const current = this.getById(toolId);
    if (!current) throw new Error(`tool ${toolId} not found`);
    const impl = current.impl as ToolImpl;
    const nextArgs = patch.argsSchema ?? impl.argsSchema;
    const nextDesc = patch.description ?? current.description;
    return this.update(
      toolId,
      {
        impl: { implementationRef: impl.implementationRef, argsSchema: nextArgs },
        description: nextDesc,
        contract: { kind: "tool", argsSchema: nextArgs, usage: nextDesc },
      },
      createdBy,
    ) as RegistrationRecord<ToolImpl>;
  }

  deleteTool(toolId: string): void {
    this.unregister(toolId);
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
