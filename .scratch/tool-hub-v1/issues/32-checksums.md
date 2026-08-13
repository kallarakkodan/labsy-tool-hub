# 32 — SHA-256 for server-path registrations

Status: resolved
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

- [x] Registering a large file does not block the save request
- [x] Two registrations in quick succession hash sequentially, not in parallel
- [x] The computed value matches `sha256sum` on the same file — verified both
      in tests and against the real dev server
- [x] Recompute via the API updates `checksumAt`

## Comments

`lib/checksum.ts`'s queue is a plain FIFO array plus a `running` flag —
enqueue pushes and returns immediately, `drain()` processes one entry at a
time and re-enters only if not already running. Verified the bound has teeth
by temporarily bypassing the queue (calling the hash directly) and confirming
the "never two at once" test fails exactly as expected, then restored it.

Also closed a small gap implied by this issue's own "Why": uploads already
compute a SHA-256 during concatenation (issue 30) but were discarding it —
nothing persisted it past the `complete` response. Added `Upload.checksum`,
have `complete` persist it, and `resolveFileSource`'s `source: "upload"`
branch now carries it straight onto the created `Tool` instead of enqueueing
a redundant re-hash.

**UI gap, not caused by this issue**: the scope calls for "Computing…" on the
card, the detail drawer, and the admin table. The card already handled this
(`ToolCardMenu.tsx` was built for it ahead of time) and the admin table now
does too (`ChecksumCell.tsx`, with a copy button and a recompute action). The
**detail drawer itself does not exist** — issue 17 is still `ready-for-agent`
in this tracker, never implemented. There is nothing to wire the checksum
display into there yet; that is issue 17's gap, not this one's, and building
a detail-drawer route was out of scope for a checksum ticket.

## Watch out

- Hashing an 8 GB file on a spinning disk competes with concurrent downloads
  (PRD §12.8). One at a time is the whole point of the bound.
- The job must survive the request that started it — do not tie its lifetime to
  the response.
- A restart mid-hash leaves `checksum` null; the recompute endpoint is the
  recovery path, and the UI's "Computing…" must not be indefinitely misleading —
  consider a `checksumAt`-less staleness cue.
