// Embedding utilities (M3). Wraps the Model Manager's embedder and provides
// cosine similarity plus pack/unpack helpers for SQLite BLOB storage.

import { embed, embedMany } from "ai";
import { ModelManager } from "./modelManager";

/** Float32 packed as a Buffer for BLOB storage. */
export function packEmbedding(v: number[]): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

export function unpackEmbedding(blob: Buffer, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = blob.readFloatLE(i * 4);
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Single-text embedding. Returns a plain number[]. */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: ModelManager.embedder(),
    value: text,
  });
  return embedding;
}

/** Batch-embed. Returns an array of number[] in input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: ModelManager.embedder(),
    values: texts,
  });
  return embeddings;
}
