# 14 — Category pills, sort control, URL-synced filter state

Status: resolved
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

- [x] Reloading a filtered URL restores exactly the same view
- [x] Search updates the URL within 150ms of the last keystroke (PRD §14)
- [x] `All` shows every in-scope tool; counts are correct
- [x] Back/forward navigation moves through filter states sensibly

## Watch out

- Only one accent-filled element per toolbar (PRD §5.1 accent discipline) — the
  active pill. The sort control stays neutral.
- Debounce the URL write, not the filtering, or the list feels laggy.

## Answer

Pills, sort, result count, and URL sync are live, verified in a browser against
the seeded catalogue: clicking **Utilities** writes `?category=Utilities`,
narrows the list to two, restyles the active pill, and moves the count from
`4 tools` to `2 tools`. Reload restores it.

Two details worth knowing:

- **The pill badges and the result count answer different questions and are
  meant to disagree.** A badge says how many tools are in that category; the
  count says how many are showing right now. With a search active they diverge,
  and that is correct — the pills show what is available to pick, not what the
  current filter already narrowed to.
- **The sort control is a native `<select>`.** Keyboard and touch behaviour for
  free, and the toolbar's entire accent budget is already spent on the active
  pill (PRD §5.1), so a custom popover would have had to be styled neutral
  anyway.

Clicking the active pill clears it back to `All`, which is the behaviour people
expect from a toggle and avoids a dead end where the only way back is the
`All` pill.

Sorting by size compares as `BigInt`. On the client `fileSize` is a string, so
`Number()` would lose precision above 2^53 and a plain string compare would put
`"300"` ahead of `"9007199254740993"` — the same trap as the SQL sort in issue 11,
in a different language.
