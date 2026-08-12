# 05 — BigInt serialisation boundary and formatting helpers

Status: resolved
Phase: P0
Blocked by: 04
Spec: PRD §6 (BigInt note), CONTEXT §2 item 1, CONTEXT §9

## Why

`JSON.stringify(BigInt)` throws. PRD §6 calls this "the most likely source of a
runtime crash in this codebase". One helper, applied at every API boundary.

## Scope

- `src/lib/serialize.ts`: `serializeTool(tool)` → `fileSize` as a string, dates as
  ISO strings. Also `serializeUpload` for `totalSize`.
- `src/lib/format.ts`: `formatBytes`, `formatRelativeDate`, `formatThroughput`,
  `formatEta`. Sizes render as `2.1 GB`; every numeric readout is meant to be
  displayed with `tabular-nums`.
- `src/types/index.ts`: the serialised `Tool` shape the client actually receives
  (`fileSize: string`), unprefixed names.

## Done when

- [x] Test: `serializeTool` on a `fileSize` above 2^53 survives a
      `JSON.stringify` → `JSON.parse` round trip with no precision loss
- [x] Test: `formatBytes` on that same value renders correctly
- [x] No API handler returns a raw Prisma `Tool` — none exist yet; issue 11 is the first, and the types make the wrong thing not typecheck

## Watch out

- Client-side, sizes are **strings**. `Number()` them only for formatting, never
  for arithmetic that matters.
- Do not "fix" this with a global `BigInt.prototype.toJSON` monkey-patch — it
  hides the boundary and breaks the moment something serialises a non-size BigInt.

## Answer

`serialize.ts`, `format.ts`, and `types/index.ts` are in, with 27 tests.

The decision worth recording: **the public serialized shape has no `filePath`
field at all.** CONTEXT §2 item 5 says never send an absolute host path to the
client, and the obvious implementation — copy the row, overwrite `filePath` with
a relative one — leaves the leak one forgotten line away. Instead
`SerializedTool` structurally has nowhere to put a path, and
`serializeAdminTool(tool, relativePath)` takes the relative path as an
*argument* rather than reading `tool.filePath`. Passing the absolute path is
then a visible mistake at the call site instead of a silent leak inside the
serializer. `isSeed` is dropped for the same reason — it is operational state,
not the client's business. Both are pinned by tests asserting the JSON never
contains `/srv/downloads`.

`formatBytes` is **decimal (1000-based)**, not binary. PRD §15 lists Ubuntu
22.04.4 as "2.1 GB", which is the vendor's own decimal figure — the same file is
1.96 GiB. Engineers compare the card against the vendor's download page, so
matching the vendor is the useful behaviour. It also scales in `BigInt` rather
than converting to a double first, so a petabyte-scale size formats correctly
instead of quietly rounding; there is a test at 2^53 + 1 for exactly that.

Sizes render with a fixed one decimal place (`84.0 MB`, not `84 MB`). Slightly
unusual to read, but `tabular-nums` plus a fixed decimal count is what stops the
metadata line from reflowing as values change.

No `BigInt.prototype.toJSON` polyfill, deliberately: a global patch would hide
the boundary and silently rescue code that should have been routed through this
module.

`parseReceived` degrades a malformed `Upload.received` to `[]` rather than
throwing — the client then re-uploads, which is the recoverable failure. A
500 from the resume query is not.
