# PRD — Labsy Tool Hub

**Internal LAN File Distribution Platform**

| Field | Value |
|---|---|
| Product name | Labsy Tool Hub (`download.labsy.in`) |
| Version | 1.0 |
| Status | Draft — pre-implementation |
| Author | Jyothish |
| Last updated | 2026-08-12 |
| Target environment | Ubuntu Server 24.04 LTS, LAN-only (no public internet exposure) |

---

## 1. Overview

### 1.1 Problem

Large binary artifacts — OS images, installers, deployer executables, driver bundles — are currently distributed across the LAN through ad-hoc means (SMB shares, USB drives, chat attachments). This has no discoverability, no version tracking, no integrity guarantees, and no single URL an engineer can paste into a runbook.

### 1.2 Solution

A self-hosted web application that presents every distributable artifact as a browsable card in a premium, dark-mode catalogue. Engineers search, filter, and download in two clicks. Administrators register artifacts either by uploading through the browser (chunked and resumable) or by pointing the app at a file already staged on the server via SSH/rsync/SMB.

### 1.3 Non-goals (v1)

- Multi-user accounts, roles, or SSO. One shared admin password is sufficient for LAN use.
- Public internet exposure or CDN distribution.
- Torrent/P2P distribution.
- File editing, transcoding, or virus scanning (see §13 for future consideration).
- Mobile app. The web UI is responsive; that is the extent of mobile support.

### 1.4 Success criteria

| Metric | Target |
|---|---|
| Time from landing on homepage to download start | < 10 seconds, ≤ 2 clicks |
| Sustained download throughput on 1 GbE LAN | ≥ 900 Mbit/s (line rate) |
| Admin registers a pre-staged 8 GB ISO | < 30 seconds (no byte copying) |
| Browser upload of a 8 GB file survives a Wi-Fi drop | Resumes from last completed chunk |
| Node process RSS while 20 clients download concurrently | < 300 MB |
| Lighthouse performance score, homepage | ≥ 95 |

---

## 2. Personas

**Priya — Field Engineer (primary consumer).** Needs the correct Windows deployment image for a customer site, right now, from a laptop on the office LAN. Does not know or care where the file lives on disk. Wants to confirm she has the newest version and that the download is not corrupt.

**Arun — Infrastructure Admin (primary publisher).** Already `rsync`s multi-gigabyte ISOs to the server overnight. Refuses to re-upload them through a browser. Wants to point-and-click a file that is already on disk and have it appear in the catalogue with correct size and checksum.

**Meera — Junior Technician (occasional publisher).** Has a 400 MB utility on her laptop. Will drag-and-drop it into the browser. Needs a progress bar and a clear "you may not close this tab" affordance — or better, a resumable upload that tolerates her closing the lid.

---

## 3. Scope and phasing

| Phase | Contents | Exit criteria |
|---|---|---|
| **P0 — Foundation** | Repo scaffold, design tokens, Prisma schema, seed script, health endpoint | `npm run dev` serves a themed empty state |
| **P1 — Public catalogue** | Header, search, category filter, card grid, download route with Range support | An engineer can find and download a seeded tool |
| **P2 — Admin core** | Password gate, session cookie, dashboard table, create/edit/delete via server-path source | Admin can register a pre-staged file end to end |
| **P3 — Server browser** | Secure `/api/browse`, file-explorer modal, path-traversal test suite | Admin can navigate to any file under the storage root and nothing above it |
| **P4 — Chunked upload** | Init/chunk/complete/resume protocol, drag-drop zone, progress + resume UI | 8 GB upload survives a forced network interruption |
| **P5 — Production hardening** | systemd unit, NPM proxy host, checksums, backups, deploy runbook | Deployed on Ubuntu 24.04, saturates the LAN link |
| **P6 — Enhancements** | Multi-asset tools, download analytics, audit log, integrity sweep | See §13 |

P0–P5 constitute v1.0. P6 is post-launch.

---

## 4. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Server Components keep the client bundle small; Route Handlers give raw Node streams for uploads/downloads |
| Styling | Tailwind CSS v4 (CSS-first `@theme` config) | Design tokens live in CSS, matching §5 exactly |
| Components | shadcn/ui (Radix primitives), Lucide icons | Accessible, unstyled-by-default, restyled to the token set |
| Data | SQLite via Prisma, WAL mode | Single-file DB, trivial backup, zero daemon. Handles LAN-scale read load comfortably |
| Validation | Zod, shared between client forms and API handlers | One schema, no drift |
| Session | Encrypted HttpOnly cookie — JWE via `jose` (ADR-0001) | No session store needed |
| Table | TanStack Table (headless) | Sorting/filtering on the admin dashboard without visual opinions |
| Uploads | Custom chunked protocol over `PUT` (§9) | No third-party upload server; resumability without tus complexity |
| File serving | Node streams with `fs.createReadStream` + Range support | At 1 GbE the NIC saturates long before Node does (§12.4). `X-Accel-Redirect` stays behind a config flag for a future 10 GbE link. |
| Process mgmt | systemd | Native to Ubuntu 24.04 |
| Runtime | Node.js 26.5.0 | Latest release line. Note it is **Current**, not LTS until October 2026 — accepted deliberately (see change log) |

**Package manager:** `pnpm`. **Node version pinned** in `.nvmrc` (`26.5.0`) and `package.json#engines` (`>=26`).

`corepack` was unbundled from Node 25, so pnpm is installed with `npm i -g pnpm`
rather than activated through corepack — in development and in §12.2's
provisioning alike.

---

## 5. Design system

The aesthetic target is "premium developer tool" — Vercel, Linear, Raycast. Dark mode only; no theme toggle. Every value below is normative.

### 5.1 Color tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0A0A0B` | Page background (deep obsidian, never `#000`) |
| `--bg-surface` | `#121214` | Cards, modals, table rows, popovers |
| `--bg-surface-hover` | `#161618` | Card/row hover fill |
| `--bg-inset` | `#0E0E10` | Inputs, code blocks, path displays |
| `--border` | `#27272A` | Default 1px border on all surfaces |
| `--border-hover` | `#3F3F46` | Border on hover/focus-within |
| `--text-primary` | `#E4E4E7` | Headings, tool names, body |
| `--text-secondary` | `#71717A` | Metadata, descriptions, labels, timestamps |
| `--text-tertiary` | `#52525B` | Disabled, placeholders |
| `--accent` | `#10B981` | Primary buttons, active filter, download icons |
| `--accent-hover` | `#34D399` | Accent hover state |
| `--accent-muted` | `rgba(16,185,129,0.10)` | Accent-tinted backgrounds (active pill, icon tile) |
| `--accent-ring` | `rgba(16,185,129,0.35)` | Focus rings |
| `--danger` | `#EF4444` | Destructive actions, missing-file state |
| `--warning` | `#F59E0B` | Stale/unverified states |

**Accent discipline:** at most one accent-filled element per card and one per toolbar. Accent is a signal, not decoration.

### 5.2 Typography

| Role | Family | Spec |
|---|---|---|
| Headings | Inter (`next/font/local`, self-hosted) | weight 600, `letter-spacing: -0.02em` |
| Body / UI | Inter | weight 400–500, `letter-spacing: -0.01em` |
| Technical data | JetBrains Mono (self-hosted) | file sizes, versions, checksums, paths, byte counts |

Fonts are **self-hosted** — the server has no internet egress. Subset to `latin` and preload via `next/font/local` with `display: swap`.

### 5.3 Shape, elevation, motion

- **Radius:** `8px` on cards, modals, inputs, and dropzones. `6px` on buttons, pills, and badges. `rounded-full` **only** for status dots (≤ 8px) and avatar-like icon chips.
- **Elevation:** borders, not shadows. The single permitted shadow is on modal/slide-over overlays: `0 16px 48px rgba(0,0,0,0.55)`.
- **Background texture:** one fixed radial gradient at the top of the viewport, `radial-gradient(60% 40% at 50% 0%, rgba(16,185,129,0.05), transparent)`. Nothing else.
- **Card hover:** `translateY(-4px)` + border to `--border-hover` + surface to `--bg-surface-hover`, `transition: 160ms cubic-bezier(0.4, 0, 0.2, 1)`.
- **Respect `prefers-reduced-motion`** — drop the transform, keep the color transition.

### 5.4 Anti-slop rules (rejection criteria in review)

Reject any PR containing: heavy/coloured drop shadows; multi-stop or diagonal gradients; glassmorphism blur; emoji in UI copy; `rounded-full` buttons; default Tailwind palette classes (`bg-gray-800`, `text-green-500`, …) instead of tokens; Lorem Ipsum; a spinner where a skeleton belongs; more than two font weights on one screen.

### 5.5 Empty, loading, and error states

Every list surface defines all four states. Loading is a **skeleton** matching final layout (never a centred spinner). Empty states carry one line of copy and, where relevant, one primary action. Errors state what failed and what to do next — never "Something went wrong."

---

## 6. Data model

```prisma
// prisma/schema.prisma
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model Tool {
  id           String   @id @default(cuid())
  slug         String   @unique              // url-safe, derived from name, stable
  name         String
  description  String                        // plain text, 2-line clamp on card
  category     String                        // free text; distinct values drive filters
  version      String                        // free text: "22.04.4 LTS", "v3.1.0-rc2"

  filePath     String                        // ABSOLUTE path, must resolve under STORAGE_ROOT
  fileName     String                        // basename presented to the client
  fileSize     BigInt                        // bytes, snapshotted at registration
  mimeType     String   @default("application/octet-stream")
  checksum     String?                       // lowercase hex sha256
  checksumAt   DateTime?

  iconUrl      String?                       // optional image URL or /uploads/icons/... path
  notes        String?                       // markdown-lite, shown in detail drawer

  published    Boolean  @default(true)       // false = draft, invisible to everyone but admins
  visibility   String   @default("public")    // "public" | "admin"  — see §16 D3
  featured     Boolean  @default(false)
  isSeed       Boolean  @default(false)      // enables `db:seed:clear` to purge demo rows
  fileMissing  Boolean  @default(false)      // set by the integrity sweep

  downloadCount Int     @default(0)
  lastDownloadAt DateTime?

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([category])
  @@index([published, visibility, createdAt])
  @@index([lastDownloadAt])                  // powers the stale-tool report (§13 #15)
}

model Upload {                                // in-flight chunked uploads
  id          String   @id @default(cuid())
  fileName    String
  totalSize   BigInt
  chunkSize   Int
  totalChunks Int
  received    String   @default("[]")         // JSON array of completed chunk indices
  tempDir     String
  status      String   @default("pending")    // pending | completed | aborted
  createdAt   DateTime @default(now())
  expiresAt   DateTime                        // now + 24h; janitor reaps
}

model AuditLog {                              // P6, schema landed in P2
  id        String   @id @default(cuid())
  action    String                            // tool.create | tool.update | tool.delete | auth.login.fail | upload.complete
  targetId  String?
  detail    String?                           // JSON
  actorIp   String?
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

**`BigInt` note:** SQLite stores it as INTEGER (64-bit) — safe for files > 2 GB. `JSON.stringify` cannot serialise `BigInt`; every API response must convert `fileSize` to a **string** at the serialisation boundary. Enforce with a single `serializeTool()` helper — this is the most likely source of a runtime crash in this codebase.

**Categories:** free-text on `Tool` rather than a table. Filter options are derived with `SELECT DISTINCT category`. This satisfies "dropdown with ability to type new category" with no join and no orphan-category cleanup.

**`published` vs `visibility` — two different axes, do not conflate them:**

| | `published: false` | `visibility: "admin"` |
|---|---|---|
| Meaning | Work in progress, not ready | Ready, but internal-only |
| Visible to anonymous LAN user | No | No |
| Visible to logged-in admin | Yes, badged **Draft** | Yes, badged **Internal** |
| Download by anonymous user | `404` | `404` (never `403` — do not confirm existence) |

Both filters are applied in a single shared `toolVisibilityWhere(isAdmin)` helper in `lib/db.ts`. Every read path calls it. A query that hand-rolls `where: { published: true }` is a bug waiting to leak an internal tool.

---

## 7. Public experience

### 7.1 Header

Sticky, 64px, `--bg-base` at 80% opacity with `backdrop-blur-sm`, 1px bottom border.

- **Left:** wordmark "Internal Tool Hub" (Inter 600, `-0.02em`) preceded by a 20px accent glyph.
- **Centre:** search input, max-width 480px, `--bg-inset`, magnifier icon, `⌘K` / `Ctrl K` kbd hint. Focus moves the border to `--border-hover` and adds the accent ring. Filters cards client-side, debounced 120ms, matching name + description + category + version.
- **Right:** LAN status dot — 6px `rounded-full`, accent when `/api/health` returns ok, `--warning` while polling, `--danger` on failure — plus a mono build/version tag. Polls every 30s.

### 7.2 Toolbar

Horizontally scrollable row of category pills, 6px radius. Inactive: `--bg-surface` + `--border`. Active: `--accent-muted` background, `--accent` text, accent border. `All` is always first and shows a total count. Right-aligned: a sort control (Newest, Name A–Z, Largest) and a result count in mono (`24 tools`).

Search and category selection are reflected in the URL query string (`?q=&category=&sort=`) so a filtered view is shareable and survives reload.

### 7.3 Tool card

Grid: 1 / 2 / 3 columns at base / `md` / `lg`, 16px gap, page max-width 1280px.

```
┌──────────────────────────────────────────────┐
│ ▢ icon 40px          OS IMAGE          ↓     │   category badge + download affordance
│                                              │
│ Ubuntu 22.04.4 LTS Server                    │   Inter 600, 15px, --text-primary
│ Minimal server image with cloud-init and     │   14px, --text-secondary, line-clamp-2
│ the standard Labsy provisioning overlay.     │
│                                              │
│ ─────────────────────────────────────────    │   1px --border
│ 2.1 GB · v22.04.4        Added 12 Aug 2026   │   JetBrains Mono 12px, --text-secondary
└──────────────────────────────────────────────┘
```

- The **entire card is a link** to `/api/download/[id]` (`<a download>`), so middle-click, right-click → Save As, and copy-link all behave natively. Do **not** simulate the click with JavaScript.
- Icon: custom `iconUrl` if present, else a Lucide glyph mapped from extension (`.iso`/`.img` → `Disc3`, `.exe`/`.msi` → `AppWindow`, `.zip`/`.tar.gz` → `FileArchive`, `.deb`/`.rpm` → `Package`, `.sh`/`.ps1` → `Terminal`, default → `FileDown`). Rendered on an `--accent-muted` tile, 8px radius.
- A secondary **kebab menu** (stops propagation) offers: *Copy download URL*, *Copy `curl` command*, *Copy `wget` command*, *Copy SHA-256*, *Details*.
- `fileMissing === true` renders the card at 60% opacity, replaces the badge with a `--danger` "Unavailable" chip, and disables the link.

**Copy-command snippets** are a deliberate addition — they turn every card into a paste-ready line for runbooks and headless machines:

```
curl -fL -O http://download.labsy.in/api/download/<id>
wget --content-disposition http://download.labsy.in/api/download/<id>
```

### 7.4 Detail drawer (optional within v1, P1 stretch)

Right slide-over showing full description, notes, absolute-free metadata (size, checksum with copy button, mime, version, added/updated dates, download count), and the three copy-command snippets. Deep-linkable at `/t/[slug]`.

---

## 8. Admin experience

### 8.1 Authentication

- Route `/admin/login`. Single password field, no username.
- Compared against `ADMIN_PASSWORD_HASH` (scrypt) using a **timing-safe** comparison.
- Success sets `labsy_session`: HttpOnly, `SameSite=Lax`, **`Secure`** (production serves HTTPS only — §16 D1), `Path=/`, 8-hour expiry, encrypted+signed with `AUTH_SECRET` (≥ 32 bytes). The `COOKIE_SECURE` env var exists solely so `pnpm dev` works over `http://localhost`; it defaults to `true` and startup refuses to accept `false` when `NODE_ENV=production`.
- Rate limit: 5 failed attempts per IP per 15 minutes, in-memory sliding window, `429` with `Retry-After`. Failures are written to `AuditLog`.
- `src/proxy.ts` guards `/admin/**` (redirect to login) and `/api/admin/**`, `/api/browse`, `/api/uploads/**` (401 JSON). Next.js 16 renamed `middleware.ts` to `proxy.ts`; it runs on the Node.js runtime and performs a real session decrypt, not a cookie-presence check (ADR-0001).
- Logout `POST /api/auth/logout` clears the cookie.

**Explicitly accepted risk:** a shared password over a LAN, with the app never exposed to the internet (§11.4). Documented, not hidden.

### 8.2 Dashboard `/admin`

Header row: "Tools" + count, right-aligned **Add New Tool** (accent, 6px radius, `Plus` icon). Below, a search input and category filter mirroring the public toolbar.

Table columns: Name (+ filename in mono, `--text-secondary`), Category (badge), Size (mono, right-aligned), Version (mono), Path (mono, middle-truncated with a tooltip and copy button), Status (Published / **Draft** / **Internal** / **Missing** chip — `--text-secondary`, `--warning`, `--accent` outline, and `--danger` respectively), Downloads (+ last-downloaded on hover), Updated (relative), Actions.

A **Stale** filter (default off) narrows the table to tools with `lastDownloadAt` older than 180 days or null, sorted oldest-first — the retention workflow from §16 D4.

Actions: `Pencil` → edit slide-over; `Copy` → duplicate as draft; `Trash2` → destructive confirm dialog.

**Delete dialog** requires an explicit choice, defaulting to the safe one:
- ◉ Remove from catalogue (keep the file on disk) — default
- ○ Remove and permanently delete the file from the server

The second option is only offered when the file resolves inside `STORAGE_ROOT`, is not a symlink, and is not referenced by another `Tool` row. Confirm button is `--danger` and requires typing the tool name when file deletion is selected.

### 8.3 Add/Edit slide-over

Right-hand slide-over, 560px, `--bg-surface`, 1px left border, `Escape`/overlay to close with a dirty-state guard. Fields:

| Field | Control | Validation |
|---|---|---|
| Tool Name | text | required, 2–80 chars; slug auto-derived, editable, uniqueness checked on blur |
| Description | textarea, 3 rows, counter | required, ≤ 280 chars |
| Category | combobox (select existing or type new) | required, ≤ 40 chars, trimmed, title-cased on save |
| Version | text, mono | required, ≤ 40 chars |
| **File source** | segmented control: `Server Path` \| `Upload` | see below |
| Icon URL | text, optional, with live 40px preview | must be `http(s)` or a `/`-rooted local path |
| Notes | textarea, optional | ≤ 2000 chars |
| Published | switch, default on | off = Draft |
| Internal only | switch, default off | on = `visibility: "admin"`; helper text: *"Hidden from the public catalogue. Only visible while signed in to the admin panel."* |

**Source A — Server Path.** Read-only mono input showing the selected path, plus a **Browse Server** button opening the file explorer modal (§8.4). Manual paste is allowed but revalidated server-side on submit: must resolve under `STORAGE_ROOT`, must be a regular file, must be readable. On selection, size and mtime are fetched and displayed; the checksum is computed asynchronously after save (§11.3).

**Source B — Direct Upload.** Drag-and-drop zone (8px radius, dashed `--border`, accent border and `--accent-muted` fill on drag-over). On file selection the chunked upload begins immediately (§9) and the zone becomes a progress panel: filename, `1.42 GB / 8.10 GB`, percentage, throughput and ETA in mono, a 4px accent progress bar, and **Pause** / **Cancel**. Copy under the bar: *"Upload resumes automatically if the connection drops. You can pause, but keep this tab open."* Form submit is disabled until the upload completes.

Save is blocked until a valid file source exists. Edit mode pre-selects the current source and permits switching (the old file is never touched automatically).

### 8.4 Server file browser modal

640px modal, `--bg-surface`.

- **Breadcrumb** of the path relative to `STORAGE_ROOT`, rendered as clickable mono segments, rooted at a `HardDrive` icon labelled `storage`. The absolute host path is never shown to the client.
- **List:** directories first, then files, each alphabetical. Row = icon + name (mono) + size (files, mono, right) + mtime. Directories are 1-click to descend; files are 1-click to select (row gets an accent border), double-click to select and confirm.
- **Controls:** up-one-level button (disabled at root), a filter input, a "show hidden files" toggle (default off), and a refresh button.
- **Footer:** selected filename + size on the left; `Cancel` / `Select File` on the right.
- **States:** skeleton rows while loading; "This folder is empty" empty state; a `--danger` inline message for permission errors (`EACCES`) naming the directory.
- All paths crossing the wire are **relative to the storage root**. The client never sends or receives an absolute host path.

---

## 9. API specification

All responses are JSON with `Content-Type: application/json`, except downloads. All errors use:

```json
{ "error": { "code": "PATH_OUTSIDE_ROOT", "message": "Human-readable explanation" } }
```

`fileSize` and `totalSize` are **strings** in all JSON payloads (BigInt, §6).

### 9.1 Public

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/tools` | `?q=&category=&sort=newest\|name\|size&page=&limit=` (default limit 100). Returns `{ tools: [], total, categories: [{name, count}] }`. Scoped by `toolVisibilityWhere(isAdmin)` — an admin session additionally sees drafts and internal tools, each flagged in the payload. |
| `GET` | `/api/tools/[id]` | Single tool, by id or slug. Same visibility scoping; `404` (never `403`) when out of scope. |
| `GET` | `/api/download/[id]` | See §9.4. |
| `GET` | `/api/health` | `{ ok, version, uptime, storageRootWritable, dbOk, toolCount }`. No auth, no DB writes. |

### 9.2 Admin (session cookie required)

| Method | Route | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | `{ password }` → sets cookie. Rate limited. |
| `POST` | `/api/auth/logout` | Clears cookie. |
| `GET` | `/api/admin/tools` | Includes unpublished and `fileMissing`. |
| `POST` | `/api/admin/tools` | Create. Body validated by shared Zod schema. Resolves and stats the file; rejects if outside root. |
| `PUT` | `/api/admin/tools/[id]` | Full update. |
| `PATCH` | `/api/admin/tools/[id]` | Partial (used by the Published switch). |
| `DELETE` | `/api/admin/tools/[id]` | `?deleteFile=true` to also unlink. Guarded per §8.2. |
| `POST` | `/api/admin/tools/[id]/checksum` | Enqueue/recompute SHA-256. |
| `GET` | `/api/browse` | See §9.3. |
| `GET` | `/api/admin/categories` | Distinct categories with counts. |

### 9.3 `GET /api/browse`

**Request:** `?path=<relative-path>` — relative to `STORAGE_ROOT`, defaults to `""` (root). `?showHidden=true` optional.

**Resolution algorithm (implement exactly, in this order):**

1. Reject if `path` contains a NUL byte or is longer than 4096 bytes.
2. `const root = await fs.realpath(process.env.STORAGE_ROOT)` — resolved once at boot and cached.
3. `const target = path.resolve(root, path.normalize('/' + userPath).slice(1))` — the `normalize('/'+p)` trick neutralises leading `..` segments before resolution.
4. `const real = await fs.realpath(target)` — this is what defeats symlink escapes.
5. Reject unless `real === root || real.startsWith(root + path.sep)`.
6. `lstat` the target; reject if it is not a directory.
7. `readdir(withFileTypes: true)`; for each entry, `lstat` it. Skip symlinks whose `realpath` falls outside `root`. Skip dotfiles unless `showHidden`. Always skip the internal `.uploads` directory.

**Response:**

```json
{
  "path": "isos/ubuntu",
  "parent": "isos",
  "entries": [
    { "name": "jammy", "type": "dir",  "size": null,       "mtime": "2026-08-01T10:12:00.000Z" },
    { "name": "ubuntu-22.04.4-live-server-amd64.iso",
      "type": "file", "size": "2306867200", "mtime": "2026-08-10T04:31:00.000Z", "ext": ".iso" }
  ]
}
```

**Errors:** `400 INVALID_PATH`, `403 PATH_OUTSIDE_ROOT`, `404 NOT_FOUND`, `403 EACCES` (message names the directory), `401 UNAUTHORIZED`.

Directory listings are capped at 5,000 entries with a `truncated: true` flag.

### 9.4 `GET /api/download/[id]`

1. Look up the tool through `toolVisibilityWhere(isAdmin)`; `404` if absent, unpublished, or `visibility: "admin"` without a session. Return `404`, not `403` — a `403` confirms the tool exists.
2. Re-validate `filePath` against `STORAGE_ROOT` (defence in depth — the DB is not trusted).
3. `stat`; on `ENOENT`, set `fileMissing = true` and return `410 FILE_MISSING`.
4. Increment `downloadCount` and set `lastDownloadAt` — fire-and-forget, never blocking the response.
5. Set headers:
   - `Content-Disposition: attachment; filename="ascii-fallback"; filename*=UTF-8''<encoded>`
   - `Content-Type: <mimeType>`
   - `Content-Length: <size>`
   - `Accept-Ranges: bytes`
   - `Cache-Control: private, max-age=0, must-revalidate`
   - `ETag: "<size>-<mtimeMs>"`, `Last-Modified`
6. **Default (`USE_X_ACCEL=false`):** stream with `fs.createReadStream`, parsing `Range` and returning `206 Partial Content` + `Content-Range` when present, `416` on an unsatisfiable range. Destroy the stream on client abort so a cancelled download does not leak a file handle.
7. **Optional (`USE_X_ACCEL=true`, §12.4):** emit `X-Accel-Redirect: <prefix>/<path-relative-to-root>` (URI-encoded) with an empty body and let the proxy serve the bytes. Only available when the proxy can read the storage root.

`HEAD` is supported and returns identical headers with no body.

### 9.5 Chunked upload protocol

Storage: `STORAGE_ROOT/.uploads/<uploadId>/<index>.part`. Default `CHUNK_SIZE` = 16 MiB (nginx `client_max_body_size` must exceed it — §12.4 sets 32m).

| Method | Route | Body | Response |
|---|---|---|---|
| `POST` | `/api/uploads/init` | `{ fileName, totalSize, mimeType? }` | `{ uploadId, chunkSize, totalChunks, received: [] }` |
| `GET` | `/api/uploads/[id]` | — | `{ uploadId, received: [0,1,2], totalChunks, status }` — the resume query |
| `PUT` | `/api/uploads/[id]/chunk?index=N` | raw bytes (`application/octet-stream`) | `{ received: N, count }` |
| `POST` | `/api/uploads/[id]/complete` | `{ targetSubdir?, overwrite? }` | `{ filePath, fileName, fileSize, checksum }` |
| `DELETE` | `/api/uploads/[id]` | — | `204`, temp dir removed |

**Rules:**
- `fileName` is sanitised to a basename, stripped of path separators, control characters, and leading dots; collisions get a ` (2)` suffix unless `overwrite` is set.
- `PUT` streams the request body straight to disk with `pipeline()`. Never buffer a chunk in memory. Requires `export const runtime = 'nodejs'` and `export const maxDuration = 0`.
- Chunks may arrive out of order; the client uploads sequentially in v1 but the server must not assume it.
- `complete` verifies every index `0..totalChunks-1` is present and that each part's size matches expectation (last chunk may be short), then concatenates in order into `STORAGE_ROOT/uploads/<subdir>/<fileName>` via a single write stream, computing SHA-256 **during** the concatenation pass (one read, not two). Then it removes the temp dir.
- Final size mismatch → `409 SIZE_MISMATCH`, temp dir preserved for diagnosis.
- Free-space preflight at `init`: `statvfs`-equivalent via `check-disk-space`; reject with `507 INSUFFICIENT_STORAGE` if `totalSize * 2.1` exceeds free bytes (concatenation transiently needs both copies).
- A janitor (on boot + hourly) deletes `Upload` rows and temp dirs past `expiresAt`.
- Uploads are admin-only.

**Client behaviour:** on any chunk failure, retry that chunk 3× with exponential backoff (1s/2s/4s); on further failure, pause and surface a **Resume** button. On page load with an in-flight upload id in `sessionStorage`, `GET /api/uploads/[id]` and offer to resume — the user re-picks the file (browsers cannot persist a `File` handle), the client verifies name and size match, and skips already-received chunks.

---

## 10. Directory layout

```
download.labsy.in/
├─ PRD.md
├─ CONTEXT.md
├─ .env.example
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                 # fonts, radial gradient, <html class="dark">
│  │  ├─ page.tsx                   # public catalogue (RSC)
│  │  ├─ t/[slug]/page.tsx          # detail drawer route
│  │  ├─ admin/
│  │  │  ├─ layout.tsx              # auth guard + admin chrome
│  │  │  ├─ page.tsx                # dashboard
│  │  │  └─ login/page.tsx
│  │  └─ api/
│  │     ├─ health/route.ts
│  │     ├─ tools/route.ts
│  │     ├─ tools/[id]/route.ts
│  │     ├─ download/[id]/route.ts
│  │     ├─ browse/route.ts
│  │     ├─ auth/login/route.ts
│  │     ├─ auth/logout/route.ts
│  │     ├─ admin/tools/route.ts
│  │     ├─ admin/tools/[id]/route.ts
│  │     └─ uploads/…
│  ├─ components/
│  │  ├─ ui/                        # shadcn primitives, restyled
│  │  ├─ public/                    # Header, SearchBar, CategoryPills, ToolCard, ToolGrid
│  │  └─ admin/                     # ToolTable, ToolFormSheet, ServerBrowserModal, UploadDropzone
│  ├─ lib/
│  │  ├─ db.ts                      # Prisma singleton
│  │  ├─ auth.ts                    # hash, verify, session seal/unseal
│  │  ├─ storage.ts                 # resolveWithinRoot, listDirectory, statFile  ← security core
│  │  ├─ checksum.ts
│  │  ├─ serialize.ts               # BigInt → string boundary
│  │  ├─ format.ts                  # bytes, dates, throughput
│  │  ├─ icons.ts                   # extension → Lucide component
│  │  ├─ rate-limit.ts
│  │  └─ validation.ts              # Zod schemas shared client/server
│  └─ proxy.ts                      # route guard — Next 16's name for middleware.ts
├─ deploy/
│  ├─ labsy-hub.service
│  ├─ npm-advanced.conf          # §12.5 directives, pasted into NPM; not read locally
│  └─ backup.sh
└─ tests/
   ├─ storage.test.ts               # path traversal suite — must pass before P3 ships
   └─ upload.test.ts
```

---

## 11. Security

### 11.1 Path traversal (highest-severity risk)

Every filesystem operation goes through `lib/storage.ts`. No route handler calls `fs` directly. `resolveWithinRoot()` implements §9.3's algorithm and is the single choke point. Attacks it must defeat, each with a test case:

| Attack | Input |
|---|---|
| Relative escape | `../../etc/passwd` |
| Encoded escape | `%2e%2e%2f%2e%2e%2fetc/passwd` |
| Double-encoded | `%252e%252e%252f` |
| Absolute path | `/etc/shadow` |
| Null byte | `foo\0.iso` |
| Symlink escape | a symlink inside the root pointing at `/etc` |
| Prefix confusion | root `/srv/downloads`, target `/srv/downloads-evil` |
| Windows separators | `..\..\windows\system32` |
| Overlong path | 5000-char string |

The prefix-confusion case is why the check is `real === root || real.startsWith(root + path.sep)` and never a bare `startsWith(root)`.

### 11.2 Other controls

- **Input validation:** every request body and query string parsed by Zod; unknown keys stripped.
- **Filename sanitisation:** uploads and `Content-Disposition` values are basenames only, control characters removed, RFC 5987 encoded.
- **Rate limiting:** login (5/15min/IP), browse (60/min/session), upload init (20/hour/session). The client IP is taken from the first `X-Forwarded-For` entry, not the socket — two proxy hops sit in front (§12.4). Keying on the socket address would put the whole LAN in one bucket and let a single mistyped password lock everyone out.
- **Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and a CSP without `unsafe-eval`. Downloads always carry `Content-Disposition: attachment` so a stored HTML/SVG can never execute in the site's origin.
- **CSRF:** `SameSite=Lax` plus an `Origin`/`Host` match check on all state-changing requests.
- **Secrets:** `AUTH_SECRET` and `ADMIN_PASSWORD_HASH` in `/etc/labsy-hub/env` (mode 0600, owned by the service user), never committed. Startup fails loudly if either is missing or default.
- **Error hygiene:** absolute host paths and stack traces never reach the client in production.
- **Logging:** admin mutations and auth failures to `AuditLog`; downloads to nginx's access log.

### 11.3 Integrity

SHA-256 is computed in a background job (upload: during concatenation; server-path registration: streamed read after save, bounded to one concurrent hash). While pending, the UI shows "Computing…" in mono. Users verify with `sha256sum <file>` against the copy button on the card. A weekly `systemd` timer re-stats every registered path and sets `fileMissing` where appropriate; §13 covers full re-hashing.

### 11.4 Threat model boundary

The system assumes a **trusted LAN**. It is not hardened against a determined authenticated insider and must not be exposed to the internet. Enforced by `ufw` allowing 80/443 only from the LAN CIDR (§12.5), and by nginx binding to the LAN interface.

TLS is terminated at Nginx Proxy Manager (§16 D1). This protects the admin password and session cookie from passive capture on the wire — the concrete, realistic LAN threat — but it is **not** a substitute for the network boundary: any device on the LAN can still reach the catalogue, and the hop from NPM to the app host is plain HTTP. If internet exposure is ever required, the following become mandatory and are explicitly out of scope today: per-user accounts with individual credentials, MFA on the admin panel, and a WAF rule set at the NPM layer.

---

## 12. Deployment — Ubuntu Server 24.04 LTS

### 12.1 Layout

| Path | Purpose | Owner | Mode |
|---|---|---|---|
| `/opt/labsy-hub` | Application (built) | `labsy:labsy` | 0755 |
| `/srv/downloads` | `STORAGE_ROOT` — artifacts | `labsy:labsy` | 0755 |
| `/srv/downloads/.uploads` | Chunk temp | `labsy:labsy` | 0700 |
| `/var/lib/labsy-hub/db.sqlite` | Database | `labsy:labsy` | 0640 |
| `/etc/labsy-hub/env` | Secrets | `root:labsy` | 0640 |
| `/var/backups/labsy-hub/` | Nightly DB backups | `labsy:labsy` | 0750 |

### 12.2 Provisioning

```bash
sudo adduser --system --group --home /opt/labsy-hub labsy
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt-get install -y nodejs sqlite3 acl        # no nginx on this host — §12.4
sudo npm i -g pnpm                                 # corepack is unbundled from Node 25+
sudo install -d -o labsy -g labsy -m 2775 /srv/downloads     # 2xxx = setgid
sudo install -d -o labsy -g labsy -m 0700 /srv/downloads/.uploads
sudo install -d -o labsy -g labsy -m 0750 /var/lib/labsy-hub /var/backups/labsy-hub
sudo install -d -o root  -g labsy -m 0750 /etc/labsy-hub
```

**Guaranteeing the service can read staged files (§16 D2).** Arun's `rsync` target is `/srv/downloads/**`. Relying on the uploading account's `umask` is fragile — it depends on that account's shell profile, and `rsync -p` preserves the *source* file's mode, ignoring umask entirely. Use **default POSIX ACLs** instead, which are inherited by every new file and directory regardless of how it arrives:

```bash
sudo setfacl -R  -m g:labsy:rX /srv/downloads   # existing content
sudo setfacl -R -d -m g:labsy:rX /srv/downloads # default: applies to everything created later
```

The setgid bit on the directory additionally forces new entries to inherit group `labsy`. Together these make "the file is there but the app can't read it" structurally impossible, whether the file arrives by `rsync`, `scp`, Samba, or a root shell. Verify with `sudo -u labsy test -r <file> && echo readable`.

Add `/srv/downloads` as a Samba share (`force group = labsy`, `create mask = 0664`, `directory mask = 2775`) if SMB staging is wanted; the ACLs make it safe either way.

### 12.3 systemd — `deploy/labsy-hub.service`

```ini
[Unit]
Description=Labsy Tool Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=labsy
Group=labsy
WorkingDirectory=/opt/labsy-hub
EnvironmentFile=/etc/labsy-hub/env
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000 -H 127.0.0.1   # LAN IP if NPM is remote
Restart=always
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/downloads /var/lib/labsy-hub
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

`ProtectSystem=strict` + a narrow `ReadWritePaths` means a path-traversal bug that slips past §11.1 still cannot write outside the storage root — belt and braces.

### 12.4 Request path

```
Browser ──HTTPS──▶ Nginx Proxy Manager ──HTTP──▶ Node :3000 ──▶ /srv/downloads
              (TLS terminated here)         (auth, metadata, file streaming)
```

**There is no nginx on the app host.** Earlier drafts put one there to consume `X-Accel-Redirect` so Node would never touch file bytes. On this deployment that does not pay for itself, and the arithmetic is not close:

| | |
|---|---|
| LAN ceiling | 1 GbE = **125 MB/s aggregate**, no matter how the bytes are served |
| Node streaming a file | several hundred MB/s single-stream — the NIC saturates first |
| 20 concurrent downloads | 125 MB/s total, ~6 MB/s each; roughly a quarter of one core |
| Memory | `createReadStream` with backpressure holds ~64 KB per stream; 20 streams ≈ 20 MB |

`X-Accel-Redirect` earns its keep at multi-gigabit throughput or thousands of concurrent connections. At 20 users on 1 GbE it buys nothing measurable while adding a second proxy, a second config file, a second place to set `proxy_request_buffering off`, and a second component to diagnose when a download misbehaves. The disk is the real constraint (§12.8), and nginx does not make the disk faster.

Node binds `127.0.0.1:3000` if NPM is on the same host, or the LAN interface if not (§12.3). NPM proxies straight to it.

**Static assets** need no special handling: Next.js already serves `/_next/static/` with `immutable` cache headers, the files are small, and every client caches them after one visit. Add caching at NPM later if a profile ever says otherwise.

#### Optional: X-Accel if NPM is co-located

The `USE_X_ACCEL` code path stays in the app, because it costs one branch in one handler and turns a future problem into a config change. Enable it only if NPM runs on the **same host** as `/srv/downloads` and you have measured a reason to.

Bind-mount the storage root into the NPM container (`/srv/downloads:/data/downloads:ro`), add to the proxy host's Advanced tab:

```nginx
location /_protected/ { internal; alias /data/downloads/; }
```

and set `USE_X_ACCEL=true`, `X_ACCEL_PREFIX=/_protected`. NPM then serves the bytes with `sendfile` and Node's involvement per download ends in single-digit milliseconds.

If NPM is on a *different* host it cannot `open()` the files, so this is unavailable — and standing up an app-host nginx purely to enable it is the trade this section rejects.

**Revisit if:** the LAN moves to 10 GbE (Node becomes the ceiling at ~1.25 GB/s), sustained concurrency passes ~100, or profiling shows the Node process CPU-bound during downloads.

### 12.5 Nginx Proxy Manager integration

**TLS is managed in NPM and is out of scope for this document.** Certificate issuance, renewal, and the Force SSL toggle are operator concerns. This section covers only the proxy-host settings the application depends on to function.

Point a proxy host at the app host on port `3000`, then paste the following into its **Advanced** tab. These are an integration contract, not tuning — uploads and large downloads break without them:

```nginx
client_max_body_size 32m;        # > CHUNK_SIZE (16 MiB); NPM's default may be lower
proxy_request_buffering off;     # stream upload chunks through; do not spool to disk
proxy_buffering off;             # stream downloads through without buffering
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
send_timeout 3600s;
proxy_set_header X-Forwarded-Proto $scheme;
```

`proxy_request_buffering off` is the one most easily missed: NPM would otherwise write every 16 MiB chunk to its own container disk before forwarding it, doubling write I/O, filling the container's filesystem during a large upload, and making the client's progress bar meaningless.

`proxy_buffering off` matters for downloads — with buffering on, NPM accumulates response data before forwarding, which delays the browser's save dialog and wastes memory on multi-gigabyte files.

Leave **Block Common Exploits** off; its rule set rejects some legitimate paths and there is nothing to defend against on a closed LAN. Websockets are not used.

**Cookie flag.** `COOKIE_SECURE=true` assumes NPM serves the site over HTTPS. If it is ever fronted by plain HTTP, set `COOKIE_SECURE=false` in `/etc/labsy-hub/env` — otherwise the browser silently discards the session cookie and login appears to succeed but never sticks. This is the only place the app's behaviour couples to the TLS decision.

### 12.6 Firewall and release

The app host is not the edge — NPM is. It therefore only needs to accept traffic from NPM:

```bash
sudo ufw allow from <NPM-IP> to any port 3000 proto tcp
sudo ufw enable
```

If NPM runs on the same host, bind Node to `127.0.0.1:3000` (as §12.3 does) and skip the rule entirely — nothing is then reachable from the network except through NPM.

Release procedure: `git pull` → `pnpm install --frozen-lockfile` → `pnpm prisma migrate deploy` → `pnpm build` → `sudo systemctl restart labsy-hub`. Zero-downtime is out of scope; a 3-second restart is acceptable and does not interrupt in-flight downloads, which nginx is serving directly.

### 12.7 Backups

`deploy/backup.sh`, run nightly by a systemd timer: `sqlite3 db.sqlite ".backup /var/backups/labsy-hub/db-$(date +%F).sqlite"`, gzip, retain 14 days. Artifacts in `/srv/downloads` are **not** backed up by this job — they are reproducible and large; document that separately.

TLS material needs no backup here — the certificate lives in Nginx Proxy Manager, which renews it automatically and carries its own backup story.

### 12.8 Capacity

Sized for **20 sustained concurrent downloads, 50 burst** (§16 D5). The constraint is disk and NIC, not CPU: 20 clients saturating a 1 GbE link is ~125 MB/s aggregate, comfortably within a single SATA SSD and roughly at the limit of a 7200rpm HDD doing concurrent reads. If storage is spinning disk, expect seek contention above ~8 concurrent streams and plan for an SSD or a RAID10 array.

Node serves those streams at roughly a quarter of one core (§12.4), so `MemoryMax=1G` and a single process are ample. The numbers to watch as the system grows are link speed and concurrency, not Node.

nginx defaults handle this without tuning; `worker_connections 1024` (the default) covers 50 downloads plus browsing with three orders of magnitude to spare. Node sees roughly one 5 ms request per download, so `MemoryMax=1G` in the unit file is generous. Revisit only if sustained concurrency exceeds 100.

---

## 13. Enhancements beyond the original brief

Each is justified, not speculative.

| # | Enhancement | Why | Phase |
|---|---|---|---|
| 1 | `X-Accel-Redirect` behind a config flag | Not enabled by default — at 1 GbE it buys nothing measurable (§12.4). Kept as one branch in one handler so a 10 GbE upgrade is a config change rather than a rewrite. | P5 |
| 2 | HTTP Range support | Corporate download managers, `curl -C -`, and any resumed download need it. Hand-rolled in the Node stream path, ~30 lines, and needed for local development regardless. | P1 |
| 3 | SHA-256 + copy button | These are OS images and executables. "Did it transfer correctly?" is the first question anyone asks. | P5 |
| 4 | Chunked resumable upload | Meera's 8 GB upload over Wi-Fi *will* fail. A non-resumable upload is a feature that does not work. | P4 |
| 5 | Copy `curl` / `wget` snippets | Half the consumers are headless Ubuntu boxes. This makes the hub usable from a terminal without inspecting the DOM. | P1 |
| 6 | `fileMissing` detection sweep | Files registered by path get moved or deleted out-of-band. Silent 404s destroy trust in the catalogue. | P5 |
| 7 | Download counters | Answers "can we delete the 2019 image?" with data. One integer column. | P2 |
| 8 | Audit log | Shared password means no attribution; at minimum record *what* changed and *when*. | P6 |
| 9 | URL-synced search/filter state | Engineers paste links to each other. `?category=OS+Images` should work. | P1 |
| 10 | Multi-asset tools (`ToolFile[]`) | One tool, several platform builds (win/linux/mac, x64/arm64) is the natural next request. Deliberately deferred — v1 ships one file per tool; the migration adds a `ToolFile` table and backfills one row per `Tool`. | P6 |
| 11 | Free-space preflight | A failed upload that fills the root partition takes the server down. | P4 |
| 12 | Import-from-directory scan | Arun stages 12 ISOs; a "scan storage root for unregistered files" view creates draft entries in bulk. | P6 |
| 13 | `⌘K` command palette | Matches the Linear/Raycast idiom the design system is quoting. | P6 |
| 14 | systemd sandboxing | Defence in depth for the one class of bug (path traversal) that would otherwise be catastrophic. | P5 |
| 15 | Stale-tool report | Retention decision D4: never auto-delete an artifact, but surface the candidates. A `lastDownloadAt` column plus a **Stale** filter (>180 days or never) turns "can we delete the 2019 image?" into a two-click answer with evidence. | P2 |
| 16 | `visibility: admin` on a tool | Decision D3. One enum column and one shared `where` clause lets internal-only tooling live in the same catalogue without appearing to general LAN users. Cheap enough that omitting it would be the odd choice. | P2 |

**Considered and rejected:** virus scanning (ClamAV on 8 GB ISOs is hours of CPU for a trusted-LAN threat model), S3/MinIO backend (adds a daemon for no LAN benefit), Postgres (SQLite handles this read pattern with room to spare), light mode (explicitly out of scope), Docker (systemd + nginx is simpler to operate on a single Ubuntu box and avoids bind-mount permission friction on the storage root).

---

## 14. Acceptance criteria

**Public**
- [ ] Homepage renders the card grid at 1/2/3 columns and hits Lighthouse ≥ 95.
- [ ] Search filters within 150ms of keystroke and updates the URL.
- [ ] Category pills filter correctly; `All` shows every published tool.
- [ ] Clicking a card starts a download with the correct filename, size, and `Content-Disposition`.
- [ ] Right-click → Copy link yields a working URL; `curl -O` on it downloads the file.
- [ ] `curl -r 0-1023` returns `206` with exactly 1024 bytes.
- [ ] An unpublished tool is absent from `/api/tools` and returns 404 on download.
- [ ] A `visibility: "admin"` tool is absent from the anonymous `/api/tools` response and returns **404** (not 403) on anonymous download, while appearing badged **Internal** to a logged-in admin.
- [ ] A tool whose file was deleted renders as Unavailable and returns `410`.
- [ ] Every color, radius, and font in the shipped UI matches §5; no default Tailwind palette class appears in `src/`.

**Admin**
- [ ] `/admin` redirects to `/admin/login` when unauthenticated.
- [ ] Wrong password 6× returns `429`.
- [ ] Session survives reload and expires after 8 hours.
- [ ] Create/edit/delete all work and reflect immediately in the public view.
- [ ] Delete defaults to catalogue-only removal; file deletion requires typing the tool name.
- [ ] The **Stale** filter lists tools never downloaded or idle > 180 days, oldest first.
- [ ] No scheduled job anywhere in the repo deletes a file from `STORAGE_ROOT`.

**Server browser**
- [ ] Navigating into subdirectories and back up works; root has no parent.
- [ ] Every attack in §11.1's table returns 400/403 and is covered by a passing test.
- [ ] A directory the service user cannot read shows a named permission error, not a crash.
- [ ] `.uploads` is never listed.

**Upload**
- [ ] An 8 GB file uploads with accurate progress, throughput, and ETA.
- [ ] Killing the network mid-upload and restoring it resumes from the last completed chunk with no duplicate bytes.
- [ ] Node RSS stays under 300 MB throughout.
- [ ] The completed file's `sha256sum` on disk matches the value shown in the UI.
- [ ] Cancel removes all temp chunks.
- [ ] An upload larger than free disk space is rejected at `init`.

**Production**
- [ ] A 4 GB download saturates the 1 GbE link.
- [ ] Node CPU stays below ~50% of one core and RSS below 300 MB with 20 concurrent downloads.
- [ ] Cancelling a download mid-stream does not leak a file descriptor (`ls /proc/<pid>/fd | wc -l` returns to baseline).
- [ ] 20 concurrent downloads sustain aggregate line rate; the UI stays responsive throughout.
- [ ] `systemctl restart` recovers cleanly; in-flight downloads are unaffected.
- [ ] The service cannot write outside `/srv/downloads` and `/var/lib/labsy-hub`.
- [ ] Seed data is removable with one command and the empty state renders correctly.
- [ ] An 8 GB upload through NPM does not grow NPM's container filesystem (proves `proxy_request_buffering off` is active at both hops).
- [ ] A download through NPM starts streaming immediately rather than after a delay (proves `proxy_buffering off`).
- [ ] Login succeeds and the session persists across a reload (proves `COOKIE_SECURE` matches the scheme NPM serves).
- [ ] The session cookie carries `Secure`, `HttpOnly`, and `SameSite=Lax`; the app refuses to boot with `COOKIE_SECURE=false` under `NODE_ENV=production`.
- [ ] A file dropped into `/srv/downloads` by `rsync -a` as a different user is readable by `labsy` with no manual `chmod` (`sudo -u labsy test -r <file>`).

---

## 15. Seed data

Realistic, clearly demo, and purgeable (`isSeed = true`, cleared by `pnpm db:seed:clear`). No Lorem Ipsum.

| Name | Category | Version | Size |
|---|---|---|---|
| Ubuntu 22.04.4 LTS Server | OS Images | 22.04.4 | 2.1 GB |
| Windows 11 Dev Kit | OS Images | 23H2 | 5.8 GB |
| Labsy Deployer | Utilities | 3.1.0 | 84 MB |
| Ventoy Multiboot USB | Utilities | 1.0.99 | 62 MB |
| Intel Network Driver Bundle | Drivers | 28.3 | 412 MB |
| Node.js 22 LTS Offline Installer | Dev Tools | 22.11.0 | 118 MB |

The seeder writes small placeholder files into `STORAGE_ROOT/seed/` so downloads work out of the box in development; it never fabricates paths that do not exist.

---

## 16. Resolved decisions

Every open question is decided. Each entry records the choice, the reasoning, and what would justify revisiting it. Implementation proceeds on these; no further sign-off is required.

### D1 — Transport: TLS terminated at Nginx Proxy Manager

**Decided:** NPM terminates TLS; certificate management is the operator's, handled in NPM and out of scope for this document. The app serves plain HTTP on `:3000` behind it. Session cookies stay `Secure` because the browser's connection is HTTPS. Nothing is installed on client machines.

**Why:** an earlier draft specified an internal CA via `mkcert`, on the mistaken premise that a publicly-trusted certificate was unobtainable for an internet-unreachable host. It isn't, and in any case an NPM instance already fronts this service — so the app should not be terminating TLS at all. Removing that responsibility deletes the internal CA's real cost, which was never the setup but the permanent tail of installing a root certificate on every new laptop, re-image, and contractor machine.

**What this leaves the app responsible for:** the proxy-host settings in §12.5 that uploads and large downloads depend on, and the `COOKIE_SECURE` flag. Nothing else.

**Revisit if:** the app is ever exposed beyond the LAN — at which point per-user accounts and MFA (§11.4), not transport, are the gap.

### D2 — Storage root `/srv/downloads`, readability guaranteed by default ACLs

**Decided:** `STORAGE_ROOT=/srv/downloads`, setgid bit on the directory, and inherited default POSIX ACLs granting `g:labsy:rX`. Details in §12.2.

**Why:** `/srv` is the FHS-correct location for data served by this machine — `/var` implies volatility, `/opt` is for the application itself, and a home directory would fight `ProtectHome=true` in the systemd unit. On readability, the umask approach from the previous draft was fragile: umask depends on the staging account's shell profile, and `rsync -p` (which everyone uses) preserves the *source* file's mode and ignores umask entirely. Default ACLs are inherited by anything created in the tree no matter how it arrives — rsync, scp, Samba, or a root shell — which converts the single most predictable support ticket into an impossible state.

**Cost accepted:** one extra package (`acl`) and two `setfacl` lines in provisioning.

**Revisit if:** storage moves to a filesystem without POSIX ACL support (then fall back to setgid + a group-writable umask enforced in the Samba/rsync service config).

### D3 — Per-tool `visibility: "public" | "admin"` — yes, include it

**Decided:** ship the enum in v1. Public catalogue and download route are scoped by a shared `toolVisibilityWhere(isAdmin)` helper; out-of-scope tools return `404`, never `403`. Details in §6 and §8.3.

**Why:** the previous default was "no — everything on the LAN is public," which is right about the *threat* model but wrong about the *use* model. Internal-only artifacts are inevitable in practice: a half-tested deployer, a licence-restricted vendor driver, a customer-specific image that shouldn't be browsable by everyone in the office. Without this flag, the workaround is leaving them unpublished — which conflates "not ready" with "not for everyone" and makes the draft state useless. The cost is one column, one shared `where` clause, and one switch in the form. That is small enough that omitting it would be the strange choice.

**Explicitly not claimed:** this is a discovery control, not a security boundary. Anyone with the admin password sees everything, and the password is shared. It stops casual browsing, nothing more, and the PRD says so where the feature is defined.

### D4 — Retention: never delete automatically; surface the candidates

**Decided:** no scheduled deletion of artifacts, ever. Instead, `lastDownloadAt` is recorded and the admin dashboard gains a **Stale** filter (never downloaded, or not in 180 days) sorted oldest-first. Deletion stays a deliberate human action through the existing confirm dialog, which already defaults to catalogue-only removal.

**Why:** the failure modes are wildly asymmetric. Automatically deleting a multi-gigabyte artifact that turns out to be the only copy of a customer's golden image is unrecoverable and career-defining; leaving 200 GB of stale ISOs on a disk costs a few pounds of storage and a mildly cluttered catalogue. A yearly disk-space nag is the correct forcing function, not a cron job with `rm` in it. The Stale filter gives Arun the evidence to act — "nobody has downloaded this in 14 months" — which is the actual thing missing today.

**Cost accepted:** disk usage grows monotonically until someone looks. §12.8 sizing assumes this.

**Revisit if:** storage pressure becomes routine — the next step is an archive tier (move to slower disk, keep the catalogue entry) rather than deletion.

### D5 — Capacity target: 20 sustained / 50 burst concurrent downloads

**Decided:** design and test to 20 sustained concurrent downloads, with headroom to 50. §12.8 records the sizing.

**Why:** the realistic worst case is a whole-office refresh — every engineer pulling the same new image the morning it lands. For a LAN-scale team that is tens, not hundreds. Twenty concurrent streams on 1 GbE is ~125 MB/s aggregate, which is the NIC's limit long before it is the server's, so the target is really "saturate the link and stay responsive." Node serves this comfortably (§12.4), so the number mostly constrains disk choice: SSD comfortably, spinning disk with seek contention above ~8 streams.

**Revisit if:** sustained concurrency passes 100, or if the LAN is upgraded to 10 GbE — at which point storage throughput, not the NIC, becomes the ceiling and the tuning in §12.4 (`directio`, `aio threads`) needs re-measuring rather than assuming.

---

## 17. Change log

| Date | Change |
|---|---|
| 2026-08-12 | Initial draft (v1.0). |
| 2026-08-12 | `deploy/nginx.conf` → `deploy/npm-advanced.conf` in §10's tree. The file was a leftover of the app-host nginx removed later the same day; §12.4 and §12.5 already described its replacement. See `.scratch/tool-hub-v1/map.md`. |
| 2026-08-12 | **Stack moved to current releases at scaffold time (§4).** Next.js 15 → **16.3.0** and Node 22 LTS → **26.5.0**, on the standing instruction to track latest. Consequential edits: `middleware.ts` → `src/proxy.ts`, which in Next 16 runs on the Node runtime rather than Edge (§8.1, §10, and ADR-0001, whose original Edge-driven module split was withdrawn); `nodesource setup_26.x` and `npm i -g pnpm` replacing corepack, unbundled from Node 25+ (§12.2, §4); `nginx` dropped from the app-host package list, which §12.4 had already removed. **Accepted risk:** Node 26 is the Current line, not LTS until October 2026 — a production server is running a non-LTS runtime until then, and §12.6's release procedure should pick up 26.x LTS when it lands. Also note Turbopack is the default bundler in Next 16, so `next dev`/`next build` need no `--turbopack` flag, and `params` in route handlers and pages is now a Promise. |
| 2026-08-12 | **App-host nginx removed.** It was carried over from a scale-shaped design that does not match this deployment: at 1 GbE the NIC caps aggregate throughput at 125 MB/s, which Node streams at roughly a quarter of one core, so `X-Accel-Redirect` bought nothing while adding a second proxy, config file, and failure surface. NPM now proxies straight to Node :3000. `USE_X_ACCEL` survives as a config flag for a co-located NPM or a future 10 GbE link (§12.4). Consequential edits: request path and rationale (§12.4); NPM target port 3000 (§12.5); download handler step order — Node streaming is now the default path, X-Accel the option (§9.4); tech stack row (§4); P5 scope (§3); capacity (§12.8); firewall (§12.6); enhancement rows #1 and #2 (§13); acceptance criteria now measure Node CPU/RSS and fd leaks rather than idleness (§14). |
| 2026-08-12 | **D1 revised** after learning an Nginx Proxy Manager instance already fronts this service. Internal CA (`mkcert`) dropped entirely; TLS is terminated at NPM and certificate management is out of scope. §12.5 covers only the proxy-host settings the app depends on. Consequential edits: request-path diagram and app-host nginx moved to plain HTTP on `:8080` (§12.4); §12.5 rewritten as NPM configuration incl. required `proxy_request_buffering off` at both hops and the single-layer X-Accel variant; `X-Forwarded-Proto` forwarded rather than derived; threat model (§11.4); `/etc/ssl/labsy` removed from the layout and backup set (§12.1, §12.7); firewall narrowed to the NPM source address (§12.6); root-CA catalogue entry removed (§15); acceptance criteria updated (§14). |
| 2026-08-12 | All five open questions resolved as §16 D1–D5. Consequential edits: `visibility` column and `toolVisibilityWhere` helper (§6, §8.2, §8.3, §9.1, §9.4); HTTPS-only nginx config and internal-CA runbook (§11.2, §11.4, §12.4, §12.5); default-ACL provisioning replacing umask guidance (§12.2); capacity section (§12.8); CA material added to the backup set (§12.7); stale-tool report and visibility added to the enhancement table (§13 #15, #16); acceptance criteria extended (§14). |
