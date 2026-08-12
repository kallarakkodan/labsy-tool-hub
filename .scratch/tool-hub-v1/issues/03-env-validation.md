# 03 — Environment schema and boot-time validation

Status: resolved
Phase: P0
Blocked by: 01
Spec: CONTEXT §3, PRD §11.2, PRD §12.5

## Why

"Fail loudly at start, never silently at 2am." A missing `AUTH_SECRET` or an
unreadable `STORAGE_ROOT` must stop the process, not surface as a 500 during a
download six hours later.

## Scope

- `.env.example` committed, containing every variable in CONTEXT §3 with the
  documented defaults and comments.
- `src/lib/env.ts`: Zod schema, parsed once at module load, exporting a typed
  frozen object. The process **exits non-zero** when:
  - `AUTH_SECRET` missing or < 32 bytes
  - `ADMIN_PASSWORD_HASH` empty
  - `STORAGE_ROOT` does not exist, is not a directory, or is not readable
  - `COOKIE_SECURE=false` while `NODE_ENV=production`
- Coerce `CHUNK_SIZE`, `SESSION_TTL_HOURS`, `UPLOAD_TTL_HOURS` to numbers and
  the boolean flags from `"true"`/`"false"` strings.
- Every other module imports from `lib/env.ts` — `process.env.X` appears nowhere
  else in `src/`.

## Done when

- [x] Booting with an empty `AUTH_SECRET` prints a named error and exits non-zero
- [x] Booting with `STORAGE_ROOT` pointed at a non-existent path exits non-zero
- [x] `NODE_ENV=production COOKIE_SECURE=false pnpm start` refuses to boot
- [x] `.env.local` copied from `.env.example` boots dev cleanly

## Watch out

- The readability check must be a real `fs.access(R_OK)` on the directory, not
  just an existence check — D2's whole point is that permissions are the failure
  mode nobody notices.
- Validation must not run at *build* time in a way that breaks CI where the
  storage root does not exist. Guard the filesystem checks behind
  "not during `next build`" or make the build supply a temp root.

## Answer

`src/lib/env.ts` is the only place `process.env` is read, and
`src/instrumentation.ts` is the boot gate. Verified end to end, not just in
unit tests: with a short `AUTH_SECRET` or an empty `ADMIN_PASSWORD_HASH`,
`pnpm dev` prints the named problem and the server never accepts a connection.

Three decisions worth knowing:

- **The boot gate lives in `src/instrumentation.ts`, not at module import.**
  Next calls `register()` once per server instance and waits for it before
  serving, which is exactly the semantics CONTEXT §3 asks for. Validating at
  import time instead would have made the module untestable — importing it in a
  suite would have exited the runner.
- **`parseEnv()` is pure and throws; `assertEnv()` is the one that exits.**
  That split is why `tests/env.test.ts` can cover all nine failure modes
  directly. `getEnv()` memoises for everything else.
- **Instrumentation imports the env module dynamically behind a
  `NEXT_RUNTIME === "nodejs"` check.** Next bundles instrumentation for Edge as
  well as Node, and `env.ts` uses `node:fs` and `process.exit`, neither of which
  exists there. A static import produced two build warnings and would have
  failed if the Edge copy ever ran.

Two things this turned up that the issue did not anticipate:

- **`next build` does not call `register()`.** A build machine with no `.env` at
  all succeeds — verified by moving `.env.local` away and building clean. The
  `NEXT_PHASE` guard on the filesystem check is therefore belt-and-braces rather
  than the load-bearing part, but it stays: `next start` on a host whose storage
  root is not yet mounted should fail at boot, and only the phase check
  distinguishes that from a build.
- **`NodeJS.ProcessEnv` now requires `NODE_ENV`**, so partial test fixtures do
  not typecheck against it. `parseEnv` takes an exported
  `EnvSource = Record<string, string | undefined>` instead, which is the more
  honest signature anyway — it parses *an* environment, not necessarily
  `process.env`.

`AUTH_SECRET` is measured with `Buffer.byteLength`, not `.length`, since
CONTEXT §3 specifies bytes; there is a test pinning that 16 two-byte characters
pass and 16 one-byte characters do not.
