# 15 — ToolCard, extension icon map, copy-command menu

Status: resolved
Phase: P1
Blocked by: 12, 13
Spec: PRD §7.3, PRD §13 row 5, CONTEXT §5 (card recipe)

## Why

The card is the product's primary surface, and the copy-command menu is what
makes the hub usable from a headless terminal.

## Scope

- Card layout exactly as the PRD §7.3 diagram: 40px icon tile on
  `--accent-muted`, category badge, download affordance, name (Inter 600, 15px),
  description (`line-clamp-2`), 1px divider, then the mono metadata line
  (`2.1 GB · v22.04.4` / `Added 12 Aug 2026`).
- **The entire card is an `<a download>`** to `/api/download/[id]`. Do not
  simulate the click in JavaScript — middle-click, right-click → Save As, and
  copy-link must behave natively.
- `src/lib/icons.ts`: extension → Lucide component. `.iso`/`.img` → `Disc3`,
  `.exe`/`.msi` → `AppWindow`, `.zip`/`.tar.gz` → `FileArchive`,
  `.deb`/`.rpm` → `Package`, `.sh`/`.ps1` → `Terminal`, default → `FileDown`.
  Custom `iconUrl` wins when present.
- Kebab menu (stops propagation): Copy download URL, Copy `curl` command,
  Copy `wget` command, Copy SHA-256, Details.
- `fileMissing` state: 60% opacity, `--danger` "Unavailable" chip replacing the
  badge, link disabled.
- Admin-only badges: **Draft** (`--warning`) and **Internal** (`--accent` outline).
- Hover: `translateY(-4px)`, border → `--border-hover`, surface →
  `--bg-surface-hover`, 160ms; transform dropped under `prefers-reduced-motion`.

## Done when

- [x] Right-click → Copy link yields a URL that `curl -O` downloads (PRD §14)
- [x] The kebab menu never triggers the card's navigation
- [x] A `fileMissing` card is visibly disabled and not clickable
- [x] Copy SHA-256 is disabled (not hidden) while the checksum is null, with
      "Computing…" as the label

## Watch out

- Absolute host paths never appear on the card (CONTEXT §2 item 5).
- One accent-filled element per card, max (PRD §5.1).
- The copy commands use the site's public origin, not `localhost` — derive from
  `window.location.origin`.

## Answer

The card is in and verified in a browser: the layout matches PRD §7.3's diagram,
the kebab opens without starting a download, **SHA-256 is disabled and reads
"computing…"** for the seeded rows (their checksums are null until issue 32),
and flagging a seeded tool `fileMissing` renders the dimmed Unavailable variant
with the danger chip and no link at all.

Decisions worth recording:

- **The kebab sits outside the `<a>`, absolutely positioned.** A `<button>`
  nested in a link is invalid HTML and breaks keyboard navigation in ways that
  are easy to miss. The header row inside the anchor carries `pr-7` so the two
  cannot overlap — my first attempt put the kebab at `top-14` and it collided
  with the title, which the browser check caught immediately.
- **`fileMissing` renders a different component, not a disabled-looking one.**
  A dimmed anchor that still navigates is worse than no anchor; the Unavailable
  card has no `href` at all.
- **Copy snippets are built from `window.location.origin`** at click time, so
  the line is pasteable on the machine that will run it rather than carrying
  whatever hostname the server thinks it has.
- **No "Details" item yet.** Issue 17 owns the detail drawer and its own
  watch-out says a deferred drawer must not leave a dead menu entry, so the item
  arrives with the route.

### A lint error worth the refactor

`react-hooks/static-components` rejected `const Icon = iconForFileName(...)`
followed by `<Icon />` — choosing a component identity during render remounts
the subtree whenever the choice changes. Rather than suppress it, `lib/icons.ts`
now returns a plain string union (`"disc" | "app" | …`) and `FileIcon` renders a
static switch. That is better in two ways beyond the lint: nothing can remount,
and the mapping is testable without reaching into Lucide's internals — the tests
assert on kinds rather than on `displayName`.
