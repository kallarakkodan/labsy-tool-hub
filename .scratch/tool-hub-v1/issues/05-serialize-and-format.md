# 05 — BigInt serialisation boundary and formatting helpers

Status: ready-for-agent
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

- [ ] Test: `serializeTool` on a `fileSize` above 2^53 survives a
      `JSON.stringify` → `JSON.parse` round trip with no precision loss
- [ ] Test: `formatBytes` on that same value renders correctly
- [ ] No API handler returns a raw Prisma `Tool`

## Watch out

- Client-side, sizes are **strings**. `Number()` them only for formatting, never
  for arithmetic that matters.
- Do not "fix" this with a global `BigInt.prototype.toJSON` monkey-patch — it
  hides the boundary and breaks the moment something serialises a non-size BigInt.
