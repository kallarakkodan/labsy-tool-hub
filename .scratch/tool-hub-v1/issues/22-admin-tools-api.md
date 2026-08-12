# 22 — Admin tools API and audit logging

Status: resolved
Phase: P2
Blocked by: 21, 10, 08
Spec: PRD §9.2, PRD §8.2 (delete rules), PRD §6 (AuditLog)

## Why

The write path. Every mutation goes through `/api/**` so the PRD §9 contract stays
the single source of truth (CONTEXT §6) — no Server Actions for these.

## Scope

- `GET /api/admin/tools` — includes unpublished and `fileMissing`.
- `POST /api/admin/tools` — validated by `toolCreateSchema`. Resolves the path
  through `resolveWithinRoot`, `stat`s it, snapshots `fileSize`/`mimeType`,
  rejects anything outside the root or not a regular file. Derives a unique slug.
- `PUT /api/admin/tools/[id]` — full update. `PATCH` — partial (used by the
  Published switch).
- `DELETE /api/admin/tools/[id]?deleteFile=true` — guarded per PRD §8.2: file
  deletion is only permitted when the path resolves inside `STORAGE_ROOT`, is not
  a symlink, and is **not referenced by another `Tool` row**. Default is
  catalogue-only removal.
- `GET /api/admin/categories` — distinct categories with counts.
- Every mutation writes an `AuditLog` row (`tool.create|update|delete`) with
  `targetId`, a JSON `detail`, and `actorIp` from `clientIp()`.

## Done when

- [x] Tests cover: create with a path outside the root → 403; create with a
      directory path → 400; slug collision handled; delete with `deleteFile=true`
      on a shared path refused; delete with `deleteFile=true` on a symlink refused
- [x] Every mutation produces exactly one `AuditLog` row
- [x] Category is trimmed and title-cased on save (PRD §8.3)

## Watch out

- This is the only code in the product that unlinks a file. It must be
  unmistakable in review — one function, heavily commented, called from one place.
- PRD §14: "No scheduled job anywhere in the repo deletes a file from
  `STORAGE_ROOT`." Deletion is only ever this explicit request.
- Re-`stat` on update if the path changed; do not carry a stale size forward.

## Answer

`lib/admin-tools.ts` (the write path, mirroring `lib/tools.ts` for reads),
`lib/audit.ts`, `lib/mime.ts`, `deleteStoredFile()` in `lib/storage.ts`, and the
three routes. 39 tests in `tests/admin-tools.test.ts`, against a real temp
storage root and a real SQLite file — every rule worth testing here is about
what is actually on disk.

Verified live through the real proxy guard and a real session:

```
GET  /api/admin/tools   no cookie          401
POST /api/admin/tools   smoke-artifact.bin 201  Dev Tools · 20 B · octet-stream
GET  /api/tools?q=Smoke                     total 1
PATCH published=false                       total 0 publicly
DELETE ?deleteFile=true                     {"deleted":true,"fileDeleted":true}, file gone

serverPath "../../../etc/passwd"  404 NOT_FOUND
serverPath "/etc/passwd"          404 NOT_FOUND
serverPath "seed" (a directory)   400 INVALID_PATH "not a regular file"

AuditLog  tool.create | ::1 | {"slug":"…","name":"…","path":"smoke-artifact.bin"}
          tool.update | ::1 | {"slug":"…","changed":["published"]}
          tool.delete | ::1 | {"slug":"…","path":"smoke-artifact.bin","fileDeleted":true}
```

Decisions:

- **A typed slug collides, a derived slug suffixes.** A slug the admin entered is
  a decision, so `409 SLUG_TAKEN` makes them resolve it; silently saving them
  under `-2` is a surprise they find later in a URL they already shared. A slug
  derived from the name is a convenience and takes the next free suffix.
- **`PUT` and `PATCH` differ in the schema, not the handler.** `toolReplaceSchema`
  (new) demands the core fields; `toolUpdateSchema` demands none. `file` is
  optional on both, because renaming a tool must not mean re-selecting its bytes.
- **Deletion removes the file first, then the row.** The reverse order leaves an
  admin with a vanished catalogue entry, an error about a file that is still
  there, and no way to retry. This way a refusal means nothing happened.
- **`?deleteFile` must be exactly `"true"`.** `"1"`, `"yes"`, and a typo all fall
  back to catalogue-only, which is the safe default D4 asks for.
- **The "shared file" refusal lives in `lib/admin-tools.ts`, not `lib/storage.ts`.**
  It needs the database, and the storage module does not consult the database —
  that separation is what keeps the security boundary auditable on its own.
- **Audit `detail` carries relative paths.** The P6 reporting UI will render these
  rows, and an absolute host path in a column that eventually reaches a browser
  is the CONTEXT §2 item 5 leak — cheaper to prevent at the write.
- **`lib/audit.ts` never throws.** The security control is the thing that just
  happened; this is the record of it. The login route's inline insert was
  refactored onto it.

### Found while writing the tests

- **Registering a symlink stores the target's real path.** `resolveWithinRoot`
  realpaths, so the link is only how the admin addressed the file. That is right,
  but it means PRD §8.2's "not a symlink" refusal can never fire through the
  create path — it is defence for rows that stopped describing what they
  described: hand-edited, restored from an older backup, or a file swapped for a
  link after registration. Documented at the refusal, and the test writes the
  symlink path straight into the row to reach it.
- **The `../` escape never becomes a rejection.** `joinWithinRoot` neutralises
  leading `..` *before* resolution, so `../elsewhere/secret.txt` lands inside the
  root and 404s rather than 403-ing. Both are refusals; the test now asserts the
  one that actually happens instead of the one the issue text implies.

### Left for issue 30

`source: "upload"` resolves `<UPLOAD_SUBDIR>/<fileName>` from the `Upload` row,
because the table has no column for the final path. Issue 30 also allows an
optional `targetSubdir`, which this derivation cannot see — such an upload will
404 with a recognisable path. **Issue 30 should persist the final relative path
on the `Upload` row** and this function should read it; noted on that ticket.
