# 16 — ToolGrid, skeleton, empty and error states

Status: ready-for-agent
Phase: P1
Blocked by: 15, 14
Spec: PRD §7.3 (grid), PRD §5.5, CONTEXT §10, PRD §14 (Public)

## Why

PRD §5.5: every list surface defines all four states. This is the issue that
closes P1 — an engineer can find and download a seeded tool.

## Scope

- Grid: 1 / 2 / 3 columns at base / `md` / `lg`, 16px gap, page max-width 1280px.
- The public page (`src/app/page.tsx`) is a **Server Component** that fetches the
  scoped tool list; the client component filters it (CONTEXT §6).
- **Loading:** skeleton cards matching the final layout, never a centred spinner.
- **Empty (no tools at all):** the exact copy from CONTEXT §10 —
  "No tools yet. Add your first tool from the admin panel, or point the hub at a
  file already on the server."
- **Empty (filters match nothing):** a distinct message naming the active filter,
  with a clear-filters action.
- **Error:** states what failed and what to do next. Never "Something went wrong."

## Done when

- [ ] `pnpm db:seed:clear` leaves the true empty state rendering correctly
- [ ] Searching for nonsense shows the no-results state, not the no-tools state
- [ ] Lighthouse performance on the homepage ≥ 95 (PRD §1.4, §14)
- [ ] Grid reflows correctly at all three breakpoints

## Watch out

- Skeleton content is not Lorem Ipsum (CONTEXT §10) — use shaped grey blocks, no
  fake words.
- The empty state's primary action links to `/admin`, which will bounce to login
  until issue 21 lands. That is correct behaviour, not a bug.
