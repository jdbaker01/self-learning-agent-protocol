// Shared Context Manager operator set (paper §3.1.2, Table 7).
// Every entity-type registry implements this interface. The concrete registries
// (prompt/agent_policy/tool/env/memory) supply entity-specific impl.

import { nanoid } from "nanoid";
import { getDb, withTx } from "@/src/storage/db";
import type {
  EntityType,
  RegistrationRecord,
  ResourceEntity,
  ExportedContract,
} from "./record";

type Row = {
  id: string;
  agent_id: string;
  entity_type: EntityType;
  name: string;
  description: string;
  learnable: number;
  metadata: string;
};

type VersionRow = {
  id: string;
  resource_id: string;
  version: string;
  impl: string;
  params: string;
  contract: string;
};

function rowToEntity(r: Row): ResourceEntity {
  return {
    id: r.id,
    agentId: r.agent_id,
    entityType: r.entity_type,
    name: r.name,
    description: r.description,
    learnable: r.learnable === 1,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  };
}

function combine(r: Row, v: VersionRow): RegistrationRecord {
  return {
    ...rowToEntity(r),
    version: v.version,
    impl: JSON.parse(v.impl) as unknown,
    params: JSON.parse(v.params) as Record<string, unknown>,
    contract: JSON.parse(v.contract) as ExportedContract,
  };
}

export interface RegisterArgs {
  agentId: string;
  name: string;
  description?: string;
  learnable?: boolean;
  metadata?: Record<string, unknown>;
  impl: unknown;
  params?: Record<string, unknown>;
  contract: ExportedContract;
  version?: string; // defaults to 0.1.0
}

/**
 * Bump a semver-ish version string on the `patch` axis. Falls back to `1.0.0`.
 */
function bumpPatch(v: string): string {
  const [maj, min, pat] = v.split(".").map((n) => Number.parseInt(n, 10));
  if ([maj, min, pat].some(Number.isNaN)) return "1.0.0";
  return `${maj}.${min}.${pat + 1}`;
}

/**
 * Abstract Context Manager. Concrete registries extend this to expose
 * entity-type-specific helpers on top of the shared operator set.
 */
export class ContextManager {
  readonly entityType: EntityType;

  constructor(entityType: EntityType) {
    this.entityType = entityType;
  }

  /** register: create a new resource + initial version. */
  register(args: RegisterArgs): RegistrationRecord {
    return withTx((db) => {
      const resourceId = `res_${nanoid(12)}`;
      const versionId = `ver_${nanoid(12)}`;
      const version = args.version ?? "0.1.0";

      db.prepare(
        `INSERT INTO resources (id, agent_id, entity_type, name, description, learnable, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        resourceId,
        args.agentId,
        this.entityType,
        args.name,
        args.description ?? "",
        args.learnable === false ? 0 : 1,
        JSON.stringify(args.metadata ?? {}),
      );

      db.prepare(
        `INSERT INTO resource_versions (id, resource_id, version, impl, params, contract)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        versionId,
        resourceId,
        version,
        JSON.stringify(args.impl),
        JSON.stringify(args.params ?? {}),
        JSON.stringify(args.contract),
      );

      db.prepare(
        `INSERT INTO resource_head (resource_id, version_id) VALUES (?, ?)`,
      ).run(resourceId, versionId);

      return this.getById(resourceId)!;
    });
  }

  /** unregister: remove resource and all its versions. */
  unregister(resourceId: string): void {
    getDb().prepare("DELETE FROM resources WHERE id = ?").run(resourceId);
  }

  /** get: load the current head version of a resource by name. */
  get(agentId: string, name: string): RegistrationRecord | null {
    const db = getDb();
    const row = db
      .prepare<[string, EntityType, string], Row>(
        `SELECT * FROM resources WHERE agent_id = ? AND entity_type = ? AND name = ?`,
      )
      .get(agentId, this.entityType, name);
    if (!row) return null;
    return this.getById(row.id);
  }

  /** get_info: return just the registration shell without the impl payload. */
  getInfo(agentId: string, name: string): ResourceEntity | null {
    const db = getDb();
    const row = db
      .prepare<[string, EntityType, string], Row>(
        `SELECT * FROM resources WHERE agent_id = ? AND entity_type = ? AND name = ?`,
      )
      .get(agentId, this.entityType, name);
    return row ? rowToEntity(row) : null;
  }

  /** get by id: resolves the current head version row. */
  getById(resourceId: string): RegistrationRecord | null {
    const db = getDb();
    const row = db
      .prepare<[string], Row>(`SELECT * FROM resources WHERE id = ?`)
      .get(resourceId);
    if (!row) return null;
    const head = db
      .prepare<[string], { version_id: string }>(
        `SELECT version_id FROM resource_head WHERE resource_id = ?`,
      )
      .get(resourceId);
    if (!head) return null;
    const ver = db
      .prepare<[string], VersionRow>(
        `SELECT * FROM resource_versions WHERE id = ?`,
      )
      .get(head.version_id);
    if (!ver) return null;
    return combine(row, ver);
  }

  /** list: all resources of this type for an agent. */
  list(agentId: string): RegistrationRecord[] {
    const db = getDb();
    const rows = db
      .prepare<[string, EntityType], Row>(
        `SELECT * FROM resources WHERE agent_id = ? AND entity_type = ? ORDER BY created_at ASC`,
      )
      .all(agentId, this.entityType);
    return rows
      .map((r) => this.getById(r.id))
      .filter((x): x is RegistrationRecord => x !== null);
  }

  /**
   * set_variables / update: mutate a resource in-place by writing a new version
   * and advancing the head pointer. Returns the new head record.
   */
  update(
    resourceId: string,
    patch: Partial<{
      impl: unknown;
      params: Record<string, unknown>;
      contract: ExportedContract;
      description: string;
      metadata: Record<string, unknown>;
    }>,
    createdBy: string = "system",
  ): RegistrationRecord {
    return withTx((db) => {
      const current = this.getById(resourceId);
      if (!current) throw new Error(`resource ${resourceId} not found`);

      if (patch.description !== undefined || patch.metadata !== undefined) {
        db.prepare(
          `UPDATE resources SET
             description = COALESCE(?, description),
             metadata    = COALESCE(?, metadata)
           WHERE id = ?`,
        ).run(
          patch.description ?? null,
          patch.metadata !== undefined ? JSON.stringify(patch.metadata) : null,
          resourceId,
        );
      }

      const nextImpl     = patch.impl     !== undefined ? patch.impl     : current.impl;
      const nextParams   = patch.params   !== undefined ? patch.params   : current.params;
      const nextContract = patch.contract !== undefined ? patch.contract : current.contract;

      const versionId = `ver_${nanoid(12)}`;
      const nextVersion = bumpPatch(current.version);

      db.prepare(
        `INSERT INTO resource_versions (id, resource_id, version, impl, params, contract, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        versionId,
        resourceId,
        nextVersion,
        JSON.stringify(nextImpl),
        JSON.stringify(nextParams),
        JSON.stringify(nextContract),
        createdBy,
      );

      db.prepare(
        `UPDATE resource_head SET version_id = ? WHERE resource_id = ?`,
      ).run(versionId, resourceId);

      return this.getById(resourceId)!;
    });
  }

  /** restore: advance head back to an older version. */
  restore(resourceId: string, version: string): RegistrationRecord {
    return withTx((db) => {
      const row = db
        .prepare<[string, string], { id: string }>(
          `SELECT id FROM resource_versions WHERE resource_id = ? AND version = ?`,
        )
        .get(resourceId, version);
      if (!row) throw new Error(`no such version ${version}`);
      db.prepare(
        `UPDATE resource_head SET version_id = ? WHERE resource_id = ?`,
      ).run(row.id, resourceId);
      return this.getById(resourceId)!;
    });
  }

  /** get_variables: return the current evolvable payload (impl + contract). */
  getVariables(resourceId: string): { impl: unknown; contract: ExportedContract } {
    const rec = this.getById(resourceId);
    if (!rec) throw new Error(`resource ${resourceId} not found`);
    return { impl: rec.impl, contract: rec.contract };
  }

  /** versions: list the full version lineage for a resource. */
  versions(resourceId: string): Array<{ version: string; createdAt: string; createdBy: string }> {
    const db = getDb();
    const rows = db
      .prepare<[string], { version: string; created_at: string; created_by: string }>(
        `SELECT version, created_at, created_by FROM resource_versions
         WHERE resource_id = ? ORDER BY created_at ASC`,
      )
      .all(resourceId);
    return rows.map((r) => ({
      version: r.version,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
  }
}
