# 15 — ToolCard, extension icon map, copy-command menu

Status: ready-for-agent
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

- [ ] Right-click → Copy link yields a URL that `curl -O` downloads (PRD §14)
- [ ] The kebab menu never triggers the card's navigation
- [ ] A `fileMissing` card is visibly disabled and not clickable
- [ ] Copy SHA-256 is disabled (not hidden) while the checksum is null, with
      "Computing…" as the label

## Watch out

- Absolute host paths never appear on the card (CONTEXT §2 item 5).
- One accent-filled element per card, max (PRD §5.1).
- The copy commands use the site's public origin, not `localhost` — derive from
  `window.location.origin`.
