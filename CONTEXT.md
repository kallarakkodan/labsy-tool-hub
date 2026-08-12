# CONTEXT — Labsy Tool Hub

Working context for anyone (human or agent) writing code in this repo. The **[PRD](./PRD.md)** defines *what* and *why*; this file defines *how we build it here*. When the two disagree, the PRD wins on requirements and this file wins on implementation convention.

---

## 1. One-paragraph orientation

A Next.js 15 App Router app, dark-mode only, that catalogues large binary artifacts stored on a single Ubuntu 24.04 server and serves them over the LAN. Public visitors browse cards and download. An admin, behind a shared-password cookie session, registers artifacts either by browsing the server's filesystem (files already `rsync`'d in) or by chunked resumable browser upload. Prisma + SQLite holds metadata only — **file bytes never live in the database and, in production, never pass through Node**.

### Settled decisions

Nothing is pending sign-off. These are fixed; the reasoning is in PRD §16.

| | Decision |
|---|---|
| **D1 Transport** | TLS terminated at **Nginx Proxy Manager**; certs managed there, out of scope. NPM proxies straight to Node `:3000` — **no nginx on the app host** (PRD §12.4). Cookies stay `Secure`. |
| **D2 Storage** | `STORAGE_ROOT=/srv/downloads`, setgid + inherited default POSIX ACLs (`g:labsy:rX`) so anything `rsync`'d in is readable without a manual `chmod`. |
| **D3 Visibility** | Per-tool `visibility: "public" \| "admin"` ships in v1. Discovery control, not a security boundary. |
| **D4 Retention** | Never auto-delete an artifact. Record `lastDownloadAt`, surface a **Stale** filter, let a human decide. |
| **D5 Capacity** | 20 sustained / 50 burst concurrent downloads. SSD-backed storage assumed. |

---

## 2. The seven things that will bite you

Read these before writing anything.

> **First, the platform.** This is **Next.js 16**, which differs from most training
> data and from a lot of what you'll find by searching. Before writing Next-specific
> code, read the relevant guide in `node_modules/next/dist/docs/` — `AGENTS.md` at
> the repo root says the same thing and Next regenerates it on every `next dev`.
> The four deltas that touch this codebase:
>
> - **The route guard is `src/proxy.ts`, not `middleware.ts`.** Renamed in 16, and
>   it runs on the **Node.js** runtime — not Edge, not configurable. The export is
>   `export function proxy(request)`. This is why ADR-0001 has no Edge/Node module split.
> - **`params` is a Promise** in route handlers and pages, as are `cookies()`,
>   `headers()`, and `searchParams`. `await` them. `pnpm typecheck` runs
>   `next typegen` first so the `PageProps<'/t/[slug]'>` and `RouteContext` helpers exist.
> - **Turbopack is the default** for `next dev` and `next build`. No `--turbopack` flag.
> - **`next lint` is gone.** `pnpm lint` calls the ESLint CLI directly.

1. **`fileSize` is a `BigInt`.** `JSON.stringify(BigInt)` throws `TypeError: Do not know how to serialize a BigInt`. Every tool leaving an API handler goes through `serializeTool()` in `lib/serialize.ts`, which stringifies it. Client-side, sizes are strings; parse with `Number()` only for formatting.
2. **Never call `fs` from a route handler.** All filesystem access goes through `lib/storage.ts`. That module is the single security boundary for path traversal (PRD §11.1). A direct `fs.readdir(userInput)` anywhere else is an automatic PR rejection.
3. **Never buffer a file in memory.** No `await request.arrayBuffer()` on an upload chunk, no `fs.readFile` on an artifact. Streams only, via `stream/promises` `pipeline()`. A single `readFile` on an 8 GB ISO OOMs the service.
4. **Upload and download routes need `export const runtime = 'nodejs'`.** The Edge runtime has no `fs`. Also set `export const dynamic = 'force-dynamic'` on anything reading the filesystem or session, or Next will try to statically prerender it at build time and fail.
5. **Never send an absolute host path to the client.** Everything crossing the wire is relative to `STORAGE_ROOT`. The DB stores absolute paths; the API translates. Leaking `/srv/downloads/...` into the browser is an information disclosure and makes the storage root un-relocatable.
6. **The client IP is behind a proxy.** Requests arrive `browser → NPM → Node`, so `request.ip` is NPM's address (or `127.0.0.1` if co-located) and the real client is in `X-Forwarded-For`. The login rate limiter keys on IP — get this wrong and every failed login on the LAN shares one bucket, so one person fat-fingering their password five times locks out the entire office. Use `clientIp()` in `lib/request.ts`, which takes `xff.split(",")[0].trim()` and validates it as an IP, falling back to the socket address. Never key a limiter on a raw `X-Forwarded-For` string.
7. **Never hand-roll a tool `where` clause.** Two independent flags hide a tool — `published: false` (draft) and `visibility: "admin"` (internal). Every read path calls `toolVisibilityWhere(isAdmin)` from `lib/db.ts`. A stray `where: { published: true }` silently exposes every internal tool, and nothing will fail loudly when it does. Out-of-scope lookups return **404, not 403** — a 403 confirms the tool exists.

---

## 3. Environment

`.env.example` (committed) — real values live in `.env.local` (dev, gitignored) and `/etc/labsy-hub/env` (prod, mode 0640).

```bash
# --- Core ---
DATABASE_URL="file:./prisma/dev.db"          # prod: file:/var/lib/labsy-hub/db.sqlite
STORAGE_ROOT="/srv/downloads"                # dev: ./storage — MUST exist and be readable
NEXT_PUBLIC_APP_VERSION="1.0.0"              # shown in the header tag

# --- Auth ---
ADMIN_PASSWORD_HASH=""                       # scrypt hash; generate: pnpm gen:hash
AUTH_SECRET=""                               # >=32 random bytes; openssl rand -base64 48
SESSION_TTL_HOURS="8"
COOKIE_SECURE="true"                         # dev-only escape hatch; boot FAILS if false in production

# --- Uploads ---
CHUNK_SIZE="16777216"                        # 16 MiB. nginx client_max_body_size must exceed this
UPLOAD_SUBDIR="uploads"                      # relative to STORAGE_ROOT
UPLOAD_TTL_HOURS="24"

# --- Serving ---
USE_X_ACCEL="false"                          # leave false: Node streams. Only true if NPM is
                                             # co-located AND has the storage root mounted (PRD §12.4)
X_ACCEL_PREFIX="/_protected"                 # must match the proxy's `internal` location
```

**Boot-time validation.** `lib/env.ts` parses this with Zod and the process **exits non-zero** if `AUTH_SECRET` is missing/short, `ADMIN_PASSWORD_HASH` is empty, `STORAGE_ROOT` does not exist or is not a readable directory, or `COOKIE_SECURE=false` while `NODE_ENV=production`. Fail loudly at start, never silently at 2am.

---

## 4. Commands

```bash
pnpm dev                # next dev  (Turbopack is the default in Next 16)
pnpm build && pnpm start
pnpm typecheck          # next typegen && tsc --noEmit
pnpm lint               # eslint  (next lint was removed in Next 16)
pnpm test               # vitest run
pnpm test:security      # vitest run tests/storage.test.ts  ← must pass before shipping P3

pnpm db:push            # prisma db push (dev iteration)
pnpm db:migrate         # prisma migrate dev
pnpm db:studio
pnpm db:seed            # insert demo tools + placeholder files under STORAGE_ROOT/seed
pnpm db:seed:clear      # delete WHERE isSeed = true, remove STORAGE_ROOT/seed

pnpm gen:hash           # prompts for a password, prints ADMIN_PASSWORD_HASH
```

---

## 5. Design tokens — the only place colors are defined

Tailwind v4 is CSS-first. `src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-base:          #0A0A0B;
  --color-surface:       #121214;
  --color-surface-hover: #161618;
  --color-inset:         #0E0E10;
  --color-border:        #27272A;
  --color-border-hover:  #3F3F46;
  --color-fg:            #E4E4E7;
  --color-fg-muted:      #71717A;
  --color-fg-subtle:     #52525B;
  --color-accent:        #10B981;
  --color-accent-hover:  #34D399;
  --color-danger:        #EF4444;
  --color-warning:       #F59E0B;

  --radius-card:   8px;
  --radius-button: 6px;

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  --ease-out-quart: cubic-bezier(0.4, 0, 0.2, 1);
}

body {
  background-color: var(--color-base);
  color: var(--color-fg);
  background-image: radial-gradient(60% 40% at 50% 0%, rgba(16,185,129,0.05), transparent 100%);
  background-repeat: no-repeat;
  background-attachment: fixed;
  letter-spacing: -0.01em;
}

h1, h2, h3 { letter-spacing: -0.02em; font-weight: 600; }
```

Usage: `bg-surface`, `text-fg-muted`, `border-border`, `rounded-card`, `font-mono`.

**Banned in `src/`:** `bg-gray-*`, `text-zinc-*`, `bg-black`, `text-white`, `bg-green-*`, `shadow-lg`/`shadow-xl`/`shadow-2xl`, `rounded-full` (except elements ≤ 8px), `bg-gradient-to-*`, `backdrop-blur-lg`+. An ESLint rule (`no-restricted-syntax` on `className` literals) enforces the palette bans; the rest is code review.

### Component recipes

```tsx
// Card
"group rounded-card border border-border bg-surface p-5 transition-all duration-150 \
 hover:-translate-y-1 hover:border-border-hover hover:bg-surface-hover \
 motion-reduce:hover:translate-y-0"

// Primary button
"rounded-button bg-accent px-4 py-2 text-sm font-medium text-base transition-colors \
 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"

// Secondary button
"rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg \
 transition-colors hover:border-border-hover hover:bg-surface-hover"

// Category pill — active
"rounded-button border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"

// Metadata line
"font-mono text-xs text-fg-muted tabular-nums"

// Input
"rounded-card border border-border bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle \
 focus:border-border-hover focus:outline-none focus:ring-2 focus:ring-accent/35"
```

`tabular-nums` on every numeric readout — file sizes and progress percentages must not jitter as digits change.

---

## 6. Architectural conventions

**Server Components by default.** `"use client"` only for: search input, category pills, upload dropzone, modals/slide-overs, the admin table, and the health dot. The public grid is rendered on the server; the client filters an already-hydrated list (the catalogue is tens of items, not thousands — no server round-trip per keystroke).

**Route Handlers, not Server Actions,** for anything touching files. Server Actions cannot stream a request body or set streaming response headers. Server Actions are acceptable for small metadata mutations, but for consistency all mutations go through `/api/**` so the API contract in PRD §9 is the single source of truth.

**Zod schemas are shared.** `lib/validation.ts` exports `toolCreateSchema`, `toolUpdateSchema`, `browseQuerySchema`, `uploadInitSchema`. The form uses them via `react-hook-form` + `zodResolver`; the handler re-parses the same schema. Client validation is UX, server validation is truth.

**Errors.** Handlers return `apiError(code, message, status)` from `lib/api.ts`, producing `{ error: { code, message } }`. Codes are `SCREAMING_SNAKE` and stable — the client switches on them. `console.error` the real exception server-side; never include `err.message` from an `fs` call in the response body (it contains absolute paths).

**Prisma singleton** in `lib/db.ts` with the `globalThis` guard, or dev hot-reload exhausts connections. Enable WAL once at boot: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`.

**Naming.** Components `PascalCase.tsx`, everything else `kebab-case.ts`. Types in `types/index.ts`, prefixed nothing (`Tool`, not `ITool`).

---

## 7. Key implementations, in full

These four are where correctness matters most. Write them first; everything else composes around them.

### 7.1 `lib/storage.ts` — the security boundary

```ts
import path from "node:path";
import fs from "node:fs/promises";

let cachedRoot: string | null = null;

export async function getRoot(): Promise<string> {
  if (!cachedRoot) cachedRoot = await fs.realpath(process.env.STORAGE_ROOT!);
  return cachedRoot;
}

export class PathError extends Error {
  constructor(readonly code: "INVALID_PATH" | "PATH_OUTSIDE_ROOT" | "NOT_FOUND", msg: string) {
    super(msg);
  }
}

/** Resolve a client-supplied relative path to an absolute path guaranteed to sit under STORAGE_ROOT. */
export async function resolveWithinRoot(relative: string): Promise<string> {
  if (relative.includes("\0")) throw new PathError("INVALID_PATH", "Invalid path");
  if (relative.length > 4096) throw new PathError("INVALID_PATH", "Path too long");

  const root = await getRoot();

  // normalize('/' + p) collapses leading `..` segments so they cannot escape.
  const safeRel = path.normalize("/" + relative.replace(/\\/g, "/")).slice(1);
  const target = path.resolve(root, safeRel);

  // realpath is what defeats symlinks pointing outside the root.
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new PathError("NOT_FOUND", "Path does not exist");
  }

  // `real === root ||` + path.sep — a bare startsWith(root) would accept /srv/downloads-evil.
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new PathError("PATH_OUTSIDE_ROOT", "Path is outside the storage root");
  }
  return real;
}

/** Absolute path -> path relative to root, for sending to the client. */
export async function toRelative(absolute: string): Promise<string> {
  return path.relative(await getRoot(), absolute);
}
```

`listDirectory()` and `statFile()` build on `resolveWithinRoot` and are the only other exports. The `.uploads` directory is filtered out inside `listDirectory`, not at the call site.

**`tests/storage.test.ts` is written alongside this file, not after.** Every row of PRD §11.1 gets a case, plus a real symlink created in a temp fixture root.

### 7.2 Download handler shape

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1. load tool via toolVisibilityWhere(await isAdmin()) — 404 if missing, draft, or internal
// 2. resolveWithinRoot(tool.filePath) — re-validate; the DB is not trusted
// 3. stat -> ENOENT: mark fileMissing, return 410 FILE_MISSING
// 4. void bumpDownloadCount(id)  — no await, never block the response
// 5. headers: Content-Disposition (RFC 5987), Content-Type, Content-Length,
//    Accept-Ranges: bytes, ETag "<size>-<mtimeMs>", Cache-Control private
// 6. DEFAULT: parse Range, createReadStream({start,end}),
//            Readable.toWeb(stream) as BodyInit, 206 + Content-Range when ranged.
//            Destroy the stream on request.signal abort or a cancelled download leaks an fd.
//    if USE_X_ACCEL (opt-in, PRD §12.4): return new Response(null, { headers: {
//            "X-Accel-Redirect": `${X_ACCEL_PREFIX}/${encodeURI(relPath)}`, ...headers } })
```

The `X-Accel-Redirect` path must be **URI-encoded** — filenames contain spaces and parentheses. `Content-Disposition` needs both the ASCII fallback and the `filename*=UTF-8''` form.

### 7.3 Chunk `PUT` handler shape

```ts
export const runtime = "nodejs";
export const maxDuration = 0;         // no timeout; a 16 MiB chunk over Wi-Fi is slow

// index from ?index=, validated as an integer in [0, totalChunks)
// upload row loaded and checked: status === 'pending', not expired
// const dest = path.join(upload.tempDir, `${index}.part`)   // tempDir already inside root
// await pipeline(Readable.fromWeb(request.body), createWriteStream(dest))
// atomically add `index` to upload.received (JSON array), return { received: index, count }
```

`complete` concatenates parts in index order into one write stream **while** feeding a `crypto.createHash("sha256")` — one pass over the data, not two. Verify total bytes written equals `totalSize` before moving the file into place, then `rm -rf` the temp dir.

### 7.4 `toolVisibilityWhere` — the other single choke point

```ts
import type { Prisma } from "@prisma/client";

/**
 * The ONLY place tool visibility is decided. Every read path — public API, RSC page,
 * download handler, sitemap, search — passes its result into `where`.
 * Two independent axes: `published` (ready?) and `visibility` (for everyone?).
 */
export function toolVisibilityWhere(isAdmin: boolean): Prisma.ToolWhereInput {
  if (isAdmin) return {};                                  // admins see drafts and internal tools
  return { published: true, visibility: "public" };
}
```

Usage is always `where: { ...toolVisibilityWhere(isAdmin), ...otherFilters }` — spread it first so a later key cannot accidentally override it. When a lookup misses, return `404`; returning `403` tells an anonymous visitor that an internal tool by that name exists.

`isAdmin` comes from `await getSession()` in `lib/auth.ts`, which returns `null` for anonymous. Never derive it from a query parameter, a header, or anything else the client controls.

---

## 8. Build order

Each step should end with something runnable. Do not start N+1 until N works.

1. **Scaffold** — `create-next-app` (TS, Tailwind v4, App Router, `src/`), pnpm, shadcn init, self-hosted Inter + JetBrains Mono via `next/font/local`, `globals.css` tokens from §5, `lib/env.ts` boot validation. *Done when:* a themed blank page renders with the correct background and radial gradient.
2. **Data layer** — Prisma schema (PRD §6), `db:push`, `lib/db.ts` (incl. `toolVisibilityWhere`, §7.4), `lib/serialize.ts`, seed script + placeholder files. *Done when:* `db:seed` and `db:seed:clear` both work.
3. **`lib/storage.ts` + tests** — §7.1 plus the full traversal suite. *Done when:* `pnpm test:security` is green. **Do this before any UI.**
4. **Public read path** — `GET /api/tools`, `GET /api/download/[id]` (Node-stream branch with Range), `GET /api/health`.
5. **Public UI** — layout, header + search + health dot, category pills, `ToolCard`, `ToolGrid`, skeleton + empty states, URL-synced filters, copy-command menu.
6. **Auth** — `lib/auth.ts` (scrypt + timing-safe compare, sealed cookie), `gen:hash` script, login page, `proxy.ts`, rate limiter.
7. **Admin CRUD** — dashboard table, slide-over form with Zod, admin API routes, delete dialog with the file-deletion choice.
8. **Server browser** — `GET /api/browse` on top of `lib/storage.ts`, the explorer modal, wire it into the form's Server Path tab.
9. **Chunked upload** — the five upload routes, the dropzone + progress client, retry/resume, free-space preflight, janitor.
10. **Production** — checksums, `fileMissing` sweep timer, systemd unit, NPM proxy host + the required Advanced-tab directives (PRD §12.5), default ACLs on the storage root, backup script, deploy runbook. Verify against PRD §14.

---

## 9. Testing

| Area | Tool | What |
|---|---|---|
| Path traversal | Vitest | Every case in PRD §11.1, against a temp fixture root with a real escaping symlink. Non-negotiable. |
| Serialization | Vitest | `serializeTool` on a `BigInt` > 2^53 survives `JSON.stringify` round-trip. |
| Upload protocol | Vitest | Out-of-order chunks; short final chunk; missing chunk → 409; size mismatch → 409; resume returns the right `received` set. |
| Range requests | Vitest | `0-1023`, `1024-`, `-512`, unsatisfiable → 416. |
| Auth | Vitest | Wrong password → 401; 6 attempts → 429; tampered cookie rejected; expired session rejected. |
| Visibility | Vitest | Anonymous `/api/tools` excludes drafts and `visibility: "admin"`; anonymous download of each returns **404, not 403**; admin session sees both. Add a case per new read path. |
| E2E happy path | Playwright (optional) | Login → create tool from server path → appears publicly → downloads. |

Manual pre-release checklist lives in PRD §14. The large-file cases (8 GB upload, network-drop resume, 1 GbE saturation) are manual and must be run on the real server before declaring v1.

---

## 10. Conventions for realistic content

No Lorem Ipsum, ever — including in placeholder props, Storybook-style examples, and loading skeletons. Use the seed set in PRD §15. All demo rows carry `isSeed: true` so `db:seed:clear` removes them cleanly and the empty state is reachable without hand-editing the DB. The empty state reads:

> **No tools yet.** Add your first tool from the admin panel, or point the hub at a file already on the server.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Tool** | One catalogue entry: metadata + exactly one file (v1) |
| **STORAGE_ROOT** | The single directory tree the app may read from; nothing outside it is reachable, by design |
| **Server path source** | Registering a file already on disk — no bytes copied |
| **Direct upload** | Chunked browser upload landing in `STORAGE_ROOT/uploads/` |
| **X-Accel-Redirect** | nginx header letting the app authorise a download while the proxy serves the bytes. Off by default here — Node streams instead (PRD §12.4) |
| **Chunk** | One 16 MiB slice of an upload, stored as `<index>.part` until `complete` |
| **fileMissing** | Flag set when a registered path no longer resolves; renders the card as Unavailable |
| **isSeed** | Marks demo rows so they can be purged in one command |
| **Draft** | `published: false` — not ready; hidden from everyone but admins |
| **Internal** | `visibility: "admin"` — ready, but deliberately not in the public catalogue |
| **Stale** | No download in 180 days, or never downloaded; surfaced for review, never auto-deleted |
| **NPM** | Nginx Proxy Manager — the existing edge proxy that terminates TLS in front of this service |

---

## 12. Related documents

- **[PRD.md](./PRD.md)** — requirements, API contract, security model, deployment, acceptance criteria
- `deploy/` — systemd unit, nginx config, backup script (created in step 10)
- `.env.example` — the authoritative list of environment variables
