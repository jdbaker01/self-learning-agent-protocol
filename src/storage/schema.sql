-- Self-Learning Agent Protocol storage schema.
-- Mirrors RSPL registration records (paper §3.1.1 Def C.2) and SEPL run logs.

-- Agents: top-level container. An agent is a bundle of (Prompt, AgentPolicy, Tools, Memory).
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- RSPL registration records. One row = one resource instance (across all 5 types).
--   entity_type: 'prompt' | 'agent_policy' | 'tool' | 'env' | 'memory'
--   name       : unique within (agent_id, entity_type)
--   impl       : JSON; source/config blob (prompt text, tool ref + args schema, etc.)
--   params     : JSON; constructor parameters
--   contract   : JSON; exported representations (function-calling schema, natural-language contract)
--   learnable  : 0|1; whether SEPL may mutate it
--   metadata   : JSON; auxiliary metadata
-- Versions are stored in resource_versions, current head in agents_head.
CREATE TABLE IF NOT EXISTS resources (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('prompt','agent_policy','tool','env','memory')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  learnable     INTEGER NOT NULL DEFAULT 1,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(agent_id, entity_type, name),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resources_agent_type ON resources(agent_id, entity_type);

-- Version lineage. Every `set_variables`/`update` creates a new row.
CREATE TABLE IF NOT EXISTS resource_versions (
  id            TEXT PRIMARY KEY,
  resource_id   TEXT NOT NULL,
  version       TEXT NOT NULL,                           -- semver-ish "0.1.0"
  impl          TEXT NOT NULL,                           -- JSON
  params        TEXT NOT NULL DEFAULT '{}',              -- JSON
  contract      TEXT NOT NULL DEFAULT '{}',              -- JSON
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by    TEXT NOT NULL DEFAULT 'system',          -- 'system' | 'sepl:<learn_run_id>'
  UNIQUE(resource_id, version),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resource_versions_resource ON resource_versions(resource_id);

-- Current head version per resource (the one the runtime loads).
CREATE TABLE IF NOT EXISTS resource_head (
  resource_id   TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id)  REFERENCES resource_versions(id) ON DELETE CASCADE
);

-- Embeddings per memory version (M3). Keyed to resource_versions.id so a new
-- version automatically gets its own row. Vector is a packed Float32Array as
-- a BLOB; we do cosine in TS over the agent's memory set, which is small
-- enough for this app. Swap in a libSQL vector index when we deploy.
CREATE TABLE IF NOT EXISTS memory_embeddings (
  version_id    TEXT PRIMARY KEY,
  dim           INTEGER NOT NULL,
  embedding     BLOB NOT NULL,
  FOREIGN KEY (version_id) REFERENCES resource_versions(id) ON DELETE CASCADE
);

-- Chat sessions. One session = one contiguous conversation window, ended before Learn.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','ended','learned')) DEFAULT 'open',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at      TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

-- Turn = one user message + one assistant response (with any tool calls in between).
CREATE TABLE IF NOT EXISTS turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  user_message  TEXT NOT NULL,
  assistant_message TEXT NOT NULL DEFAULT '',
  feedback      TEXT,  -- 'up' | 'down' | NULL
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(session_id, idx),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);

-- Traces: full execution record for a turn (Z in the paper). JSON blob with tool calls, latencies, errors.
CREATE TABLE IF NOT EXISTS traces (
  id            TEXT PRIMARY KEY,
  turn_id       TEXT NOT NULL,
  payload       TEXT NOT NULL, -- JSON
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_traces_turn ON traces(turn_id);

-- Learn runs: one invocation of the SEPL loop. Records the full audit lineage.
CREATE TABLE IF NOT EXISTS learn_runs (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  hypotheses    TEXT NOT NULL DEFAULT '[]',  -- JSON H
  proposals     TEXT NOT NULL DEFAULT '[]',  -- JSON D
  evaluation    TEXT NOT NULL DEFAULT '{}',  -- JSON S (rule gates + judge scores)
  commit_decisions TEXT NOT NULL DEFAULT '[]', -- JSON per-proposal accept/reject + reason
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learn_runs_agent ON learn_runs(agent_id);
