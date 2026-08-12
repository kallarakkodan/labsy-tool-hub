# 06 — Seed script and purge

Status: ready-for-agent
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

- [ ] `pnpm db:seed` then `pnpm db:seed:clear` returns the DB and disk to clean
- [ ] After clear, the public page shows the exact empty-state copy from CONTEXT §10
- [ ] Downloading a seeded tool returns the placeholder bytes
- [ ] `du -sh` on the seed directory reports ~0, while `ls -l` reports GB
      (proves the files are actually sparse on this filesystem)
- [ ] Seeding completes in under a couple of seconds despite 8.6 GB apparent

## Watch out

- No Lorem Ipsum anywhere, including skeletons and placeholder props (CONTEXT §10).
- `db:seed:clear` removes `STORAGE_ROOT/seed/` only — it must never walk the rest
  of the storage root. PRD §14: "No scheduled job anywhere in the repo deletes a
  file from `STORAGE_ROOT`" — this is a developer command, keep it narrow and loud.
