# Self-Learning Agent Protocol

An implementation of the **Autogenesis Protocol (AGP)** from the paper *"Autogenesis: A Self-Evolving Agent Protocol"* (Zhang, 2026, arXiv:2604.15034).

A web app where you create an agent from a natural-language description, chat with it in sessions, and have the agent self-improve between sessions via the paper's **Reflect → Select → Improve → Evaluate → Commit** evolutionary loop.

## Status

**Milestone M1** complete: RSPL core + static chat agent. No evolution yet — SEPL (the Learn button) lands in M2. See [PLAN.md](PLAN.md) for the full milestone list.

## What works today

- Create agent from a short description. The system prompt is synthesized by an LLM, and a starter toolkit (`get_time`, `write_memory`, `search_memory`) is installed.
- Chat with the agent. Tool calls are executed and streamed.
- Tools persist memories, which the agent can search on subsequent turns.
- A sidebar shows the agent's full evolvable state: prompt, policy, tools, memories, and the version timeline of every resource.
- Every turn is recorded as a versioned trace (`Z` in the paper).

## Quick start

```bash
cp .env.example .env.local           # fill in OPENAI_API_KEY
npm install
npm run dev                           # http://localhost:3000
```

## Architecture

- **Next.js App Router** (TypeScript) — frontend + API routes in one deploy.
- **SQLite** via `better-sqlite3` — registries, versions, sessions, turns, traces. Schema in `src/storage/schema.sql`.
- **Vercel `ai` SDK** over **OpenAI** — provider-agnostic model access with tiered models (chat / reflect / select / judge / embed).
- **Paper layers**:
  - **RSPL (`src/rspl/`)** — Resource Substrate Protocol Layer. Five resource types (Prompt, Agent Policy, Tool, Env, Memory) as versioned, registry-managed resources with the operator set from paper Table 7.
  - **SEPL** — Self-Evolution Protocol Layer. Lands in M2.

See [PLAN.md](PLAN.md) for details.
