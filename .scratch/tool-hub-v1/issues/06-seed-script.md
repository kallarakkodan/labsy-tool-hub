# 06 — Seed script and purge

Status: resolved
Phase: P0
Blocked by: 05
Spec: PRD §15, CONTEXT §10, CONTEXT §8 step 2

## Why

The empty state must be reachable and the demo data must be removable in one
command, or every screenshot and manual test drifts from reality.

## Scope

- `prisma/seed.ts` inserting the six rows from PRD §15 with `isSeed: true`.
- The seeder **writes real placeholder files** into `STORAGE_ROOT/seed/` and
  points `filePath` at them. It never fabricates a path that does not exist.
- Placeholders are **sparse files at their true PRD §15 sizes** per
  [ADR-0002](../../../docs/adr/0002-sparse-seed-placeholders.md): open the file
  and `ftruncate` to the size. Apparent size 2.1 GB, allocated size ~0.
  `Tool.fileSize` records the same, honest number.
- Leave `checksum` null on seeded rows — the "Computing…" state is worth having
  reachable, and issue 32's bounded hash queue can fill them in.
- `pnpm db:seed` is idempotent (re-running does not duplicate rows).
- `pnpm db:seed:clear` deletes `WHERE isSeed = true` and removes
  `STORAGE_ROOT/seed/`.
- Seed a mix that exercises the UI: at least one draft (`published: false`), one
  `visibility: "admin"`, one `featured`.

## Done when

- [x] `pnpm db:seed` then `pnpm db:seed:clear` returns the DB and disk to clean
- [ ] After clear, the public page shows the exact empty-state copy from CONTEXT §10 — **deferred to issue 16**, which builds that page
- [ ] Downloading a seeded tool returns the placeholder bytes — **deferred to issue 12**, which builds the download route
- [x] `du -sh` on the seed directory reports ~0, while `ls -l` reports GB
      (proves the files are actually sparse on this filesystem)
- [x] Seeding completes in under a couple of seconds despite 8.6 GB apparent

## Watch out

- No Lorem Ipsum anywhere, including skeletons and placeholder props (CONTEXT §10).
- `db:seed:clear` removes `STORAGE_ROOT/seed/` only — it must never walk the rest
  of the storage root. PRD §14: "No scheduled job anywhere in the repo deletes a
  file from `STORAGE_ROOT`" — this is a developer command, keep it narrow and loud.

## Answer

Six rows from PRD §15, sparse placeholders at their true sizes. The seeder
reports both numbers so the ADR-0002 claim is visible every run:

```
  Seeded 6 tools into seed/
    apparent size : 8.6 GB
    actually used : 0 B  (sparse — ADR-0002)
```

`ls -l` shows 2.1 GB and 5.8 GB files; `du -sh storage/seed` shows `0B`.

The mix exercises the states the UI needs: **Ubuntu** is `featured`,
**Windows 11 Dev Kit** is a draft (`published: false`), and the **Intel Network
Driver Bundle** is `visibility: "admin"` — which is literally the
licence-restricted vendor driver PRD §16 D3 uses as its motivating example.
Checksums are left null so the "Computing…" state is reachable.

Extensions are spread across `.iso`, `.exe`, `.img`, `.zip`, and `.msi` so
issue 15's icon map has something to map.

### A real bug, caught by running it

The first version of `clear()` had two defects that only showed up on execution:

1. The safety guard compared `path.dirname("storage/seed")` against
   `path.resolve(STORAGE_ROOT)` — a relative path against an absolute one. It
   refused to delete anything, which looked like the guard working, but it was
   comparing apples to oranges and would have refused on every machine.
2. Worse, the guard ran **after** `deleteMany`. When it tripped, the rows were
   already gone and the files were still on disk.

Both fixed: `seedDir()` returns a resolved absolute path, and the guard runs
before any mutation. There is a test asserting a file staged next to the seed
directory survives a clear.

Two of this issue's acceptance boxes cannot be ticked here and are carried
forward rather than assumed: the empty-state copy needs the public page
(issue 16) and the placeholder-bytes download needs the download route
(issue 12). Both issues already own the relevant check.

Seeding under `tsx` also needed its own `dotenv` load — nothing outside Next
reads `.env.local`, and without it the seeder quietly builds its own database
somewhere else. Same reason `prisma.config.ts` does it.
