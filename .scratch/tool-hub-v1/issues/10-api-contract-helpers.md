# 10 — Shared API error shape and Zod schemas

Status: resolved
Phase: P1
Blocked by: 05
Spec: CONTEXT §6, PRD §9 (error envelope), PRD §11.2

## Why

One error envelope and one set of schemas, shared by the form and the handler.
Client validation is UX; server validation is truth. Landing both before the
first real route stops drift.

## Scope

- `src/lib/api.ts`: `apiError(code, message, status)` producing
  `{ error: { code, message } }`. Codes are stable `SCREAMING_SNAKE` — the client
  switches on them. A helper that `console.error`s the real exception server-side
  while returning a sanitised body.
- `src/lib/validation.ts`: `toolCreateSchema`, `toolUpdateSchema`,
  `browseQuerySchema`, `uploadInitSchema`, plus the tools list query schema
  (`q`, `category`, `sort`, `page`, `limit`). Field constraints from PRD §8.3.
- Unknown keys stripped on every schema (PRD §11.2).
- Catalogue the error codes used across PRD §9 in one exported union so the
  client can exhaustively switch: `INVALID_PATH`, `PATH_OUTSIDE_ROOT`,
  `NOT_FOUND`, `EACCES`, `UNAUTHORIZED`, `FILE_MISSING`, `SIZE_MISMATCH`,
  `INSUFFICIENT_STORAGE`, `RATE_LIMITED`, `VALIDATION_FAILED`.

## Done when

- [x] Both modules import cleanly from client and server code
- [x] A test asserts an `fs` error message containing an absolute path never
      reaches the response body

## Watch out

- Never put `err.message` from an `fs` call in the response — it contains
  absolute host paths (CONTEXT §6, PRD §11.2).
- Category is trimmed and title-cased **on save**, not in the schema's transform
  only — make sure client and server agree on the normalised value or uniqueness
  checks drift.

## Answer

`lib/api.ts` and `lib/validation.ts` are in, with 49 tests.

`apiFailure(error, context)` is the piece worth knowing about. A `PathError` is
safe to surface directly — its message is written by `lib/storage.ts` and only
ever names the relative path the caller already sent — so it maps straight to
PRD §9.3's status codes from a single table. **Anything else** is logged
server-side and becomes a flat 500, because an `fs` or Prisma message carries
absolute host paths and sometimes query fragments. There is a test asserting a
realistic `ENOENT: … '/srv/downloads/secret/plans.iso'` reaches the client with
neither the path nor the errno in it, while still being logged.

Two normalisation decisions, both in shared transforms so the browser and the
server cannot disagree:

- **`normalizeCategory`** trims, collapses whitespace, and title-cases. If the
  client and server normalised separately, "os images" and "OS Images" would
  become two categories in the filter row. It is idempotent, so re-saving does
  not churn the value.
- **`sanitizeFileName`** reduces to a basename, strips control characters
  including NUL, and strips leading dots — the last of those is what stops an
  upload named `.uploads` from colliding with the internal chunk directory. It
  deliberately keeps spaces and parentheses, which real artifact names have.

`uploadInitSchema.totalSize` is a **string**, not a number. An 8 GB size fits in
a double fine, but sizes are BigInt everywhere else and accepting a number here
would be the one place the boundary leaks back in. A test rejects the numeric form.

`browseQuerySchema` deliberately accepts `../../etc`. Traversal is
`resolveWithinRoot`'s decision, and two places deciding what a safe path is
would be one place too many — there is a test pinning that intent so nobody
"fixes" it later.
