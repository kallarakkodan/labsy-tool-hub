# 33 — fileMissing integrity sweep

Status: resolved
Phase: P5
Blocked by: 22
Spec: PRD §11.3, PRD §13 row 6, PRD §16 D4

## Why

Files registered by path get moved or deleted out-of-band. Silent 404s destroy
trust in the catalogue.

## Scope

- A weekly job that re-`stat`s every registered `filePath` through
  `resolveWithinRoot` and sets `fileMissing` accordingly — **both directions**: a
  file that reappears clears the flag.
- Driven by a `systemd` timer (unit shipped in issue 34) hitting an admin-only
  route or a standalone script; pick one and document it in `deploy/`.
- The download handler already sets `fileMissing` on `ENOENT` (issue 12); this is
  the proactive sweep so the card is correct *before* someone clicks it.
- Log a summary: how many checked, how many newly missing, how many recovered.

## Done when

- [x] Moving a registered file away flags it within one sweep; moving it back
      clears the flag — verified in tests and against the real dev.db and
      real seeded files (moved one away, swept, restored it, swept again)
- [x] A flagged tool renders as Unavailable and returns 410 (PRD §14) — already
      shipped and tested (issues 12/16); the sweep is the new proactive half
- [x] The sweep never modifies anything on disk

## Comments

Picked the standalone-script option over an admin-only route: this repo
already has `scripts/gen-hash.ts` and `prisma/seed.ts` as precedent for `tsx`
scripts run operationally, and a route would need the timer to somehow
authenticate as an admin (store the shared password somewhere for cron to
use) for no benefit — the script runs as the `labsy` system user directly
against the DB and filesystem, no HTTP or session involved. `pnpm
sweep:file-missing` is the entry point; issue 34's systemd timer unit will
call it directly.

`lib/storage.ts` gained `fileStillExists` — a non-throwing, read-only wrapper
around `resolveStoredPath` — so the sweep's core loop (`lib/file-missing-sweep.ts`)
never touches `fs` directly, consistent with every other module in this
codebase.

## Watch out

- **This job reads only.** PRD §14: "No scheduled job anywhere in the repo
  deletes a file from `STORAGE_ROOT`." D4 is explicit — surface candidates, let a
  human decide.
- Stat one file at a time; a burst of thousands of stats during a download window
  is avoidable contention.
