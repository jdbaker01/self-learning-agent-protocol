# Implementation Plan: Self-Learning Agent Protocol

This document implements the **Autogenesis Protocol (AGP)** from *"Autogenesis: A Self-Evolving Agent Protocol"* (arXiv:2604.15034), scoped to a single-user web app where you create an agent from a description, chat with it in sessions, and — at the end of a session — click **Learn** to run the SEPL evolutionary loop.

---

## 1. What we are building (user-facing)

Three screens:

1. **Agents list / Create Agent** — form: name, one-paragraph description ("act as my recipe coach"). On submit, the backend bootstraps an RSPL agent (prompt + starter tools + empty memory) and returns an `agent_id`.
2. **Chat view** — conversational UI for a given `agent_id`. Sidebar shows the agent's current **evolvable state** (prompt, tools, memory) and a **version timeline**. The session is a contiguous set of turns. An **End Session** button closes the session and exposes a **Learn** button.
3. **Learn view** — clicked after a session ends. Runs the SEPL loop **foreground** and **streams each step visibly**:
   - *Step 1 — Reflect:* streaming the hypotheses (`H`) the model derived from the session trace.
   - *Step 2 — Select:* streaming the concrete modification proposals (`D`) per hypothesis.
   - *Step 3 — Improve:* shows a diff of each candidate change applied to the evolvable state.
   - *Step 4 — Evaluate:* shows rule-gate results and the LLM-judge replay scores on the held-out turns from the session.
   - *Step 5 — Commit:* accept/reject decision per proposal, with reason. Accepted proposals bump the version; rejected ones disappear.
   After Learn finishes, the user returns to the chat view (now on version `v+1`) and starts a new session.

Fourth screen (included for auditability, since the paper emphasizes it): **Trace/Version viewer** — browse prior sessions, their traces `Z`, the hypotheses, proposals, eval results, and commit outcomes for each Learn run.

---

## 2. Mapping the paper onto this app

### Layer 1 — RSPL (Resource Substrate Protocol Layer)

Five resource types, all versioned and stored in a registry:

| Entity type | In this app | Evolvable in v1? |
|---|---|---|
| **Prompt** | System prompt for the agent | Yes |
| **Agent** | Decision policy (model choice, tool-use strategy, reply style) | Yes |
| **Tool** | Callable functions (starter set: `search_memory`, `write_memory`, `get_time`). Tools can be edited or newly created from an allowlist | Yes |
| **Environment** | The chat session (user, transcript, inferred intent per turn) | No — observed only |
| **Memory** | Persistent notes retrievable by semantic search | Yes |

Each resource is a `RegistrationRecord` (paper §3.1.1):
`{ name, description, version, implementation, constructor_params, exported_representations, learnability_flag, metadata }`.

Every resource lives in a **type-specific registry** with a **context manager** exposing the operator set from Table 7: `init`, `build`, `register`, `unregister`, `get`, `get_info`, `list`, `retrieve` (semantic search), `update`, `copy`, `restore`, `get_variables`, `set_variables`, `run`, `save_contract`, `load_contract`, `save_to_json`, `load_from_json`.

Infrastructure services (paper §3.1.4):
- **Model Manager** — provider-agnostic wrapper. v1 uses **OpenAI** via the Vercel `ai` SDK (easy multi-provider). Tiered model routing:
  - `chat`: `gpt-4.1-mini` (fast, cheap per turn)
  - `reflect`/`select` (hard reasoning in SEPL): `gpt-4.1`
  - `judge` (evaluation replay): `gpt-4.1-mini`
  - `embed` (memory retrieval): `text-embedding-3-small`
  All four are config-swappable; switching to Anthropic or a local model is one adapter change.
- **Version Manager** — every `set_variables`/`update` auto-increments a semver string, snapshots the config, stores for rollback.
- **Dynamic Manager** — serialization so resources hot-swap without restarting.
- **Tracer** — records full turn traces (user msg, tool calls, tool results, final reply, latency, errors, embeddings used).

### Layer 2 — SEPL (Self-Evolution Protocol Layer)

Triggered by the **Learn** button at end of session. Input: trace `Z` of all turns in the session + current `V_evo`. Output: a new committed version (or no change). The UI streams each operator's output.

- **Reflect (ρ)**: `gpt-4.1` reads the session trace and current `V_evo`, returns structured hypotheses `H` about failure modes / improvement opportunities, scoped to the three evolvable surfaces (prompt, tools, memory). Example: `{area: "memory", issue: "user stated dietary restriction in turn 2 but agent didn't persist it", severity: 0.9}`.
- **Select (σ)**: `gpt-4.1` translates each hypothesis into a concrete modification proposal `D` using a **typed proposal schema**:
  - `update_prompt { diff: string }`
  - `write_memory { content: string, tags: string[] }`
  - `update_memory { id: string, content: string }`
  - `delete_memory { id: string }`
  - `update_tool { name: string, field: "description"|"args_schema"|"instructions", value: any }`
  - `create_tool { name: string, description: string, args_schema: JSONSchema, implementation_ref: AllowlistKey }`
- **Improve (ι)**: apply each proposal via the corresponding RSPL `set_variables` / `register`, producing a **candidate** `V'_evo` (new version, not yet committed).
- **Evaluate (ε)**: layered objective:
  1. **Rule gates** (safety invariants): prompt ≤ N tokens, tool JSON schemas validate, no secret-leak phrases removed, memory entries don't exceed budget, tool implementation refs in allowlist.
  2. **LLM-judge replay**: rerun the last K turns from the session under `V'_evo` and score each candidate reply against the committed reply on (helpfulness, faithfulness, format) using `gpt-4.1-mini` as judge. Aggregate score must be ≥ baseline (monotonic improvement, per paper §3.2.2).
  3. **Explicit user feedback**: thumbs on individual replies (if present) heavily weight the eval.
- **Commit (κ)**: accept iff rule gates pass AND aggregate eval ≥ baseline. On accept, Version Manager bumps version. On reject, candidate is discarded (rollback is free — nothing was ever promoted).

Per the paper, each accepted commit is a versioned transition with auditable lineage: the trace, hypotheses, proposals, eval results, and commit decision are all persisted as part of the version record.

---

## 3. Architecture (TypeScript end-to-end, Vercel-ready)

Next.js App Router (TypeScript) is both the frontend and the backend. API routes handle agent CRUD, chat streaming, and Learn. Database: SQLite locally (via `better-sqlite3`) with the same schema expressed as migrations so we can swap to Turso (libSQL) or Neon Postgres on Vercel without code changes.

```
┌──────────────────────────────────────────────────────────┐
│  Next.js (React, App Router, TypeScript)                 │
│    UI                                                     │
│      /agents               (list + create form)          │
│      /agents/[id]/chat     (streaming chat + sidebar)    │
│      /agents/[id]/learn    (SEPL step-by-step stream)    │
│      /agents/[id]/history  (traces & versions)           │
│    API routes (server, same deploy)                      │
│      POST /api/agents                                    │
│      GET  /api/agents[/:id]                              │
│      POST /api/agents/:id/sessions                       │
│      POST /api/sessions/:id/chat       (SSE streaming)   │
│      POST /api/sessions/:id/end                          │
│      POST /api/sessions/:id/learn      (SSE streaming)   │
│      GET  /api/agents/:id/state                          │
│      GET  /api/agents/:id/versions                       │
│      GET  /api/agents/:id/traces                         │
├──────────────────────────────────────────────────────────┤
│  Domain modules (imported by API routes)                 │
│    src/rspl/                                             │
│      record.ts          RegistrationRecord types          │
│      contextManager.ts  shared operator interface         │
│      registries/        prompt.ts agent.ts tool.ts       │
│                         env.ts memory.ts                 │
│      infra/             modelManager.ts versionManager.ts│
│                         dynamicManager.ts tracer.ts      │
│    src/sepl/                                             │
│      loop.ts            Algorithm 1 orchestrator         │
│      reflect.ts         ρ                                │
│      select.ts          σ                                │
│      improve.ts         ι                                │
│      evaluate.ts        ε (rule gates + judge)           │
│      commit.ts          κ                                │
│    src/runtime/                                          │
│      bootstrap.ts       create_agent_from_description()  │
│      chat.ts            one-turn executor                │
│    src/storage/                                          │
│      db.ts              SQLite via better-sqlite3        │
│      schema.sql         tables + indexes                 │
│      adapters/          sqlite.ts, libsql.ts (Turso)    │
└──────────────────────────────────────────────────────────┘
```

### Why these choices

- **TypeScript end-to-end**: deploys cleanly to Vercel with no cross-service plumbing. Single repo, single runtime, single deploy pipeline. Frontend types and API types share source.
- **Vercel `ai` SDK** for the Model Manager adapter: first-class streaming, provider-agnostic (OpenAI today, Anthropic/local tomorrow with one config line), tool-use support.
- **SQLite locally, libSQL-compatible on Vercel**: `better-sqlite3` for local dev (synchronous, no server process). Schema is portable to Turso (libSQL is SQLite-compatible with serverless access) when we deploy. Alternative: Neon Postgres if we outgrow SQLite, but a single-user app won't.
- **Foreground Learn with step streaming**: directly answers "push-button Learn with enumerated steps". We stream each operator's output via SSE so the user watches ρ → σ → ι → ε → κ happen.
- **Session boundary**: a session is a contiguous chat window. Reflect operates over the whole session trace, which gives the optimizer enough signal (vs. per-turn noise).

---

## 4. Repo layout

```
self-learning-agent-protocol/
├── app/                        # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                # agents list
│   ├── agents/
│   │   ├── new/page.tsx        # create form
│   │   └── [id]/
│   │       ├── chat/page.tsx
│   │       ├── learn/page.tsx
│   │       └── history/page.tsx
│   └── api/
│       ├── agents/route.ts
│       ├── agents/[id]/route.ts
│       ├── agents/[id]/state/route.ts
│       ├── agents/[id]/versions/route.ts
│       ├── agents/[id]/traces/route.ts
│       ├── agents/[id]/sessions/route.ts
│       ├── sessions/[sid]/chat/route.ts
│       ├── sessions/[sid]/end/route.ts
│       └── sessions/[sid]/learn/route.ts
├── src/
│   ├── rspl/
│   │   ├── record.ts
│   │   ├── contextManager.ts
│   │   ├── registries/
│   │   │   ├── prompt.ts
│   │   │   ├── agent.ts
│   │   │   ├── tool.ts
│   │   │   ├── env.ts
│   │   │   └── memory.ts
│   │   └── infra/
│   │       ├── modelManager.ts
│   │       ├── versionManager.ts
│   │       ├── dynamicManager.ts
│   │       └── tracer.ts
│   ├── sepl/
│   │   ├── loop.ts
│   │   ├── reflect.ts
│   │   ├── select.ts
│   │   ├── improve.ts
│   │   ├── evaluate.ts
│   │   └── commit.ts
│   ├── runtime/
│   │   ├── bootstrap.ts
│   │   └── chat.ts
│   ├── storage/
│   │   ├── db.ts
│   │   ├── schema.sql
│   │   └── adapters/
│   │       ├── sqlite.ts
│   │       └── libsql.ts
│   └── lib/
│       ├── types.ts
│       └── streaming.ts
├── components/
│   ├── Chat.tsx
│   ├── StateSidebar.tsx
│   ├── VersionTimeline.tsx
│   ├── LearnStream.tsx        # ρ/σ/ι/ε/κ step UI
│   └── DiffViewer.tsx
├── tests/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── vercel.json
└── PLAN.md
```

---

## 5. Key design decisions

1. **Bootstrap from a description**. `createAgentFromDescription(desc)` issues a structured LLM call that returns: initial system prompt, starter tool list (from an allowlist), initial agent policy, empty memory, learnability flags. Versions start at `0.1.0`.

2. **Full evolvable surface in v1** — prompt, memory, and tools all evolvable from day one (per your direction). Tool *editing* is always safe (we're mutating descriptions/args, not code). Tool *creation* is restricted to an **allowlist of implementation refs** — a set of pre-audited JS functions like `search_memory`, `write_memory`, `web_search`, `fetch_url`, `calculator`, `code_eval_sandboxed`. The agent cannot inject arbitrary JS — it can only compose/configure allowlisted building blocks. This preserves safety without closing the door on expressive tool evolution. Arbitrary code execution for tools is explicitly out of v1 scope.

3. **Evaluation is the riskiest primitive** (see §6 M1.5 — validated before M2 starts). LLM-judge replay on the session's held-out turns, required monotonic improvement, user thumbs as strong override. Rule gates always hard-block.

4. **Safety invariants** as hard rule gates (paper §3.2.2): prompt size budget, tool schema validation, required-section preservation (e.g., "never reveal system prompt"), memory entry budget, implementation refs in allowlist.

5. **Learn is foreground, streamed, and auditable**. Not async. The user sees every operator's input and output on the Learn screen. Every run — accepted or rejected — is persisted as a `learn_run` record linked to the session and any versions it produced. The History screen reproduces this view for any past run.

6. **Single-user, localhost for v1** — no auth. Vercel deploy adds a single shared-secret header (env var) for basic gating when we move off localhost.

---

## 6. Milestones

- **M1 — RSPL core + static agent, no evolution.**
  Registries, context manager operator set (Table 7), Model Manager with OpenAI adapter, Version Manager, Tracer. `createAgentFromDescription` produces a working agent. Chat route streams replies, tools work (`search_memory`/`write_memory` via allowlist), traces recorded. UI: agent create + chat.

- **M1.5 — Evaluation spike.** ✅ **Done.**
  Stood up ε (rule gates + LLM-judge replay) against canned session traces. Initial pairwise judge at temperature=0 hit 67% commit-decision agreement — failing. Applied three remediations: (a) N=3 votes per turn with alternating A/B positions and majority-vote collapse, (b) a stricter rubric biasing toward "tie" on near-equivalent replies, and (c) dimension-wise monotonic commit rule (commit iff strict improvement on ≥1 dimension AND no regression on any dimension) instead of pooled raw scores. Result: **100% commit-decision agreement across 3 runs** on `recipe_coach_v1`. Exit criterion met. See `src/sepl/evaluate.ts`, `src/sepl/fixtures.ts`, `scripts/eval-spike.ts` (`npm run eval-spike`).

- **M2 — SEPL loop (prompt-only evolution).** ✅ **Done.**
  ρ/σ/ι/ε/κ wired, restricted to `update_prompt` proposals. End-and-learn button on chat view navigates to the Learn page, which opens an SSE stream from `POST /api/sessions/[sid]/learn` and renders each operator's output live (hypotheses, proposal + rationale, before/after diff, evaluate progress, commit decision). Every run persists to `learn_runs` with full audit (hypotheses, proposals, evaluation, commit decisions). Prompt versions bump via `PromptRegistry.updateText(..., "sepl:<learn_run_id>")` on accept; candidates that fail rule gates or aren't strict improvements are discarded. Verified end-to-end in preview: 2 hypotheses → coherent proposal → judge=equivalent → correctly rejected.

- **M3 — Memory as evolvable resource.** ✅ **Done.**
  Memory registry upgraded from substring stub to embedding-based cosine search (`text-embedding-3-small`), backed by a `memory_embeddings` table (version_id → packed Float32 BLOB). Each memory write/update re-embeds; delete cascades via FK. Chat runtime auto-injects top-5 semantic matches above cosine ≥ 0.3 into the system prompt for every turn — the agent gets durable user facts without having to `search_memory` explicitly. SEPL now produces a `ProposalBundle` (optional `update_prompt` + array of `write_memory`/`update_memory`/`delete_memory` ops); Reflect can tag hypotheses as `prompt` or `memory` and Select emits the matching structured ops. Commit applies all ops atomically with `createdBy="sepl:<learn_run_id>"`. Verified in preview on a Fitness Coach agent: SEPL identified that "5K in June" was not persisted, wrote the memory, evaluator scored candidate_better (h=3 vs 0), committed.

- **M4 — Tool evolution.** ✅ **Done.**
  Tool descriptions / args schemas are editable via `update_tool` proposals; new tools can be installed via `create_tool` against the implementation-ref allowlist (extended to include `count_words`, `get_date_offset`, `list_memories` alongside the starter `write_memory`/`search_memory`/`get_time`). Rule gates enforce allowlist membership, schema shape (`type:"object"`), tool-count budget, description bounds, and name uniqueness. Hypothesis area widens to `prompt | memory | tool`. `ProposalBundle` gains `toolOps: ToolProposal[]`. Because prompt-only replay can't manifest the value of tool changes, the loop applies a narrow override: tool-only bundles commit on rule-gates + no-regression rather than requiring strict judge improvement. Verified end-to-end in preview on an Event Planner agent: Reflect caught that the agent was doing date math by hand, Select proposed `create_tool get_date_offset`, Evaluate passed rule gates, Commit accepted (`createdBy=sepl:<id>`).

- **M5 — UI polish.** ✅ **Done.**
  Agent list shows per-agent stats (prompt version, session / learn / memory / tool counts) with chat + history links. Each agent has a `/history` index listing every session and every learn run with status badges (open/ended/learned; committed/rejected/failed). Sessions open into a read-only viewer showing turn-by-turn user + assistant text, model id, latency, and expandable tool-call audit. Learn runs open into an archive viewer that replays the full ρ→σ→ι→ε→κ output from the persisted `learn_runs` row (hypotheses with area badge, typed proposals, judge wins, commit decision with per-op outcomes). The state sidebar now links `sepl:<learn_run_id>` attributions directly to the corresponding archive viewer, so you can click from the version timeline straight to the SEPL run that produced any head version.

- **M6 — Eval harness** — synthetic multi-session conversations (scripted personas) for regression testing: does the loop actually converge on a better agent over N sessions? Report aggregate win-rate of version `vN+1` vs `vN` across personas. This is where we validate that self-evolution actually improves the agent.

- **M7 — Vercel deploy.** libSQL adapter (Turso), env-var API key management, single-secret gating. Smoke test full flow in production.

Each milestone ships the app still runnable end-to-end.

---

## 7. Confirmed decisions

1. Model provider: **OpenAI**, tiered (`gpt-4.1` for Reflect/Select; `gpt-4.1-mini` for chat/judge; `text-embedding-3-small` for memory). Vercel `ai` SDK as adapter.
2. Frontend: **Next.js + Tailwind + shadcn/ui**.
3. Evolvable surface in v1: **prompt + memory + tools** (staged across M2–M4).
4. Cadence: **foreground Learn button at end of session**, step-by-step streamed UI.
5. Persistence: **SQLite locally**, libSQL-compatible schema for Vercel.
6. Deployment target: **localhost for dev, Vercel for prod**.
7. M1.5 eval spike: **in**, gates entry to M2.

Ready to start M1.
