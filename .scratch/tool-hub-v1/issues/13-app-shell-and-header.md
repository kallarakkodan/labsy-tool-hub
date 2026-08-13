# 13 — App shell, header, search input, LAN status dot

Status: resolved
Phase: P1
Blocked by: 07, 02
Spec: PRD §7.1, CONTEXT §5 (recipes), CONTEXT §6

## Why

The frame every public screen sits in, and the first components written against
the token set.

## Scope

- Sticky 64px header, `--bg-base` at 80% opacity with `backdrop-blur-sm`, 1px
  bottom border.
- Left: wordmark "Internal Tool Hub" (Inter 600, `-0.02em`) preceded by a 20px
  accent glyph.
- Centre: search input, max-width 480px, `--bg-inset`, magnifier icon,
  `⌘K` / `Ctrl K` kbd hint. Focus → `--border-hover` + accent ring.
  Debounced 120ms. Matches name + description + category + version.
- Right: LAN status dot — 6px, accent when `/api/health` is ok, `--warning` while
  polling, `--danger` on failure — plus the mono version tag from
  `NEXT_PUBLIC_APP_VERSION`. Polls every 30s.
- `"use client"` on the search input and the health dot only. The page shell
  stays a Server Component (CONTEXT §6).

## Done when

- [x] Header matches PRD §7.1 at all three breakpoints
- [x] Stopping the dev server turns the dot `--danger` within one poll interval
- [x] Typing in search re-filters the already-hydrated list with no network request

## Watch out

- `backdrop-blur-sm` is fine; `backdrop-blur-lg` and above are banned (CONTEXT §5).
- **Resolved:** `⌘K` / `Ctrl K` focuses and selects the search input in v1. The
  hint stays and does something real; it upgrades to the command palette in P6
  (PRD §13 row 13) without changing the affordance. Do not ship the hint with a
  dead shortcut behind it.
- The dot's three states need accessible text, not colour alone.

## Answer

Header, search, and status dot are live and verified in a browser: ⌘K focuses
and selects the field, typing writes `?q=ubuntu+server`, reloading that URL
restores the query, the accent focus ring renders, the kbd hint hides once the
field has content, and the console is clean — no hydration warnings.

Three decisions that shape issues 14–16:

- **The URL is the single source of truth for filter state**, written with
  `window.history.replaceState`. Next syncs the native history methods into
  `useSearchParams`, so every subscriber re-renders with no server round trip.
  `router.replace` would refetch the RSC payload on every keystroke, which is
  what CONTEXT §6 rules out. `replaceState` rather than `pushState` so typing
  eight characters does not leave eight entries in the back stack.
- **A `(public)` route group** now owns the header. `/admin` has its own chrome
  (PRD §10), and an admin screen with a public search bar across the top would
  be a confusing surface. The route is still `/`.
- **The version tag comes from the health response, not
  `NEXT_PUBLIC_APP_VERSION`.** It is the version the *server* is running, which
  is the useful number after a deploy, and it keeps `process.env` out of client
  code (CONTEXT §3).

The dot has three states rather than two, because `/api/health` answers 200 with
`ok: false` when degraded: "up but the storage root is unwritable" has to read
differently from "unreachable". Colour is never the only signal — there is an
`sr-only` `role="status"` line and a visible glyph.

The 6px dot is one of PRD §5.3's two `rounded-full` exceptions, carrying an
`eslint-disable-next-line` that names the exemption — the convention issue 02
deferred to whichever component needed it first.

## Comments

**Follow-up, found by hand-testing a real deployment (issue 34's container):**
this issue's own "Answer" claims "`/admin` has its own chrome (PRD §10)" as
the reason the public header lives in a `(public)` route group — but no admin
chrome was ever built (see issue 20's comment), and this public header had no
link to `/admin` at all. Signing in required typing the URL by hand.

Added a small icon-only link (`LogIn`, `lucide-react`) to the header's right
section, next to the health dot. Not in PRD §7.1's spec — deliberately minimal
so it doesn't compete with the search-centric layout the spec describes.
Points at `/admin` rather than `/admin/login` directly: `src/proxy.ts` already
sends a signed-out visitor to `/admin/login?next=/admin` and an already-signed-in
one straight through, so one link is correct in both auth states without the
Server Component needing to know which applies.

### Two lint errors worth the fix rather than a suppression

Next 16's `react-hooks/set-state-in-effect` rejected both of my first attempts,
correctly — each was a cascading render:

- **Platform detection** for the ⌘K vs Ctrl K hint was `useState` + `useEffect`.
  Now `useSyncExternalStore` with a `null` server snapshot: the hint renders
  nothing during SSR, so it cannot mismatch on hydration, and there is no
  second render to reconcile.
- **Mirroring `filters.q` into the field** was an effect. Now it reconciles
  *during render* against the last query seen, which is React's documented way
  to adjust state when an input changes. The field still owns its value so
  typing is instant, and a Back or a "clear filters" still moves it.
