# 08 — lib/storage.ts, the filesystem security boundary

Status: resolved
Phase: Security core
Blocked by: 03
Spec: CONTEXT §7.1, PRD §9.3 (resolution algorithm), PRD §11.1, CONTEXT §8 step 3

## Why

This is the highest-severity risk in the product and the single choke point for
every filesystem operation. CONTEXT §8 puts it before any UI deliberately.

## Scope

- `src/lib/storage.ts` implementing CONTEXT §7.1 as written:
  - `getRoot()` — `fs.realpath(STORAGE_ROOT)`, cached
  - `PathError` with codes `INVALID_PATH | PATH_OUTSIDE_ROOT | NOT_FOUND`
  - `resolveWithinRoot(relative)` — the exact algorithm from PRD §9.3 steps 1–5
  - `toRelative(absolute)`
  - `listDirectory(relative, { showHidden })` — PRD §9.3 steps 6–7, capped at
    5,000 entries with a `truncated` flag
  - `statFile(relative)`
- `.uploads` is filtered **inside `listDirectory`**, never at a call site.
- Symlink entries whose `realpath` falls outside the root are skipped, not errored.
- `EACCES` surfaces as a distinguishable error carrying the *relative* directory
  name for the UI message.

## Done when

- [x] Seven exports, not five — `resolveForWrite` (this issue) and `resolveStoredPath` (added by issue 12); see both Answers
- [x] `grep -rn "node:fs" src/ --include=*.ts | grep -v lib/storage` returns nothing
      outside the upload/download stream handlers that legitimately need
      `createReadStream`/`createWriteStream` on an already-resolved path
- [x] Issue 09's suite passes — 38 tests, `pnpm test:security` green

## Watch out

- The containment check is `real === root || real.startsWith(root + path.sep)`.
  A bare `startsWith(root)` accepts `/srv/downloads-evil`.
- `realpath` is what defeats symlinks — normalising the string is not enough.
- Backslashes are converted to forward slashes before normalising, so
  `..\..\windows` cannot slip through on a path that Linux treats as one segment.

## Answer

`src/lib/storage.ts` is in, with `tests/storage.test.ts` written alongside it as
CONTEXT §7.1 requires. Both issues 08 and 09 close in one commit for that
reason — committing an unproven security boundary and adding its suite
afterwards would invert the point of the rule.

**One addition beyond the stated scope: `resolveForWrite`.** `resolveWithinRoot`
calls `realpath` on the target, so it can only resolve paths that already exist —
and issues 28 and 30 need to resolve an upload *destination*, which by definition
does not. Without it, upload code would have hand-rolled its own path logic
outside the one module that gets audited, which is exactly the automatic PR
rejection in CONTEXT §2 item 2. It resolves the **parent** with `realpath` (so a
parent symlinked out of the root is still caught) and appends the basename.

**Two deliberate non-behaviours**, both commented in the module:

- It does not percent-decode. Query strings arrive already decoded, so decoding
  again would turn `%252e%252e%252f` back into `../` and hand over the escape
  this module exists to prevent.
- It does not trust the database. `Tool.filePath` is re-validated on every
  download (PRD §9.4 step 2).

## Honest notes on what the tests actually prove

Mutation-tested rather than assumed:

- Weakening the containment check to a bare `startsWith(root)` fails **5 tests**,
  including the escaping-symlink and prefix-confusion cases. The suite has teeth.
- Removing the backslash folding fails **nothing**. On Linux a backslash is a
  legal filename character, so `..\..\windows\system32` is already one harmless
  segment that resolves inside the root and 404s. CONTEXT §7.1 prescribes the
  fold and it is kept as defence in depth, but the module comment now says
  plainly that it is not currently load-bearing rather than implying it is.

Two fixture bugs of mine were worth the time they cost: `uploads/` had to exist
for `resolveForWrite`'s happy path, and the prefix-confusion assertion compared a
realpath against a non-realpath — macOS symlinks `/var` to `/private/var`, so the
"trap" assertion was silently passing for the wrong reason.

Attacks that resolve to a non-existent path return `NOT_FOUND` rather than
`PATH_OUTSIDE_ROOT`. That is correct and deliberate: the caller maps both to a
404, and distinguishing them to the client would confirm which paths exist.
