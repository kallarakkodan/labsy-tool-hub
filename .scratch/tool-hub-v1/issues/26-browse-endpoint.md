# 26 — GET /api/browse

Status: resolved
Phase: P3
Blocked by: 09, 21
Spec: PRD §9.3, PRD §11.1, CONTEXT §8 step 8

## Why

The endpoint that exposes the filesystem to a client. It ships only after issue
09's suite is green — that is the stated gate on P3.

## Scope

- `GET /api/browse?path=<relative>&showHidden=true`, admin-only (the proxy guard
  already 401s it), rate limited at 60/min/session.
- Query parsed by `browseQuerySchema`. All work delegated to
  `listDirectory()` — **this handler contains no `fs` calls of its own**.
- Response shape exactly as PRD §9.3: `{ path, parent, entries[], truncated? }`
  with `size` as a **string** and `mtime` as ISO. `parent` is `null` at the root.
- Errors: `400 INVALID_PATH`, `403 PATH_OUTSIDE_ROOT`, `404 NOT_FOUND`,
  `403 EACCES` (message names the *relative* directory), `401 UNAUTHORIZED`.
- Entries capped at 5,000 with `truncated: true`.
- `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`.

## Done when

- [x] Every attack in PRD §11.1 returns 400/403 through this endpoint, not just
      through the unit-tested library
- [x] `.uploads` never appears in a listing (PRD §14)
- [x] An unreadable directory returns a named permission error, not a crash
- [x] Directories sort before files, each alphabetically

## Watch out

- Paths crossing the wire are **relative to the storage root**, both directions
  (PRD §8.4). The client never sends or receives an absolute host path.
- The `EACCES` message names the directory — make sure that name is the relative
  one, not what the `fs` error object contains.
