// Dynamic Manager (paper §3.1.4). Serialize/deserialize an entire agent's
// resource state for persistence, transfer, or hot-swapping without restart.

import { getDb } from "@/src/storage/db";

export interface AgentSnapshot {
  agentId: string;
  name: string;
  description: string;
  exportedAt: string;
  resources: Array<{
    entityType: string;
    name: string;
    description: string;
    learnable: boolean;
    metadata: unknown;
    head: {
      version: string;
      impl: unknown;
      params: unknown;
      contract: unknown;
    };
  }>;
}

export const DynamicManager = {
  saveToJson(agentId: string): AgentSnapshot {
    const db = getDb();
    const agent = db
      .prepare<[string], { name: string; description: string }>(
        `SELECT name, description FROM agents WHERE id = ?`,
      )
      .get(agentId);
    if (!agent) throw new Error(`agent ${agentId} not found`);

    type Row = {
      entity_type: string;
      name: string;
      description: string;
      learnable: number;
      metadata: string;
      version: string;
      impl: string;
      params: string;
      contract: string;
    };
    const resources = db
      .prepare<[string], Row>(
        `SELECT r.entity_type, r.name, r.description, r.learnable, r.metadata,
                v.version, v.impl, v.params, v.contract
         FROM resources r
         JOIN resource_head h ON h.resource_id = r.id
         JOIN resource_versions v ON v.id = h.version_id
         WHERE r.agent_id = ?
         ORDER BY r.created_at ASC`,
      )
      .all(agentId);

    return {
      agentId,
      name: agent.name,
      description: agent.description,
      exportedAt: new Date().toISOString(),
      resources: resources.map((r) => ({
        entityType: r.entity_type,
        name: r.name,
        description: r.description,
        learnable: r.learnable === 1,
        metadata: JSON.parse(r.metadata),
        head: {
          version: r.version,
          impl: JSON.parse(r.impl),
          params: JSON.parse(r.params),
          contract: JSON.parse(r.contract),
        },
      })),
    };
  },
};
