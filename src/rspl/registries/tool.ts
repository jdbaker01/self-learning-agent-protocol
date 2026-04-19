// Tool registry. Tools are callable functions exposed to the LLM.
// Safety: the impl is an *allowlist key* referring to a pre-audited function —
// the LLM cannot inject arbitrary code. Evolution may mutate description /
// args schema, or register a new tool pointing at another allowlisted impl.

import { z } from "zod";
import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";
import { getDb } from "@/src/storage/db";
import { nanoid } from "nanoid";

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
      const id = `mem_${nanoid(12)}`;
      getDb()
        .prepare(
          `INSERT INTO resources (id, agent_id, entity_type, name, description, learnable, metadata)
           VALUES (?, ?, 'memory', ?, ?, 1, ?)`,
        )
        .run(id, agentId, `mem-${id.slice(0, 6)}`, p.content.slice(0, 120), JSON.stringify({ tags: p.tags ?? [] }));
      const verId = `ver_${nanoid(12)}`;
      getDb()
        .prepare(
          `INSERT INTO resource_versions (id, resource_id, version, impl, params, contract)
           VALUES (?, ?, '0.1.0', ?, '{}', ?)`,
        )
        .run(
          verId,
          id,
          JSON.stringify({ content: p.content, tags: p.tags ?? [] }),
          JSON.stringify({ kind: "retrieval", usage: "memory entry" }),
        );
      getDb()
        .prepare(`INSERT INTO resource_head (resource_id, version_id) VALUES (?, ?)`)
        .run(id, verId);
      return { stored: true, id };
    },
  },
  search_memory: {
    description: "Substring-search stored memories for this agent. Returns up to 10 hits.",
    argsSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (agentId, args) => {
      const schema = z.object({ query: z.string() });
      const p = schema.parse(args);
      type Row = { id: string; impl: string; description: string };
      const rows = getDb()
        .prepare<[string], Row>(
          `SELECT r.id, v.impl, r.description
           FROM resources r
           JOIN resource_head h ON h.resource_id = r.id
           JOIN resource_versions v ON v.id = h.version_id
           WHERE r.agent_id = ? AND r.entity_type = 'memory'
           ORDER BY r.created_at DESC`,
        )
        .all(agentId);
      const q = p.query.toLowerCase();
      const hits = rows
        .map((r) => ({
          id: r.id,
          content: (JSON.parse(r.impl) as { content: string }).content,
          description: r.description,
        }))
        .filter((r) => r.content.toLowerCase().includes(q))
        .slice(0, 10);
      return { hits };
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
