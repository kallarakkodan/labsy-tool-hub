# ADR-0002 — Seed placeholders are sparse files at their real sizes

Status: accepted
Date: 2026-08-12
Relates to: PRD §15 (seed data), CONTEXT §10, PRD §6 (BigInt), PRD §9.4

## Context

PRD §15 lists realistic sizes for the six seed rows (2.1 GB, 5.8 GB, 412 MB, …).
CONTEXT §10 says the seeder writes **small** placeholder files so downloads work
out of the box. Taken together they imply `Tool.fileSize` says 2.1 GB while the
file on disk is 4 KB.

That divergence is not cosmetic. It makes `Content-Length` disagree with the body
if the header is taken from the database, makes Range arithmetic untestable
against seeds, makes the seeded `sha256` meaningless, and means the size
formatting and `BigInt` paths are only ever exercised by unit tests.

Options: honest small sizes (lose the realistic display), realistic sizes with
tiny files (lose working downloads), or realistic sizes with files that really
are that size (cost 8.6 GB of dev disk).

## Decision

**Sparse files at their true PRD §15 sizes.** The seeder creates each placeholder
with `fs.truncate(fd, size)`, producing a file whose apparent size is 2.1 GB and
whose allocated size is ~0 blocks. `Tool.fileSize` records the real, honest size.
Supported natively by ext4 (the server) and APFS (dev machines).

A second rule falls out of this and applies beyond the seeds:

> **`Content-Length` and `ETag` come from the `stat`, never from the DB row.**
> `Tool.fileSize` is a snapshot for display, sorting, and the catalogue. The
> bytes on the wire are described by the filesystem.

That makes a drifted DB row a display bug rather than a truncated download.

## Consequences

- Seeded downloads, Range requests, and `sha256sum` verification are all real,
  at realistic sizes, for ~0 disk.
- `BigInt` sizes above 2^31 flow through the API, the formatter, and the UI on
  every dev run — the crash PRD §6 warns about surfaces immediately rather than
  in production.
- Hashing 5.8 GB of zeros takes real wall-clock time. That is a feature: it
  exercises the bounded single-concurrency hash queue from issue 32 instead of
  letting it look instantaneous.
- Copying `STORAGE_ROOT/seed/` with a tool that does not understand sparseness
  expands it to ~8.6 GB. The seed directory is dev-only and `deploy/backup.sh`
  explicitly excludes `/srv/downloads` (PRD §12.7), so nothing in the repo does this.
- The bytes are all zeros, so the content is obviously placeholder if anyone
  inspects a download. Intended.

## Revisit if

Dev or server storage moves to a filesystem without sparse-file support. Fall
back to small placeholders **with honest small sizes** — never to a size that
disagrees with the file.
