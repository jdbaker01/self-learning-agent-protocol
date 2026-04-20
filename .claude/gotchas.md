# Gotchas

Traps we've already paid for. Re-reading this saves a cycle.

## `useChat` captures the transport once

`useChat` in `@ai-sdk/react@3.0.170` reads `transport` on first mount and doesn't rewire on prop change. Two consequences:

1. **Don't gate session creation in a client effect.** Create the session server-side in the page and pass `initialSessionId` as a prop. The transport then has a stable URL from first render. See `app/agents/[id]/chat/page.tsx`.
2. **`router.refresh()` doesn't reset `useState` initializers.** When End Session creates a new session server-side, the prop changes but `useState<string>(initialSessionId)` keeps the old value. Fix: `<ChatView key={sessionId} ... />` on the server page — the new session id forces a full remount, which resets `useChat`, transport, and messages.

Symptom when you get either wrong: "I sent a message and nothing happened" / "Messages go to the ended session."

## Judge stability is NOT a temperature problem

Initial naive pairwise judge at `temperature=0` hit **67%** commit-decision agreement across 3 runs. Lowering temperature further wasn't the answer (already zero); majority-voting N=3 calls per turn didn't fix it either — the per-dimension verdicts were actually stable.

The flip was at the **aggregate**. Pooled raw win counts (`candScore > baseScore`) sit on a knife-edge when replies are close. Switching to the **dimension-wise monotonic rule** — *commit iff strict improvement on ≥1 dimension AND no regression on any* — got us to 100% agreement. This is also the paper's correct semantic.

**Rule:** when a judge decision flaps, look at the aggregation logic before looking at the judge.

## Peer-dep matrix for ai SDK v6

- `ai@6.0.168` requires `zod ^3.25.76 || ^4.1.8`.
- `@ai-sdk/react@3.0.170` requires `react ~19.0.1 || ~19.1.2 || ^19.2.1`.

Both will `ERESOLVE` on install if the versions in `package.json` don't match. Don't downgrade `ai`; upgrade the peer.

## ai v6 type shapes

- `EmbeddingModel` is no longer generic — write `EmbeddingModel`, not `EmbeddingModel<string>`.
- `toUIMessageStreamResponse()` sets `x-vercel-ai-ui-message-stream: v1`; `DefaultChatTransport` needs that header to parse. If a stream renders in curl but not in the UI, check headers first.

## Next.js auto-rewrites

On first `next build`/`next dev`, Next modifies `tsconfig.json` (sets `jsx: "react-jsx"`, adds include paths) and rewrites `next-env.d.ts`. These changes are intentional — leave them alone.

## `dotenv` and standalone scripts

`next dev` auto-loads `.env.local`. `tsx scripts/*.ts` does **not**. Scripts must explicitly:

```ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
```

Symptom: `LoadAPIKeyError: OPENAI_API_KEY missing` when the key is clearly in `.env.local`.

## API route try/catch

Top-level `await createAgentFromDescription(...)` without a try/catch returns a bare 500 with no body — user sees "something went wrong" with no signal. Always wrap risky async calls and return `{ error: msg }` so the UI and logs have something to work with.

## `better-sqlite3` and Next runtime

API routes touching the database must `export const runtime = "nodejs"`. The Edge runtime doesn't include native modules. Forget this and you get mysterious "module not found" on deploy.

## `gh repo create --push` race

Immediately after creating a new remote, `git push` can 404 for a second or two. Either use `gh repo create --push` (gh handles the retry) or `sleep 3` before the first push.

## React StrictMode double-fires effects

React 19 dev mode intentionally mounts every component twice. `useState` + `setState` as a "have we started?" guard is not synchronous — the second effect invocation still sees the old value and fires again.

For a side-effect that must run exactly once on mount (e.g. kicking off a streaming POST to `/api/.../learn`), use `useRef(false)`:

```ts
const startedRef = useRef(false);
// inside the effect:
if (startedRef.current) return;
startedRef.current = true;
```

Symptom we saw: hitting End & Learn once fired two parallel SEPL pipelines against the same session and wrote two `learn_runs` rows. Both completed, both were correctly rejected, but each burned ~30s of judge API calls.

## Schema columns you might forget

- `resources.entity_type` (not `entity`).
- `resource_versions.impl` (not `body_json`).
- `traces.payload` (not `body`).

When a `sqlite3 ... 'no such column'` fires, check `.schema <table>` before guessing.
