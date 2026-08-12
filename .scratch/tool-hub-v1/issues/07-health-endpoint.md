# 07 — GET /api/health

Status: ready-for-agent
Phase: P0
Blocked by: 04
Spec: PRD §9.1, PRD §7.1 (status dot)

## Why

The header's LAN status dot polls this, and it is the first thing to check after a
deploy. It closes out P0 with something observable.

## Scope

- `src/app/api/health/route.ts` returning
  `{ ok, version, uptime, storageRootWritable, dbOk, toolCount }`.
- `version` from `NEXT_PUBLIC_APP_VERSION`. `uptime` from `process.uptime()`.
- `storageRootWritable`: an `fs.access(W_OK)` on the resolved root.
- `dbOk`: a trivial `SELECT 1`-equivalent.
- **No auth, no DB writes.** `export const dynamic = 'force-dynamic'`.
- Returns 200 with `ok: false` on a degraded check rather than throwing, so the
  dot can distinguish "degraded" from "unreachable".

## Done when

- [ ] `curl /api/health` returns the full shape
- [ ] Stopping the DB file / chmod-ing the storage root flips the relevant flag
      without 500-ing

## Watch out

- Do not leak the absolute storage root path in the response (CONTEXT §2 item 5) —
  report a boolean, not the path.
