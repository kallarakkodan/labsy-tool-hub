# 04 — Prisma schema, client singleton, toolVisibilityWhere

Status: ready-for-agent
Phase: P0
Blocked by: 03
Spec: PRD §6, CONTEXT §7.4, CONTEXT §6, CONTEXT §8 step 2

## Why

`toolVisibilityWhere` is one of the two choke points in this codebase. Landing it
with the schema means no read path is ever written without it available.

## Scope

- `prisma/schema.prisma` exactly as PRD §6: `Tool`, `Upload`, `AuditLog`,
  including all three `@@index` declarations on `Tool`.
- `src/lib/db.ts`:
  - Prisma singleton with the `globalThis` guard (dev hot-reload otherwise
    exhausts connections)
  - `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` executed once at boot
  - `toolVisibilityWhere(isAdmin)` verbatim from CONTEXT §7.4, with its doc comment
- `pnpm db:push` and `pnpm db:migrate` both work.

## Done when

- [ ] `pnpm db:push` creates the SQLite file with all three tables
- [ ] `pnpm db:studio` opens
- [ ] A unit test asserts `toolVisibilityWhere(false)` is
      `{ published: true, visibility: "public" }` and `toolVisibilityWhere(true)` is `{}`

## Watch out

- `AuditLog` ships now even though only P2 writes to it (PRD §13 row 8) — adding
  the table later means a migration on a live DB for no reason.
- Callers spread it **first**: `where: { ...toolVisibilityWhere(isAdmin), ...filters }`.
  Document this on the function so a later key cannot override it.
