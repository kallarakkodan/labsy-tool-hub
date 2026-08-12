# Map — Labsy Tool Hub v1.0

Spec: [spec.md](./spec.md) · Requirements: [PRD.md](../../PRD.md) · Conventions: [CONTEXT.md](../../CONTEXT.md)

## Frontier

**01, 02, 03 resolved.** Next workable, all three unblocked and independent:

- **04** — Prisma schema + `toolVisibilityWhere` (opens the data/API track)
- **08** — `lib/storage.ts` (opens the security track; 09 follows immediately)
- **18** — `lib/auth.ts` + `gen:hash` (opens the auth track)

Work in numeric order unless you want to run the tracks in parallel.

One commit per issue on `main`, message `feat(NN): …` closing that issue, so any
issue can be reverted on its own.

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

   [18] + [19] ──▶ 20 login routes + page
                   └─ 21 proxy guard + headers + CSRF
                      └─ 22 admin tools API + AuditLog
                         ├─ 23 dashboard table + Stale filter
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
