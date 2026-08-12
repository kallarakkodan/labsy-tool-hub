# 12 — GET /api/download/[id] with Range support

Status: resolved
Phase: P1
Blocked by: 11, 08
Spec: PRD §9.4, CONTEXT §7.2, CONTEXT §2 items 2–5, CONTEXT §9

## Why

The product's core verb. Streaming, Range, and abort handling all have to be
right or large downloads fail in ways that only show up on real files.

## Scope

Implement the handler shape in CONTEXT §7.2, in that order:

1. Load via `toolVisibilityWhere(await isAdmin())` — 404 if missing, draft, or internal.
2. `resolveWithinRoot(tool.filePath)` — re-validate; the DB is not trusted.
3. `stat` — on `ENOENT`, set `fileMissing = true`, return `410 FILE_MISSING`.
4. `void bumpDownloadCount(id)` — fire-and-forget, sets `downloadCount` and
   `lastDownloadAt`, never awaited.
5. Headers — `Content-Length` and `ETag` are derived from the **`stat` in step 3,
   never from `Tool.fileSize`** ([ADR-0002](../../../docs/adr/0002-sparse-seed-placeholders.md)):
   the DB column is a display snapshot, the filesystem describes the bytes.
   `Content-Disposition` with **both** the ASCII fallback and
   `filename*=UTF-8''` (RFC 5987), `Content-Type`, `Content-Length`,
   `Accept-Ranges: bytes`, `ETag "<size>-<mtimeMs>"`, `Last-Modified`,
   `Cache-Control: private, max-age=0, must-revalidate`.
6. Default path: parse `Range`, `createReadStream({start,end})`,
   `Readable.toWeb(stream)` as `BodyInit`, `206` + `Content-Range` when ranged,
   `416` when unsatisfiable. **Destroy the stream on `request.signal` abort.**
7. `USE_X_ACCEL=true` branch: empty body +
   `X-Accel-Redirect: ${X_ACCEL_PREFIX}/${encodeURI(relPath)}`.

`HEAD` returns identical headers with no body.
`export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.

## Done when

- [x] Tests: `0-1023`, `1024-`, `-512`, unsatisfiable → 416 (CONTEXT §9)
- [x] Test: anonymous download of a draft and of an internal tool both return 404
- [x] Test: a tool whose file was removed returns 410 and flips `fileMissing`
- [x] `curl -r 0-1023` returns 206 with exactly 1024 bytes
- [x] Cancelling a download leaves no open fd (checked manually, and again in
      issue 36 under load)

## Watch out

- Never `fs.readFile` — an 8 GB ISO OOMs the service (CONTEXT §2 item 3).
- The X-Accel path must be **URI-encoded**; filenames contain spaces and parentheses.
- `Content-Disposition: attachment` is unconditional — a stored HTML or SVG must
  never execute in the site's origin (PRD §11.2).

## Answer

`GET` and `HEAD /api/download/[id]` are in, with 33 tests, and verified over HTTP
against the real 2.1 GB sparse seeded ISO:

- `curl -r 0-1023` → **206 with exactly 1024 bytes** (PRD §14's acceptance line)
- unsatisfiable range → **416** with `Content-Range: bytes */2100000000`
- the seeded draft and internal tool → **404** anonymously
- `downloadCount` and `lastDownloadAt` both advance

### A real bug the tests caught

The first version re-validated the stored path by relativising it and feeding
that back through `resolveWithinRoot`. **Every download returned 410.**

`toRelative` measures against the root's *realpath*, but `Tool.filePath` is
stored as whatever absolute path was registered — and on macOS the temp root is
`/var/…` while its realpath is `/private/var/…`. `path.relative` between the two
produces a `../../..` escape that then fails to resolve. On Linux with a
non-symlinked `/srv/downloads` it would have worked, which is exactly the kind of
latent difference that surfaces in production and nowhere else.

Fixed properly rather than papered over: `lib/storage.ts` gained
**`resolveStoredPath(absolute)`**, which realpaths both sides and compares. It is
the honest expression of "the DB is not trusted" (PRD §9.4 step 2) — distinct
from `resolveWithinRoot`, which anchors a *client-supplied relative* path. Seven
security tests cover it, including the symlinked-prefix case that caused this,
and the errors name only the basename.

### Decisions

- **`Content-Length` and `ETag` come from the `stat`, never `Tool.fileSize`**
  (ADR-0002). The DB column is a display snapshot; the filesystem describes the
  bytes.
- **A stored path outside the root returns 410, not 403.** It is indistinguishable
  from a moved file from the client's side, and 403 would confirm the tool exists.
  There is a test pointing a row at `/etc/hosts` — a file that really exists — and
  asserting only re-validation stops it being served.
- **The abort signal destroys the Node stream explicitly.** Cancelling the web
  stream does not propagate, so 20 abandoned downloads would be 20 held fds
  (PRD §14). Tested by aborting mid-stream and asserting the cancel settles
  rather than hangs.
- **A malformed or multi-range header sends the whole file** rather than erroring.
  Always a valid response, and no download manager needs `multipart/byteranges`
  for a single artifact.
- **A file that reappears clears `fileMissing`**, so the sweep in issue 33 is not
  the only way back from Unavailable.
