# 08 — lib/storage.ts, the filesystem security boundary

Status: ready-for-agent
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

- [ ] These five functions are the only exports
- [ ] `grep -rn "node:fs" src/ --include=*.ts | grep -v lib/storage` returns nothing
      outside the upload/download stream handlers that legitimately need
      `createReadStream`/`createWriteStream` on an already-resolved path
- [ ] Issue 09's suite passes

## Watch out

- The containment check is `real === root || real.startsWith(root + path.sep)`.
  A bare `startsWith(root)` accepts `/srv/downloads-evil`.
- `realpath` is what defeats symlinks — normalising the string is not enough.
- Backslashes are converted to forward slashes before normalising, so
  `..\..\windows` cannot slip through on a path that Linux treats as one segment.
