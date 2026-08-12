# 01 — Scaffold the Next.js 16 app

Status: resolved
Phase: P0
Blocked by: none
Spec: PRD §4, PRD §10, CONTEXT §8 step 1

## Why

Everything else needs a working toolchain. This issue produces no product
behaviour on purpose — it ends at a blank page that builds, types, lints, and
tests clean.

## Scope

- `create-next-app`: TypeScript **strict**, App Router, `src/`, Tailwind v4, ESLint.
- pnpm as the package manager. Pin Node 22 LTS in `.nvmrc` and `package.json#engines`.
- `shadcn/ui` init (Radix primitives) + `lucide-react`.
- Create the directory skeleton from PRD §10 — `src/components/{ui,public,admin}`,
  `src/lib`, `tests/`, `deploy/`, `prisma/`. Empty is fine; the layout is the contract.
- Wire the scripts from CONTEXT §4 into `package.json`. Scripts whose target does
  not exist yet (`db:seed`, `gen:hash`, …) may be stubs that exit non-zero with a
  "not implemented" message — they must not silently succeed.
- Vitest configured and running.

## Done when

- [x] `pnpm dev` serves a page
- [x] `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0

## Answer

Scaffolded on **Next.js 16.3.0 / React 19.2.8 / Node 26.5.0 / pnpm 11.21.0**,
TypeScript strict, App Router, `src/`, Tailwind v4, ESLint flat config.
All four gates verified from a clean `.next`; `pnpm dev` returns 200.

Deviations from this issue as written, all recorded in the map's Platform table
and PRD §4's change log:

- **Next 16, not 15**, and **Node 26.5.0, not 22 LTS** — on the instruction to
  track latest. Node 26 is Current, not LTS until October 2026; accepted.
- **Turbopack is the default**, so no `--turbopack` flag is needed anywhere.
- **`pnpm typecheck` runs `next typegen` first.** Without it a clean checkout
  fails on `LayoutProps`, which is a generated global — this cost a build.
- **`corepack` is unbundled from Node 25+**; pnpm installed via `npm i -g pnpm`.
- **pnpm 11 no longer reads `pnpm.onlyBuiltDependencies` from `package.json`.**
  Build-script approvals live in `pnpm-workspace.yaml` under `allowBuilds`;
  esbuild (vitest) and prisma are approved there.
- `AGENTS.md` is committed — Next regenerates it on every `next dev` and it
  points at the version-matched docs in `node_modules/next/dist/docs/`.
- No `git init`. The repo is still not under version control; `.gitignore` is in
  place from the scaffold, so `git init` whenever you want it.

`tests/scaffold.test.ts` guards the pieces that would silently rot: the pinned
Node version, the full CONTEXT §4 script list, and the `next typegen` step.

## Watch out

- Tailwind v4 is **CSS-first**. There is no `theme` block in a JS config; the
  tokens go in `globals.css` (issue 02). Do not let the scaffold leave a
  `tailwind.config.ts` theme extension behind.
- `create-next-app` may add default Tailwind palette classes to the starter page.
  Delete them — issue 02 adds an ESLint rule that will reject them anyway.
