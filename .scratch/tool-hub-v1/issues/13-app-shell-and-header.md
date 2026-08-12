# 13 — App shell, header, search input, LAN status dot

Status: ready-for-agent
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

- [ ] Header matches PRD §7.1 at all three breakpoints
- [ ] Stopping the dev server turns the dot `--danger` within one poll interval
- [ ] Typing in search re-filters the already-hydrated list with no network request

## Watch out

- `backdrop-blur-sm` is fine; `backdrop-blur-lg` and above are banned (CONTEXT §5).
- **Resolved:** `⌘K` / `Ctrl K` focuses and selects the search input in v1. The
  hint stays and does something real; it upgrades to the command palette in P6
  (PRD §13 row 13) without changing the affordance. Do not ship the hint with a
  dead shortcut behind it.
- The dot's three states need accessible text, not colour alone.
