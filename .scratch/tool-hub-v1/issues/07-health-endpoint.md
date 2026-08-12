# 07 — GET /api/health

Status: resolved
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

- [x] `curl /api/health` returns the full shape
- [x] Stopping the DB file / chmod-ing the storage root flips the relevant flag
      without 500-ing

## Watch out

- Do not leak the absolute storage root path in the response (CONTEXT §2 item 5) —
  report a boolean, not the path.

## Answer

`GET /api/health` returns the PRD §9.1 shape, verified live and by test.

Two decisions:

- **Degraded returns 200 with `ok: false`, not a 5xx.** The status dot has three
  states (PRD §7.1) and needs to tell "reachable but unhealthy" from
  "unreachable". A non-200 collapses both into the same red.
- **The storage-root check is `W_OK`, not just `R_OK`.** Uploads land under the
  root, and a read-only mount is a failure worth surfacing on the dot rather
  than discovering eight gigabytes into an upload.

`Cache-Control: no-store`, because a cached health check is worse than none.
The payload carries a boolean and never the path — this endpoint is
unauthenticated, and CONTEXT §2 item 5 applies with more force here than
anywhere else.

Verified degraded for real by `chmod 000` on the storage root: `ok` flips false,
`storageRootWritable` flips false, `dbOk` stays true, HTTP stays 200.
