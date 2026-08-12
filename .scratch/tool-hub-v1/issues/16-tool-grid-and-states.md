# 16 — ToolGrid, skeleton, empty and error states

Status: resolved
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

- [x] `pnpm db:seed:clear` leaves the true empty state rendering correctly
- [x] Searching for nonsense shows the no-results state, not the no-tools state
- [ ] Lighthouse performance on the homepage ≥ 95 (PRD §1.4, §14) — **deferred to issue 36**, which measures on the real server
- [x] Grid reflows correctly at all three breakpoints

## Watch out

- Skeleton content is not Lorem Ipsum (CONTEXT §10) — use shaped grey blocks, no
  fake words.
- The empty state's primary action links to `/admin`, which will bounce to login
  until issue 21 lands. That is correct behaviour, not a bug.

## Answer

All four states are built and each was checked in a browser rather than reasoned
about:

- **Grid** — 1 / 2 / 3 columns verified by resizing to 700, 900, and 1440px.
- **No matches** — names both the query and the category ("No tools match
  “nonexistent thing” in Utilities"), count reads `0 tools`, and Clear filters
  returns the URL to `/`.
- **No tools yet** — `pnpm db:seed:clear`, reload: the exact CONTEXT §10 copy,
  with the toolbar suppressed because there is nothing to filter. This also
  ticks the checkbox issue 06 had to defer.
- **Error** — an `error.tsx` boundary whose copy points at
  `systemctl status labsy-hub`, since the realistic cause is an unreachable
  database.

The two empty states are deliberately separate components. Telling someone
there are no tools when they have simply mistyped a search is a small lie that
costs a support message, so the no-match state names what it searched for and
offers a way out.

The skeleton is shaped blocks with no fake words (CONTEXT §10 bans Lorem Ipsum
in skeletons too), and `loading.tsx` deliberately omits the toolbar: pill labels
are unknown until the data lands, and placeholder pills would make the row jump
when the real ones replaced them.

Audited against PRD §14's design line: `grep` for default Tailwind palette
classes across `src/` returns nothing, and the only two `rounded-full`
occurrences are the 6px status dot, which is one of PRD §5.3's two sanctioned
exceptions.

Lighthouse ≥ 95 is left to issue 36 — a dev-server score measured through
Turbopack with an unoptimised bundle would be a number, not evidence.
