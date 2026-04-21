// Memory registry (M3). Memory resources are versioned like every other RSPL
// resource, plus a row in memory_embeddings keyed to the current version.
// Retrieval is cosine similarity over the agent's memory set — small enough
// to scan in TS (swap to libSQL vector index on deploy).

import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";
import { getDb } from "@/src/storage/db";
import {
  cosine,
  embedText,
  packEmbedding,
  unpackEmbedding,
} from "../infra/embeddings";

export interface MemoryImpl {
  content: string;
  tags: string[];
}

export interface MemoryHit {
  id: string;
  content: string;
  tags: string[];
  similarity: number;
}

interface EmbeddingRow {
  version_id: string;
  dim: number;
  embedding: Buffer;
}

class MemoryRegistryClass extends ContextManager {
  constructor() {
    super("memory");
  }

  listMemories(agentId: string): RegistrationRecord<MemoryImpl>[] {
    return this.list(agentId) as RegistrationRecord<MemoryImpl>[];
  }

  /**
   * Store a new memory. Embeds the content and persists the vector alongside
   * the resource's initial version.
   */
  async addMemory(
    agentId: string,
    content: string,
    tags: string[] = [],
    createdBy: string = "system",
  ): Promise<{ memoryId: string; version: string }> {
    const vec = await embedText(content);
    const rec = this.register({
      agentId,
      name: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      description: content.slice(0, 120),
      learnable: true,
      impl: { content, tags } satisfies MemoryImpl,
      contract: { kind: "retrieval", usage: "memory entry" },
      metadata: { tags },
      createdBy,
    });
    this.insertEmbedding(rec.id, vec);
    return { memoryId: rec.id, version: rec.version };
  }

  /**
   * Update a memory's content/tags. Bumps version and re-embeds.
   */
  async updateMemory(
    memoryId: string,
    patch: { content?: string; tags?: string[] },
    createdBy: string = "system",
  ): Promise<{ version: string }> {
    const current = this.getById(memoryId);
    if (!current) throw new Error(`memory ${memoryId} not found`);
    const impl = current.impl as MemoryImpl;
    const newContent = patch.content ?? impl.content;
    const newTags = patch.tags ?? impl.tags;

    const vec = await embedText(newContent);
    const rec = this.update(
      memoryId,
      { impl: { content: newContent, tags: newTags } },
      createdBy,
    );
    // insertEmbedding is keyed by the new version_id (head after update).
    this.insertEmbedding(memoryId, vec);
    return { version: rec.version };
  }

  /** Remove a memory and its embeddings (cascade via FK). */
  deleteMemory(memoryId: string): void {
    this.unregister(memoryId);
  }

  /** Cosine-top-k over the agent's memories. Returns sorted high→low. */
  async searchSemantic(
    agentId: string,
    queryText: string,
    k: number = 5,
    minSim: number = 0,
  ): Promise<MemoryHit[]> {
    const rows = this.listMemories(agentId);
    if (rows.length === 0) return [];
    const qvec = await embedText(queryText);
    const db = getDb();
    const hits: MemoryHit[] = [];
    for (const r of rows) {
      // Each memory resource has exactly one embedding row pointing at its head version.
      const head = db
        .prepare<[string], { version_id: string }>(
          `SELECT version_id FROM resource_head WHERE resource_id = ?`,
        )
        .get(r.id);
      if (!head) continue;
      const emb = db
        .prepare<[string], EmbeddingRow>(
          `SELECT version_id, dim, embedding FROM memory_embeddings WHERE version_id = ?`,
        )
        .get(head.version_id);
      if (!emb) continue;
      const v = unpackEmbedding(emb.embedding, emb.dim);
      const sim = cosine(qvec, v);
      if (sim >= minSim) {
        const impl = r.impl as MemoryImpl;
        hits.push({
          id: r.id,
          content: impl.content,
          tags: impl.tags,
          similarity: sim,
        });
      }
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, k);
  }

  /**
   * Upsert the embedding row for a resource's current head version.
   * Called after register / update — both advance the head pointer.
   */
  private insertEmbedding(resourceId: string, vector: number[]): void {
    const db = getDb();
    const head = db
      .prepare<[string], { version_id: string }>(
        `SELECT version_id FROM resource_head WHERE resource_id = ?`,
      )
      .get(resourceId);
    if (!head) throw new Error(`no head for ${resourceId}`);
    const blob = packEmbedding(vector);
    db.prepare(
      `INSERT OR REPLACE INTO memory_embeddings (version_id, dim, embedding) VALUES (?, ?, ?)`,
    ).run(head.version_id, vector.length, blob);
  }
}

export const MemoryRegistry = new MemoryRegistryClass();
