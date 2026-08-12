# 28 — Upload lifecycle: init, resume query, abort, janitor

Status: ready-for-agent
Phase: P4
Blocked by: 26
Spec: PRD §9.5, PRD §13 row 11, CONTEXT §8 step 9

## Why

The bookends of the chunk protocol, plus the free-space preflight that stops a
failed upload from filling the root partition and taking the server down.

## Scope

- `POST /api/uploads/init` — `{ fileName, totalSize, mimeType? }` →
  `{ uploadId, chunkSize, totalChunks, received: [] }`. Creates the `Upload` row
  and `STORAGE_ROOT/.uploads/<uploadId>/`, sets `expiresAt = now + UPLOAD_TTL_HOURS`.
- `fileName` sanitised to a **basename**: path separators, control characters,
  and leading dots stripped (PRD §9.5).
- **Free-space preflight**: reject with `507 INSUFFICIENT_STORAGE` when
  `totalSize * 2.1` exceeds free bytes (concatenation transiently needs both
  copies). Use `check-disk-space` or an equivalent `statvfs`.
- Rate limited at 20/hour/session.
- `GET /api/uploads/[id]` → `{ uploadId, received, totalChunks, status }` — the
  resume query.
- `DELETE /api/uploads/[id]` → `204`, temp dir removed.
- **Janitor**: on boot and hourly, delete `Upload` rows and temp dirs past
  `expiresAt`.
- Admin-only (the proxy guard covers `/api/uploads/**`).

## Done when

- [ ] Test: an upload larger than free disk space is rejected at init (PRD §14)
- [ ] Test: `fileName` `"../../evil.sh"` becomes `"evil.sh"`
- [ ] Test: the resume query returns the correct `received` set
- [ ] Cancel removes all temp chunks (PRD §14)
- [ ] The janitor reaps an artificially expired upload on next run

## Watch out

- The janitor only ever touches `STORAGE_ROOT/.uploads/<id>/` directories that
  have a matching expired `Upload` row. It must never walk the storage root at
  large — PRD §14 forbids any scheduled job deleting from `STORAGE_ROOT`, and
  this is the narrow, documented exception for temp chunks.
- `.uploads` (temp, dotted, mode 0700) is a different directory from `uploads`
  (the completed-file destination, `UPLOAD_SUBDIR`). Do not conflate them.
