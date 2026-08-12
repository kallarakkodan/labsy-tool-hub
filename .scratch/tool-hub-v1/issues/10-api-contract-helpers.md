# 10 — Shared API error shape and Zod schemas

Status: ready-for-agent
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

- [ ] Both modules import cleanly from client and server code
- [ ] A test asserts an `fs` error message containing an absolute path never
      reaches the response body

## Watch out

- Never put `err.message` from an `fs` call in the response — it contains
  absolute host paths (CONTEXT §6, PRD §11.2).
- Category is trimmed and title-cased **on save**, not in the schema's transform
  only — make sure client and server agree on the normalised value or uniqueness
  checks drift.
