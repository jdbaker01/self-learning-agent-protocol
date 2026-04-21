# Claude Code instructions — self-learning-agent-protocol

Implementation of the **Autogenesis Protocol (AGP)** as a Next.js chat app where agents self-improve between sessions. Milestone list in [PLAN.md](PLAN.md). Deep detail in [`.claude/`](.claude/).

## Rules

These are mandatory. Do not skip.

1. **Test UI changes in the preview browser before committing.** If a change affects a screen, start the preview server (`mcp__Claude_Preview__preview_start slap-dev`) and walk the affected flow end-to-end. Claim a fix works only after seeing it work in the browser.
2. **Commit all changes before moving to the next milestone.** No uncommitted work crosses an M→M boundary. Run `git status` and confirm clean before starting the next phase.
3. **Only commit when the user explicitly says so.** Milestone boundaries are an easy place to slip — wait for the word.
4. **Never `--no-verify`, `--no-gpg-sign`, or force-push to main.** Fix the underlying issue instead.

## References

- [`.claude/architecture.md`](.claude/architecture.md) — paper mapping, stack, model tiers, data flow
- [`.claude/conventions.md`](.claude/conventions.md) — commit style, preview workflow, file layout
- [`.claude/gotchas.md`](.claude/gotchas.md) — traps we've already hit (don't re-hit them)

## Status

- M1 ✅ RSPL core + static chat agent
- M1.5 ✅ Evaluation spike — 100% commit-decision agreement
- M2 ✅ SEPL loop (prompt-only) + Learn button + streamed step UI
- M3 ✅ Memory as evolvable resource — semantic retrieval + write/update/delete proposals
- M4 ✅ Tool evolution — update_tool / create_tool from allowlist
- M5 ✅ UI polish — agent-list stats, history index, session viewer, learn-run archive
- M6 ✅ Multi-session eval harness — `npm run sim` across scripted personas
- M7 🔜 Vercel deploy (libSQL / Turso adapter, single-secret gating)
