import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.SLAP_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.SLAP_DB_PATH ?? path.join(DATA_DIR, "slap.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src/storage/schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
  _db = db;
  return db;
}

/**
 * Run a function inside a transaction. Commits on success, rolls back on throw.
 */
export function withTx<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  const txn = db.transaction(fn);
  return txn(db);
}
