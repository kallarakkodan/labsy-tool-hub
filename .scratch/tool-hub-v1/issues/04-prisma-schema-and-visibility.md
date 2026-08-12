# 04 — Prisma schema, client singleton, toolVisibilityWhere

Status: resolved
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

- [x] `pnpm db:push` creates the SQLite file with all three tables
- [x] `pnpm db:studio` opens
- [x] A unit test asserts `toolVisibilityWhere(false)` is
      `{ published: true, visibility: "public" }` and `toolVisibilityWhere(true)` is `{}`

## Watch out

- `AuditLog` ships now even though only P2 writes to it (PRD §13 row 8) — adding
  the table later means a migration on a live DB for no reason.
- Callers spread it **first**: `where: { ...toolVisibilityWhere(isAdmin), ...filters }`.
  Document this on the function so a later key cannot override it.

## Answer

Schema, lazy client singleton, and `toolVisibilityWhere` are in, with 14 tests
running against a **real SQLite file** pushed by the real CLI into a temp dir —
asserting the shape of a `where` object proves nothing about whether SQLite
honours it.

Prisma 7.9.1 broke three assumptions in PRD §6, all now corrected there and in
the map's Platform table:

- **Generator is `prisma-client` with an explicit `output`.** The client is
  TypeScript under `src/generated/prisma/`, gitignored, rebuilt by a new
  `postinstall` script.
- **`url = env(...)` is gone from the datasource**, so `prisma.config.ts` now
  owns it — and has to load `.env.local` itself, because the Prisma CLI has no
  Next-style env convention. Without that, `pnpm db:push` writes to a different
  database than the app reads, silently.
- **A driver adapter is mandatory**; `new PrismaClient()` throws. Using
  `@prisma/adapter-better-sqlite3` (in-process, no daemon, which is why SQLite
  was chosen at all).

Two design decisions worth knowing:

- **`prisma` is a lazy Proxy, not an eager instance.** An eager
  `new PrismaClient()` at module scope calls `getEnv()` on import, so any test
  touching the data layer would need a complete valid environment merely to load
  the file. Same reasoning as `lib/env.ts`. `createPrismaClient(url)` is exported
  so tests can point at a throwaway database.
- **The two pragmas are set in different places, because they are different
  kinds of thing.** `busy_timeout` is connection state → the adapter's
  `timeout: 5000`. `journal_mode=WAL` is written into the database file header →
  `ensureWal()`, run once at boot from `instrumentation.ts`.

I had originally written a comment claiming better-sqlite3 applies WAL on
connect. It does not — new databases open in `delete` mode. There is now a test
pinning exactly that, and another proving WAL persists to a fresh connection.
Verified end to end too: `prisma/dev.db` reads `delete` before `pnpm dev` and
`wal` after.

Also raised **`tsconfig` target ES2017 → ES2022**. BigInt literals do not compile
below ES2020, so PRD §6's `fileSize` decision was unimplementable as scaffolded.
A stale `tsconfig.tsbuildinfo` masked the fix for one run — worth knowing when a
`tsc` error survives an obviously correct change.

Raw SQLite integers come back as `BigInt` through the driver adapter
(`PRAGMA busy_timeout` is `5000n`), which is a small foretaste of why
`serialize.ts` exists in issue 05.
