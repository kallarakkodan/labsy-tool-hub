# 30 — POST /api/uploads/[id]/complete: concatenate and hash in one pass

Status: ready-for-agent
Phase: P4
Blocked by: 29
Spec: PRD §9.5, CONTEXT §7.3, CONTEXT §9 (upload protocol tests)

## Why

Where correctness is proved: the file on disk must byte-for-byte match what the
client sent, and the checksum shown in the UI must match `sha256sum` on the
server.

## Scope

- Verify **every** index `0..totalChunks-1` is present; missing → `409`.
- Verify each part's size matches expectation (the last chunk may be short).
- Concatenate parts **in index order** into
  `STORAGE_ROOT/<UPLOAD_SUBDIR>/<targetSubdir?>/<fileName>` through a single
  write stream, feeding a `crypto.createHash("sha256")` **during** the same pass
  — one read of the data, not two.
- Verify total bytes written equals `totalSize`; mismatch → `409 SIZE_MISMATCH`
  with the temp dir **preserved for diagnosis**.
- Only then remove the temp dir and mark the `Upload` row `completed`.
- Filename collisions get a ` (2)` suffix unless `overwrite` is set.
- Response: `{ filePath, fileName, fileSize, checksum }` — `filePath` **relative
  to the storage root**.
- Write an `upload.complete` `AuditLog` row.

## Done when

- [ ] Test: missing chunk → 409; size mismatch → 409 with temp dir intact
- [ ] Test: short final chunk assembles correctly
- [ ] Test: the assembled file's SHA-256 equals the value returned
- [ ] Test: a name collision produces ` (2)`, and `overwrite: true` replaces
- [ ] The completed file's `sha256sum` on disk matches the UI (PRD §14)

## Watch out

- Two passes over an 8 GB file is 8 GB of avoidable I/O — hash during
  concatenation (CONTEXT §7.3).
- `filePath` returned to the client is relative (CONTEXT §2 item 5); the DB row
  the form then creates stores the absolute path.
- `targetSubdir` is client-supplied — resolve it through `resolveWithinRoot`
  like any other path.
