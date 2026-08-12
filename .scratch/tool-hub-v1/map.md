# Map — Labsy Tool Hub v1.0

Spec: [spec.md](./spec.md) · Requirements: [PRD.md](../../PRD.md) · Conventions: [CONTEXT.md](../../CONTEXT.md)

## Frontier

**Resolved: 01–16, 18–22.** 331 tests green, `pnpm test:security` green.

The whole write path works end to end through the real guard and a real session:
create from a server path, appear publicly, flip to Draft and disappear, delete
with the file. Path escapes are refused (`../../../etc/passwd` and `/etc/passwd`
both 404, a directory 400s), and every mutation leaves exactly one `AuditLog`
row carrying a relative path.

Next workable:

- **23** — dashboard table + Stale filter. The API it needs now exists; the
  Stale filter will want a `stale=true` parameter added to the admin list query.
- **17** — detail drawer, still an optional P1 stretch nothing depends on.

Numeric order takes 23, then 24 → 25 finishes P2.

## Dependency graph

```
01 scaffold
├─ 02 tokens + fonts + lint rule
└─ 03 env validation
   ├─ 04 prisma + toolVisibilityWhere
   │  ├─ 05 serialize + format
   │  │  ├─ 06 seed
   │  │  └─ 10 api.ts + validation.ts
   │  │     └─ 11 GET /api/tools ──┐
   │  └─ 07 /api/health            │
   ├─ 08 lib/storage.ts            │
   │  └─ 09 traversal suite        │
   └─ 18 lib/auth.ts + gen:hash    │
   └─ 19 clientIp + rate-limit     │
                                   │
   [08] + [11] ──▶ 12 download route
   [07] + [02] ──▶ 13 app shell + header
                   └─ 14 pills + sort + URL state
   [12] + [13] ──▶ 15 ToolCard
                   └─ 16 ToolGrid + states  ── P1 done
                      └─ 17 detail drawer (stretch)

   [18] + [19] ──▶ 20 login routes + page          ── P2 auth done
                   └─ 21 proxy guard + headers + CSRF
                      └─ 22 admin tools API + AuditLog
                         ├─ 23 dashboard table + Stale filter  ← frontier
                         │  ├─ 24 form slide-over (Server Path)
                         │  └─ 25 delete dialog          ── P2 done
                         └─ 33 fileMissing sweep

   [09] + [21] ──▶ 26 GET /api/browse
                   └─ 27 browser modal + form wiring     ── P3 done
                      └─ 28 upload init/resume/abort/janitor
                         └─ 29 PUT chunk
                            └─ 30 complete (concat + hash)
                               └─ 31 dropzone client     ── P4 done

   [22] + [30] ──▶ 32 checksums
   [32] + [33] ──▶ 34 deploy artifacts
                   └─ 35 provisioning + NPM  (human)
                      └─ 36 acceptance pass  (human)     ── v1.0
```

## Parallelisable once 03 is resolved

Three tracks can run independently and only converge at 12 and 21:

- **Data/API track:** 04 → 05 → 10 → 11
- **Security track:** 08 → 09
- **Auth track:** 18, 19 (both only need 03)

The UI track (13 → 14 → 15 → 16) needs 07 and 02, not the data layer, until 15.

## Decisions so far

Carried in from PRD §16 — D1 TLS at NPM, D2 `/srv/downloads` + default ACLs,
D3 per-tool `visibility`, D4 never auto-delete, D5 20/50 concurrency. Nothing is
pending sign-off; new decisions made while building go in `docs/adr/` per
`docs/agents/domain.md`, and PRD §16 should be checked first.

Made during the breakdown, resolving the four gaps the source documents left open:

- **[ADR-0001](../../docs/adr/0001-session-format-jose-jwe.md) — sessions are
  `jose` JWE**, all in one `lib/auth.ts` as PRD §10 specifies. The route guard
  does a real decrypt, never a cookie-presence check. Affects issues 18, 20, 21.
  *Revised the same day:* the first version mandated an Edge/Node module split,
  which Next 16 makes unnecessary — see the Platform section below.
- **[ADR-0002](../../docs/adr/0002-sparse-seed-placeholders.md) — seed
  placeholders are sparse files at their real PRD §15 sizes.** Honest metadata,
  ~0 disk. Carries a second rule: `Content-Length` and `ETag` come from the
  `stat`, never from `Tool.fileSize`. Affects issues 06 and 12.
- **`deploy/nginx.conf` is dropped.** PRD §12.4 removed app-host nginx; the file
  survived only in §10's directory tree. Replaced by `deploy/npm-advanced.conf`,
  which is the §12.5 snippet labelled as paste-into-NPM and read by no process.
  Affects issue 34. PRD §10 corrected.

Made while building:

- **[19](./issues/19-client-ip-and-rate-limit.md) — the limiter splits check from
  record.** PRD §8.1 counts failed passwords, so login peeks first and records
  only once the password is known wrong; browse and upload-init use the combined
  `consumeRateLimit`. Rejected calls are never recorded, and memory is bounded by
  an on-access sweep plus a 10 000-bucket cap whose eviction takes the *stalest*
  bucket — so a flooder can never evict itself into a clean slate.
- **[19] — `clientIp()` has no socket fallback,** because Next 16 exposes no
  socket address to a Route Handler. The chain is first `X-Forwarded-For` entry →
  `X-Real-IP` → the literal `"unknown"`. Corrects the issue text, and CONTEXT §2
  item 6's "falling back to the socket address".
- **[20](./issues/20-login-routes-and-page.md) — one message, two headers.** Both
  rejections say the same generic thing; `X-RateLimit-Remaining` and
  `Retry-After` carry the detail, which is how "show the state clearly" and "keep
  messages generic" both hold. The 401 that spends the last attempt sends
  `Retry-After` too.
- **[20] — `ADMIN_PASSWORD_HASH` must have its `$` escaped as `\$`.** Next loads
  the environment through `@next/env`, which runs dotenv-expand over `process.env`
  itself and silently deletes every `$16384`-looking fragment — in `.env.local`
  and in systemd's `EnvironmentFile=` alike. Found by smoke-testing issue 20: the
  service started, the page rendered, and the correct password was rejected
  forever. `lib/env.ts` now shape-checks the hash at the boot gate and accepts
  either form (plain `dotenv`, used by `prisma.config.ts`, does not un-escape);
  `gen:hash` prints the escaped line. Documented in CONTEXT §3, flagged in issue
  35 for the production runbook.
- **[21](./issues/21-proxy-guard-and-security-headers.md) — the proxy matcher
  includes `/api/**`.** Every CSP example excludes it; copying that would have
  silently removed the 401 guard and the CSRF check. Only `_next/static`,
  `_next/image` and `favicon.ico` are excluded.
- **[21] — CSRF allows a missing `Origin` and accepts `X-Forwarded-Host`.**
  Browsers send `Origin` on every non-GET/HEAD request, so its absence means a
  CLI client, and CSRF needs a browser; requiring it would break `curl` to
  defend against nothing. `X-Forwarded-Host` is accepted because not every NPM
  configuration preserves `Host`, and rejecting on that would 403 every admin
  mutation in production while working in dev. The check runs *before* the
  session, so a valid cookie does not excuse a cross-origin `DELETE`.
- **[21] — CSP allows scripts by nonce + `strict-dynamic`.** That forces dynamic
  rendering, which broke the one static route left: `/_not-found` came back with
  12 un-nonced scripts and never hydrated. `src/app/not-found.tsx` calls
  `connection()` and replaces Next's default 404 with a token-styled one. Every
  route is now `ƒ`. `unsafe-eval`, inline styles and the absence of
  `upgrade-insecure-requests` are all development-only branches.
- **[22](./issues/22-admin-tools-api.md) — a typed slug collides, a derived slug
  suffixes.** An entered slug is a decision, so a collision is `409 SLUG_TAKEN`;
  a derived one takes the next free suffix. Deletion removes the file *then* the
  row, so a refusal means nothing happened. `?deleteFile` must be exactly
  `"true"`. Audit `detail` carries relative paths, because the P6 reporting UI
  will render those rows in a browser.
- **[22] — registering a symlink stores the target's real path,** because
  `resolveWithinRoot` realpaths. PRD §8.2's "not a symlink" refusal therefore
  cannot fire through the create path: it is defence for rows that stopped
  describing what they described — hand-edited, restored from an old backup, or
  a file swapped for a link after registration.
- **[22] — `source: "upload"` derives `<UPLOAD_SUBDIR>/<fileName>`,** because
  `Upload` has no column for the final path. Issue 30 must persist it; noted on
  that ticket. Uploads using its optional `targetSubdir` will 404 until then.
- **`⌘K` focuses the search input in v1.** The hint stays and does something real;
  it upgrades to the command palette in P6 (PRD §13 row 13) with no change to the
  affordance. Affects issue 13.

## Fog

Empty. The four gaps found during the breakdown were resolved before coding
started — see Decisions so far.

## Platform — read before writing Next-specific code

Scaffolded on **Next.js 16.3.0 / React 19.2.8 / Node 26.5.0**, on the standing
instruction to track latest. PRD §4 and its change log record the move and the
accepted risk (Node 26 is Current, not LTS until October 2026).

Next 16 differs from most training data. `AGENTS.md` at the repo root, regenerated
by every `next dev`, points at the version-matched docs in
`node_modules/next/dist/docs/`. **Read the relevant guide there before writing
Next-specific code.** The deltas that hit this project:

| Delta | Consequence here |
|---|---|
| `middleware.ts` → **`src/proxy.ts`**, on the **Node** runtime, not Edge | Issue 21 renamed. ADR-0001's module split withdrawn. |
| `params`, `searchParams`, `cookies()`, `headers()` are **Promises** | `await` them in issues 11, 12, 17, 18, and every `[id]` route |
| **Turbopack is the default** bundler | No `--turbopack` flag in `pnpm dev` / `pnpm build` |
| **`next lint` removed** | `pnpm lint` calls the ESLint CLI |
| Route types are generated | `pnpm typecheck` runs `next typegen` first, or a clean checkout fails on `LayoutProps` |

**Prisma 7.9.1** also differs from PRD §6 as originally written:

| Delta | Consequence here |
|---|---|
| Generator is `prisma-client` with an explicit `output` | Client is TypeScript in `src/generated/prisma/`, gitignored, rebuilt by `postinstall` |
| `url = env(...)` removed from the datasource | Lives in `prisma.config.ts`, which loads `.env.local` itself — the CLI has no Next-style convention |
| **A driver adapter is mandatory** | `@prisma/adapter-better-sqlite3`; bare `new PrismaClient()` throws |
| Raw SQLite integers return as `BigInt` | `PRAGMA busy_timeout` is `5000n`, not `5000` |
| `tsconfig` target must be ≥ ES2020 | Raised to ES2022 — `fileSize` is BigInt and the literals do not compile under the scaffold's ES2017 |

`corepack` is unbundled from Node 25+, so pnpm is installed with `npm i -g pnpm`
in development and in PRD §12.2's provisioning alike.
