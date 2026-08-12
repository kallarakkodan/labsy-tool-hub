# 22 — Admin tools API and audit logging

Status: ready-for-agent
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

- [ ] Tests cover: create with a path outside the root → 403; create with a
      directory path → 400; slug collision handled; delete with `deleteFile=true`
      on a shared path refused; delete with `deleteFile=true` on a symlink refused
- [ ] Every mutation produces exactly one `AuditLog` row
- [ ] Category is trimmed and title-cased on save (PRD §8.3)

## Watch out

- This is the only code in the product that unlinks a file. It must be
  unmistakable in review — one function, heavily commented, called from one place.
- PRD §14: "No scheduled job anywhere in the repo deletes a file from
  `STORAGE_ROOT`." Deletion is only ever this explicit request.
- Re-`stat` on update if the path changed; do not carry a stale size forward.
