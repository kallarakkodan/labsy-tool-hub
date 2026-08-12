# 17 — Detail drawer at /t/[slug]

Status: ready-for-agent
Phase: P1 (stretch)
Blocked by: 16
Spec: PRD §7.4, PRD §10

## Why

Marked "optional within v1, P1 stretch" in the PRD. Kept as its own issue so it
can be deferred without blocking P2 — nothing else depends on it.

## Scope

- Right slide-over showing full description, notes (markdown-lite), and metadata:
  size, checksum with a copy button, mime type, version, added/updated dates,
  download count.
- The three copy-command snippets (reuse the menu from issue 15).
- Deep-linkable at `/t/[slug]`, so the route renders standalone as well as over
  the catalogue.
- Scoped by `toolVisibilityWhere` — an out-of-scope slug is **404**.
- The single permitted shadow applies here: `0 16px 48px rgba(0,0,0,0.55)` on the
  overlay (PRD §5.3).

## Done when

- [ ] `/t/<slug>` loads directly and renders the drawer over the catalogue
- [ ] Escape and overlay click close it and restore the previous URL
- [ ] Test: an anonymous request for a draft or internal slug returns 404

## Watch out

- No absolute host path in the metadata block — PRD §7.4 says "absolute-free
  metadata" for a reason (CONTEXT §2 item 5).
- If this is deferred, the kebab menu's **Details** item must be removed rather
  than left dead.
