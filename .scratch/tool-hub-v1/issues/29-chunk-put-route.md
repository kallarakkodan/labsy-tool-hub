# 29 — PUT /api/uploads/[id]/chunk

Status: ready-for-agent
Phase: P4
Blocked by: 28
Spec: PRD §9.5, CONTEXT §7.3, CONTEXT §2 item 3

## Why

The hot path. One mistake here — buffering the body — turns a 16 MiB chunk into
resident memory and breaks the <300 MB RSS target.

## Scope

Implement CONTEXT §7.3 as written:

- `export const runtime = 'nodejs'` and `export const maxDuration = 0` (a 16 MiB
  chunk over Wi-Fi is slow).
- `index` from `?index=`, validated as an integer in `[0, totalChunks)`.
- Load the `Upload` row; require `status === 'pending'` and not expired.
- `await pipeline(Readable.fromWeb(request.body), createWriteStream(dest))` where
  `dest` is `<upload.tempDir>/<index>.part`.
- Atomically add `index` to `upload.received` (JSON array) — read-modify-write
  under a transaction or a serialised queue, or two concurrent chunks lose one
  index.
- Respond `{ received: index, count }`.
- Chunks may arrive **out of order**; the v1 client uploads sequentially but the
  server must not assume it.

## Done when

- [ ] Test: out-of-order chunks all land and `received` is complete
- [ ] Test: a duplicate chunk index is idempotent, not double-counted
- [ ] Test: an out-of-range index → 400; an expired upload → 410/409
- [ ] Test: two chunks written concurrently both appear in `received`
- [ ] Node RSS stays flat while a large chunk streams through

## Watch out

- **No `await request.arrayBuffer()`.** Ever (CONTEXT §2 item 3).
- The temp dir is already inside the root — but derive `dest` from
  `upload.tempDir` in the DB, not from anything the client sent.
- On a partial write (client aborts mid-chunk), the `.part` file is short and
  `index` must **not** be added to `received`. Write to a `.part.tmp` and rename
  on successful pipeline completion.
