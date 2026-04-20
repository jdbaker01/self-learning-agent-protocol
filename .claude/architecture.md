# Architecture

## Paper

Zhang 2026, *"Autogenesis: A Self-Evolving Agent Protocol"* (arXiv:2604.15034). PDF in `paper/` (gitignored).

Two layers:
- **RSPL** (Resource Substrate Protocol Layer): five versioned resource types — Prompt, Agent Policy, Tool, Env, Memory — each a `RegistrationRecord { name, description, version, impl, params, contract, learnable }` (paper Defs C.1/C.2), managed by a type-specific Context Manager implementing the operator set from Table 7.
- **SEPL** (Self-Evolution Protocol Layer): atomic operators ρ (Reflect) → σ (Select) → ι (Improve) → ε (Evaluate) → κ (Commit). Input: session trace `Z` + current `V_evo`. Output: new committed version or no change.

Infrastructure (paper §3.1.4): **Model Manager**, **Version Manager**, **Dynamic Manager**, **Tracer**.

## Stack

- **Next.js 16.2.4 App Router** (TypeScript end-to-end) — UI + API routes in one deploy. Vercel-targeted.
- **`ai@6.0.168` + `@ai-sdk/openai@3.0.53` + `@ai-sdk/react@3.0.170`** — streaming, tool-use, `generateObject` with zod schemas.
- **`better-sqlite3@11.7.0`** with WAL + foreign_keys on. Schema is vanilla SQLite SQL so it ports to libSQL/Turso without change.
- **Zod 3.25.76**, React 19.2.5, Tailwind 3.4.17.
- **`tsx` + `dotenv`** for standalone scripts (they need `dotenv.config({ path: ".env.local" })` — Next autoloads, tsx doesn't).

## Model tiers

All via `src/rspl/infra/modelManager.ts`. Env overrides: `SLAP_<TIER>_MODEL`.

| Tier | Default | Used for |
|---|---|---|
| `chat` | `gpt-4.1-mini` | per-turn assistant replies |
| `reflect` | `gpt-4.1` | SEPL ρ — hypothesis generation |
| `select` | `gpt-4.1` | SEPL σ — structured proposal generation |
| `judge` | `gpt-4.1-mini` | SEPL ε — pairwise reply judging |
| `embed` | `text-embedding-3-small` | memory retrieval (M3) |

## Data

- SQLite at `./data/slap.db` (override `SLAP_DATA_DIR`). Gitignored.
- Schema: `src/storage/schema.sql`. Tables: `agents`, `resources`, `resource_versions`, `resource_head` (head pointer per resource), `sessions`, `turns`, `traces`, `learn_runs` (SEPL audit).
- Every `update` writes a new `resource_versions` row and advances `resource_head` — rollback via `restore(version)` is free.

## Tool safety

Tools are callable via an **allowlist of implementation-refs** (`src/rspl/registries/tool.ts`): `write_memory`, `search_memory`, `get_time`. The LLM can configure/rename tools but never authors code. M4 expands the allowlist (e.g. `fetch_url`, `calculator`). Arbitrary code execution is out of scope.

## Evaluation (ε)

`src/sepl/evaluate.ts`. Two layers:
1. **Rule gates** (deterministic hard-block): prompt size budget (~4k tokens), allowlist membership, memory entry budget.
2. **Pairwise LLM-judge replay**: regenerate baseline + candidate replies under their respective states, then for each held-out turn call the judge N=3 times with alternating A/B positions, temperature=0, majority-vote per dimension. Decision rule: **commit iff strict improvement on ≥1 dimension AND no regression on any** (helpfulness, faithfulness, format). This is the paper's monotonic-improvement semantic and is stable at the decision boundary; see `.claude/gotchas.md` for why pooled win counts are not.

Smoke: `npm run eval-spike` against the `recipe_coach_v1` canned fixture → should print 100% agreement.

## File map (load-bearing only)

```
app/
  agents/[id]/chat/page.tsx    # server-creates session, passes to ChatView with key={sessionId}
  api/
    agents/route.ts             # POST creates agent via LLM-structured bootstrap
    agents/[id]/sessions/route.ts
    agents/[id]/state/route.ts  # sidebar payload
    sessions/[sid]/chat/route.ts   # streaming POST; result.toUIMessageStreamResponse()
    sessions/[sid]/end/route.ts
components/
  ChatView.tsx                  # useChat + DefaultChatTransport with prepareSendMessagesRequest
  StateSidebar.tsx              # evolvable state + version lineage
src/
  rspl/
    contextManager.ts           # shared operator surface
    record.ts
    registries/                 # prompt, agent, tool, env, memory
    infra/                      # modelManager, versionManager, dynamicManager, tracer
  sepl/
    evaluate.ts                 # ε — rule gates + pairwise judge (M1.5)
    fixtures.ts                 # canned traces for spike
    # reflect.ts, select.ts, improve.ts, commit.ts, loop.ts land in M2+
  runtime/
    bootstrap.ts                # createAgentFromDescription
    chat.ts                     # runChatTurn (streamText + tools + trace)
  storage/
    db.ts, schema.sql
scripts/eval-spike.ts           # `npm run eval-spike`
```
