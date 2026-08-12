# 32 — SHA-256 for server-path registrations

Status: ready-for-agent
Phase: P5
Blocked by: 22, 30
Spec: PRD §11.3, PRD §13 row 3, PRD §9.2

## Why

"These are OS images and executables. 'Did it transfer correctly?' is the first
question anyone asks." Uploads already hash during concatenation (issue 30); this
covers files registered by path.

## Scope

- `src/lib/checksum.ts`: streamed SHA-256 over a resolved path, **bounded to one
  concurrent hash** process-wide (a queue, not a semaphore per request).
- Triggered as a background job after a server-path tool is saved. Sets
  `checksum` (lowercase hex) and `checksumAt`.
- `POST /api/admin/tools/[id]/checksum` — enqueue or recompute.
- UI: while `checksum` is null, show "Computing…" in mono on the card, the detail
  drawer, and the admin table. A copy button appears once it lands.
- Users verify with `sha256sum <file>` against the copied value.

## Done when

- [ ] Registering a large file does not block the save request
- [ ] Two registrations in quick succession hash sequentially, not in parallel
- [ ] The computed value matches `sha256sum` on the same file
- [ ] Recompute via the API updates `checksumAt`

## Watch out

- Hashing an 8 GB file on a spinning disk competes with concurrent downloads
  (PRD §12.8). One at a time is the whole point of the bound.
- The job must survive the request that started it — do not tie its lifetime to
  the response.
- A restart mid-hash leaves `checksum` null; the recompute endpoint is the
  recovery path, and the UI's "Computing…" must not be indefinitely misleading —
  consider a `checksumAt`-less staleness cue.
