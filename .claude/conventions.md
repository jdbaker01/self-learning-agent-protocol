# Conventions

## Commits

Prefix with a tag + brief imperative: `M1:`, `M1.5:`, `M2:`, or `Fix:` for non-milestone fixes. Body explains the *why*, not the *what* — the diff already shows the *what*. Two paragraphs at most. Every commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Examples from history:
- `M1: RSPL core + static chat agent`
- `M1.5: eval spike — rule gates + pairwise judge, 100% commit-decision agreement`
- `Fix: End Session left client pinned to ended session`

Split unrelated changes into separate commits — e.g., the M1.5 work went in one commit and the chat transport fix discovered during testing went in another.

Never amend pushed commits. Never `--no-verify` or `--no-gpg-sign`. Never force-push to `main`.

## Preview workflow

**Any UI change goes through the preview browser before commit.** See `.claude/launch.json` for the dev server config (`slap-dev`).

```
mcp__Claude_Preview__preview_start slap-dev
# click through the affected flow with preview_click / preview_fill
mcp__Claude_Preview__preview_screenshot to verify the end state
mcp__Claude_Preview__preview_stop <serverId>
```

Bash-start only for backend-only changes (run a `curl` check or a script). Backend examples that *don't* need preview: adding eval-spike fixtures, editing SQL schema, renaming internal types. Anything that touches `app/`, `components/`, or an API route reachable from the UI needs preview.

## Milestone gating

Before starting a new milestone:
1. `git status` — working tree must be clean.
2. Current milestone's exit criteria from `PLAN.md` must be met and recorded.
3. Mark a chapter (`mcp__ccd_session__mark_chapter`) when entering the new phase.

## Scripts

- `npm run dev` — Next.js dev server (auto-loads `.env.local`).
- `npm run typecheck` — `tsc --noEmit`. Run after non-trivial edits.
- `npm run eval-spike` — M1.5 judge-stability smoke. Expects `OPENAI_API_KEY` in `.env.local`.
- `npm run lint` — Next's lint.

## Environment

- `OPENAI_API_KEY` in `.env.local` (copy from `.env.example`). Next autoloads it. Standalone scripts (`tsx`) must `dotenv.config({ path: ".env.local" })` explicitly — see `scripts/eval-spike.ts`.
- Optional: `SLAP_CHAT_MODEL`, `SLAP_REFLECT_MODEL`, `SLAP_SELECT_MODEL`, `SLAP_JUDGE_MODEL`, `SLAP_EMBED_MODEL`, `SLAP_DATA_DIR`.

## File-layout rules

- Backend domain modules in `src/` (importable via `@/src/...`). Never import them from client components.
- Next.js pages in `app/`. API routes always `export const runtime = "nodejs"` because of `better-sqlite3`.
- Committed dev config in `.claude/launch.json`; user-specific settings in `.claude/settings.local.json` (gitignored).
- `paper/`, `data/`, `tsconfig.tsbuildinfo`, `.next/`, `node_modules/` all gitignored.

## When to update memory in `.claude/*.md`

- New architectural choice or stack change → `architecture.md`.
- New repo-wide habit or tooling → `conventions.md`.
- A bug we spent time debugging → `gotchas.md` (so the next session doesn't repeat it).
- A new behavioral rule the user has set → `CLAUDE.md` rules section.
