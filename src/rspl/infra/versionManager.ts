// Version Manager (paper §3.1.4). Thin facade — lineage + rollback live in
// resource_versions / resource_head (see schema.sql + ContextManager.update/restore).
// This module exposes read-only views for the UI.

import { getDb } from "@/src/storage/db";
import type { EntityType } from "../record";

export interface VersionEntry {
  resourceId: string;
  entityType: EntityType;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
  isHead: boolean;
}

export const VersionManager = {
  agentLineage(agentId: string): VersionEntry[] {
    const db = getDb();
    type Row = {
      resource_id: string;
      entity_type: EntityType;
      name: string;
      version: string;
      created_at: string;
      created_by: string;
      version_id: string;
      head_version_id: string | null;
    };
    const rows = db
      .prepare<[string], Row>(
        `SELECT r.id AS resource_id,
                r.entity_type,
                r.name,
                v.version,
                v.created_at,
                v.created_by,
                v.id AS version_id,
                h.version_id AS head_version_id
         FROM resource_versions v
         JOIN resources r     ON r.id = v.resource_id
         LEFT JOIN resource_head h ON h.resource_id = v.resource_id
         WHERE r.agent_id = ?
         ORDER BY v.created_at ASC`,
      )
      .all(agentId);
    return rows.map((r) => ({
      resourceId: r.resource_id,
      entityType: r.entity_type,
      name: r.name,
      version: r.version,
      createdAt: r.created_at,
      createdBy: r.created_by,
      isHead: r.version_id === r.head_version_id,
    }));
  },
};
