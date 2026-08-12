# 14 — Category pills, sort control, URL-synced filter state

Status: ready-for-agent
Phase: P1
Blocked by: 13
Spec: PRD §7.2, PRD §13 row 9, PRD §14 (Public)

## Why

"Engineers paste links to each other." `?category=OS+Images` has to work, and the
filtered view has to survive a reload.

## Scope

- Horizontally scrollable pill row, 6px radius. Inactive `--bg-surface` +
  `--border`; active `--accent-muted` fill, `--accent` text, accent border.
  `All` always first, with a total count.
- Right-aligned sort control: Newest, Name A–Z, Largest. Result count in mono
  (`24 tools`).
- Search, category, and sort reflected in the query string
  (`?q=&category=&sort=`) via `useRouter`/`useSearchParams`, replacing history
  rather than pushing on every keystroke.
- Filtering happens client-side over the hydrated list (CONTEXT §6 — the
  catalogue is tens of items, not thousands).

## Done when

- [ ] Reloading a filtered URL restores exactly the same view
- [ ] Search updates the URL within 150ms of the last keystroke (PRD §14)
- [ ] `All` shows every in-scope tool; counts are correct
- [ ] Back/forward navigation moves through filter states sensibly

## Watch out

- Only one accent-filled element per toolbar (PRD §5.1 accent discipline) — the
  active pill. The sort control stays neutral.
- Debounce the URL write, not the filtering, or the list feels laggy.
