# 03 — Environment schema and boot-time validation

Status: ready-for-agent
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

- [ ] Booting with an empty `AUTH_SECRET` prints a named error and exits non-zero
- [ ] Booting with `STORAGE_ROOT` pointed at a non-existent path exits non-zero
- [ ] `NODE_ENV=production COOKIE_SECURE=false pnpm start` refuses to boot
- [ ] `.env.local` copied from `.env.example` boots dev cleanly

## Watch out

- The readability check must be a real `fs.access(R_OK)` on the directory, not
  just an existence check — D2's whole point is that permissions are the failure
  mode nobody notices.
- Validation must not run at *build* time in a way that breaks CI where the
  storage root does not exist. Guard the filesystem checks behind
  "not during `next build`" or make the build supply a temp root.
