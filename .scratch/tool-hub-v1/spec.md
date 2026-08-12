# Spec — Labsy Tool Hub v1.0

This effort is the whole of v1 (PRD §3 phases P0–P5). The requirements live in
**[PRD.md](../../PRD.md)**; the implementation conventions live in
**[CONTEXT.md](../../CONTEXT.md)**. Nothing is restated here — the issues in
`issues/` point at the relevant sections instead of copying them, so the source
documents stay the single truth.

## Shape of the breakdown

36 issues, numbered in dependency order. The numbering follows CONTEXT §8's
build order, which is itself a strict "each step ends with something runnable"
sequence — so working the frontier in numeric order is the intended path.

| Issues | Phase | Ends with |
|---|---|---|
| 01–07 | P0 Foundation | Themed blank page, seeded DB, `/api/health` |
| 08–09 | Security core | `pnpm test:security` green |
| 10–17 | P1 Public catalogue | An engineer can find and download a seeded tool |
| 18–25 | P2 Admin core | Admin registers a pre-staged file end to end |
| 26–27 | P3 Server browser | Admin can browse the storage root and nothing above it |
| 28–31 | P4 Chunked upload | 8 GB upload survives a network interruption |
| 32–36 | P5 Production | Deployed on Ubuntu 24.04, saturates the LAN link |

Issues 08–09 are pulled ahead of all UI deliberately (CONTEXT §8 step 3):
`lib/storage.ts` is the single security boundary and everything filesystem-shaped
composes onto it.

## Conventions

- `Status:` is one of the five roles in `docs/agents/triage-labels.md`.
- `Blocked by:` lists issue numbers. An issue is workable when every number it
  lists is `resolved`.
- Most issues are `ready-for-agent`. The ones marked `ready-for-human` need
  physical server access, real multi-gigabyte files, or the NPM admin UI.
- Tests ship **in the issue that creates the code they cover**, not in a
  trailing "write the tests" ticket. CONTEXT §9 says which areas are
  non-negotiable.

## Out of scope

P6 (PRD §13 rows 8, 10, 12, 13 — audit-log UI, multi-asset tools,
directory-scan import, command palette). The `AuditLog` *table* lands in P2
(issue 22) because backfilling it later is worse than carrying an unused table.
