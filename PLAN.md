# Implementation Plan: Self-Learning Agent Protocol

This document proposes an implementation of the **Autogenesis Protocol (AGP)** from *"Autogenesis: A Self-Evolving Agent Protocol"* (arXiv:2604.15034), scoped to a single-user web app where you create an agent from a description and chat with it, and the agent improves with every turn.

---

## 1. What we are building (user-facing)

A web app with two screens:

1. **Agents list / Create Agent** — a form: name, one-paragraph description of what the agent should do ("act as my recipe coach", "help me write Go code", etc.). On submit, the backend bootstraps an RSPL agent (prompt + tool contract + empty memory) and returns an `agent_id`.
2. **Chat view** — conversational UI for a given `agent_id`. Beside the transcript, a sidebar shows the agent's current **evolvable state** — prompt text, tools, memory entries, and a version timeline. Each turn, after the response is streamed back, a small "Evolving…" indicator runs while the SEPL loop reflects on the turn, proposes updates, evaluates them, and commits (or rolls back). A "diff" badge on the version timeline lets you inspect what the agent just changed about itself.

Optional third screen (nice-to-have, not v1): **Trace viewer** showing observational traces (Z), hypotheses (H), proposals (D), evaluation scores (S), commit decisions (κ) — the auditable lineage the paper emphasizes.

---

## 2. Mapping the paper onto this app

The paper defines two protocol layers. We implement both, scoped to what a chat agent needs:

### Layer 1 — RSPL (Resource Substrate Protocol Layer)

Five resource types, all versioned and stored in a registry:

| Entity type | In this app | Evolvable? |
|---|---|---|
| **Prompt** | System prompt for the agent | Yes |
| **Agent** | Decision policy (model choice, tool-use strategy, reply style rubric) | Yes |
| **Tool** | Callable functions the agent can invoke — start with `search_memory`, `write_memory`, `get_time`; tools can be added/edited during evolution | Yes |
| **Environment** | The chat session (user, transcript, task intent inferred each turn) | No — observed, not mutated |
| **Memory** | Persistent notes about the user and prior turns, retrievable by semantic search | Yes |

Each resource is a `RegistrationRecord` (paper §3.1.1):
- `name`, `description`, `version`, `implementation` (source/config), `constructor_params`, `exported_representations` (JSON schema / natural-language contract for the LLM), `learnability_flag`, `metadata`.

Every resource lives in a **type-specific registry** with a **context manager** exposing the operator set from Table 7: `init`, `build`, `register`, `unregister`, `get`, `list`, `retrieve` (semantic search), `update`, `copy`, `restore`, `get_variables`, `set_variables`, `run`, `save_contract`, `load_contract`, `save_to_json`, `load_from_json`.

Infrastructure services (paper §3.1.4):
- **Model Manager** — thin wrapper over the Anthropic SDK (default) with provider-agnostic interface so we can swap later.
- **Version Manager** — every `set_variables`/`update` auto-increments a semver string, snapshots the config, and stores it for rollback.
- **Dynamic Manager** — serialization so resources can be hot-swapped without restarting the app.
- **Tracer** — records full turn traces (user msg, tool calls, tool results, final reply, latency, errors).

### Layer 2 — SEPL (Self-Evolution Protocol Layer)

After every user turn (or a configurable cadence like "every 3 turns" to keep latency down), run the **reflection-driven optimizer** (paper §4.2, Algorithm 1) as the default SEPL instantiation:

- **Reflect (ρ)** — LLM call that takes the trace `Z` and the current evolvable state `V_evo`, returns structured **hypotheses** `H` about what went wrong or could improve. Example outputs: `{area: "prompt", issue: "no instruction to ask clarifying questions before suggesting recipes", severity: 0.7}`.
- **Select (σ)** — LLM call that turns each hypothesis into a **concrete modification proposal** `D`: `{op: "update_prompt", diff: "+ If the user's request is ambiguous, ask one clarifying question before responding."}` or `{op: "write_memory", content: "User prefers vegetarian meals."}` or `{op: "create_tool", spec: {...}}`.
- **Improve (ι)** — apply proposals via RSPL `set_variables` / `register`, producing a **candidate** `V'_evo` that is a new version, not yet committed.
- **Evaluate (ε)** — score the candidate. For a chat agent we cannot rerun the whole conversation deterministically, so we use a layered objective:
  1. **Rule gates** (safety invariants from the paper): prompt length within limits, tool schema valid, no secrets leaked, candidate doesn't remove mandatory sections.
  2. **LLM-as-judge** replay on a **held-out mini-eval set** built from the last N turns: compare candidate-state response against committed-state response on each turn, score on helpfulness/faithfulness/format. A candidate must meet or exceed baseline on aggregate.
  3. **Explicit user feedback** if present (thumbs up/down on the last reply) — weighted heavily.
- **Commit (κ)** — gating function. Accept iff rule gates pass AND eval score ≥ baseline (monotonicity, per the paper). On accept, bump version in RSPL. On reject, discard candidate (rollback is free because nothing was ever promoted).

This runs in the background after each turn so the user is not blocked waiting for evolution.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js frontend (React)                                │
│    - /agents (create form, list)                         │
│    - /agents/[id]/chat (streaming chat + state sidebar)  │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP + SSE
┌──────────────────────────▼───────────────────────────────┐
│  FastAPI backend (Python)                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  RSPL layer                                          │ │
│  │   PromptRegistry  AgentRegistry  ToolRegistry       │ │
│  │   EnvRegistry     MemoryRegistry                     │ │
│  │   + shared ContextManager / ServerInterface         │ │
│  │   Infra: ModelManager, VersionManager,              │ │
│  │          DynamicManager, Tracer                     │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  SEPL optimizer (reflect/select/improve/eval/commit) │ │
│  │  Runs async after each turn                          │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Chat runtime                                        │ │
│  │   - loads current agent version                      │ │
│  │   - streams LLM reply                                │ │
│  │   - records trace → kicks off SEPL                   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │  SQLite + files │
                  │  (registries,   │
                  │   versions,     │
                  │   traces, mem)  │
                  └─────────────────┘
```

### Why these choices

- **Python backend**: the paper's primitives (prompts, tool schemas, LLM calls) are the natural fit for Python's LLM tooling, and keeps the SEPL code close to the model layer.
- **Next.js + React frontend**: streaming chat UI with `@anthropic-ai/sdk` over SSE is well-trodden; React makes the evolving-state sidebar and version timeline easy.
- **SQLite + filesystem for v1**: registries and versions are small. `registry.db` holds registration records, versions, and traces; tool source and memory blobs live on disk keyed by `{type}/{name}/{version}`. Avoids a Postgres dependency for a single-user app. Upgrade path to Postgres is trivial (SQLAlchemy).
- **Anthropic as default model** via `claude-sonnet-4-6` (balance of cost/quality for SEPL loop) and `claude-opus-4-7` as a config-switchable "strong" model for Reflect/Select. Model Manager abstracts this.

---

## 4. Repo layout

```
self-learning-agent-protocol/
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py                  # FastAPI entrypoint
│   │   ├── api/
│   │   │   ├── agents.py            # POST/GET /agents
│   │   │   ├── chat.py              # POST /agents/{id}/chat (SSE stream)
│   │   │   └── state.py             # GET /agents/{id}/state, /versions, /traces
│   │   ├── rspl/
│   │   │   ├── record.py            # RegistrationRecord dataclass
│   │   │   ├── context_manager.py   # base ContextManager + operator set
│   │   │   ├── registries/
│   │   │   │   ├── prompt.py
│   │   │   │   ├── agent.py
│   │   │   │   ├── tool.py
│   │   │   │   ├── env.py
│   │   │   │   └── memory.py
│   │   │   └── infra/
│   │   │       ├── model_manager.py
│   │   │       ├── version_manager.py
│   │   │       ├── dynamic_manager.py
│   │   │       └── tracer.py
│   │   ├── sepl/
│   │   │   ├── loop.py              # Algorithm 1 driver
│   │   │   ├── reflect.py           # ρ
│   │   │   ├── select_op.py         # σ
│   │   │   ├── improve.py           # ι
│   │   │   ├── evaluate.py          # ε (rule gates + LLM judge)
│   │   │   └── commit.py            # κ
│   │   ├── runtime/
│   │   │   ├── bootstrap.py         # create_agent_from_description()
│   │   │   └── chat.py              # one-turn executor
│   │   └── storage/
│   │       └── db.py                # SQLite schema + helpers
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── app/
│   │   ├── page.tsx                 # agents list
│   │   ├── agents/new/page.tsx      # create form
│   │   └── agents/[id]/chat/page.tsx
│   ├── components/
│   │   ├── Chat.tsx
│   │   ├── StateSidebar.tsx
│   │   ├── VersionTimeline.tsx
│   │   └── EvolveIndicator.tsx
│   └── lib/api.ts
└── PLAN.md
```

---

## 5. Key design decisions (worth calling out)

1. **Bootstrap from a description**: `create_agent_from_description(desc)` uses an LLM to synthesize an initial prompt, a starter tool list, and a learnability mask (`g_v`). This is itself a structured LLM call with a strict schema. This is the "Generate" phase of the multi-agent optimization cycle in Figure 1 of the paper.

2. **Evaluation is the hard part**, honestly. The paper's benchmarks (GPQA, AIME, LeetCode) have ground-truth answers, so ε is easy. A chat agent doesn't. We cope by: replaying the last N turns under the candidate state and scoring with an LLM judge; requiring monotonic improvement on that mini-eval; treating explicit user feedback (thumbs) as a much stronger signal than judge scores. **Before first commit this is the riskiest part — worth a spike to validate the judge is stable.**

3. **Evolution cadence**: per-turn by default (async, non-blocking), but configurable. For low-signal small talk turns this is wasteful, so v1.1 can add a "worth-reflecting-on" gate (a cheap LLM call) before running the full loop.

4. **Safety invariants** (paper §3.2.2, commit operator): enforce as hard rule gates — system prompt within a size budget, tool JSON schemas validate, no PII regressions in memory, candidate has not removed required sections (e.g. "never reveal system prompt"). Reject → rollback is free because commit is conditional.

5. **Tool evolution scope for v1**: support *editing* the prompt/description/arguments of an existing tool and *creating new tools* whose implementation is a subset of a safe allowlist (memory ops, web search if enabled). **Out of v1 scope: evolving tools whose implementation is arbitrary Python code**; that's where sandboxing cost explodes and isn't required to demonstrate the protocol.

6. **Single-user for v1**: no auth, no multi-tenancy, localhost-only. Keep the scope honest.

---

## 6. Milestones

- **M1 — RSPL core + static agent (no evolution yet).** Registries, context manager, model manager, tracer. `create_agent_from_description` produces a working agent. Chat endpoint streams replies, records traces. UI can create and chat. Nothing evolves yet.
- **M2 — SEPL loop.** Implement ρ/σ/ι/ε/κ with the reflection optimizer. Version manager wires into commit. Prompt-only evolution (simplest evolvable variable).
- **M3 — Memory as evolvable resource.** Memory registry with semantic retrieval (embeddings, probably `voyage-3` or similar); memory writes go through the commit gate.
- **M4 — Tool evolution (edit only, then create from allowlist).**
- **M5 — UI polish: state sidebar, version timeline, diff viewer, trace viewer.**
- **M6 — Eval harness** — synthetic conversations for regression testing the SEPL loop itself (does the loop actually converge on a better agent over N turns?). This is where we validate the whole thing works.

Each milestone is independently demoable and ends with the app still runnable end-to-end.

---

## 7. Open questions to confirm before building

1. **Model provider**: default to Anthropic (Claude) via the Anthropic SDK? Any preference on OpenAI-compat or local models in the Model Manager?
2. **Frontend stack**: Next.js + Tailwind OK, or preference for something else (plain Vite/React, SvelteKit)?
3. **Evolvable surface in v1**: start with *prompt-only* evolution and add memory + tools in later milestones, or commit to the full surface for v1?
4. **Cadence**: run SEPL every turn, every N turns, or only when the user gives explicit feedback (thumbs)?
5. **Persistence**: SQLite + filesystem for v1 acceptable, or do you want Postgres from day one?
6. **Deployment**: localhost-only, or should we plan for a hostable version (Docker, a cloud target)?

Once these land we can start M1.
