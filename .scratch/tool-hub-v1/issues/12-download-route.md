# 12 — GET /api/download/[id] with Range support

Status: ready-for-agent
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

- [ ] Tests: `0-1023`, `1024-`, `-512`, unsatisfiable → 416 (CONTEXT §9)
- [ ] Test: anonymous download of a draft and of an internal tool both return 404
- [ ] Test: a tool whose file was removed returns 410 and flips `fileMissing`
- [ ] `curl -r 0-1023` returns 206 with exactly 1024 bytes
- [ ] Cancelling a download leaves no open fd (checked manually, and again in
      issue 36 under load)

## Watch out

- Never `fs.readFile` — an 8 GB ISO OOMs the service (CONTEXT §2 item 3).
- The X-Accel path must be **URI-encoded**; filenames contain spaces and parentheses.
- `Content-Disposition: attachment` is unconditional — a stored HTML or SVG must
  never execute in the site's origin (PRD §11.2).
