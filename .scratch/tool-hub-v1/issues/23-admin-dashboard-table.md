# 23 — Admin dashboard table and Stale filter

Status: resolved
Phase: P2
Blocked by: 22
Spec: PRD §8.2, PRD §13 rows 7 and 15, PRD §16 D4

## Why

Arun's working surface, and the home of the retention workflow — D4's answer to
"can we delete the 2019 image?" is evidence, not a cron job.

## Scope

- `/admin` page: header row "Tools" + count, right-aligned **Add New Tool**
  (accent, 6px radius, `Plus` icon). Search + category filter mirroring the
  public toolbar.
- TanStack Table (headless), styled to the token set. Columns per PRD §8.2:
  Name (+ filename in mono), Category badge, Size (mono, right-aligned), Version
  (mono), Path (mono, **middle-truncated**, tooltip + copy button), Status chip,
  Downloads (+ last-downloaded on hover), Updated (relative), Actions.
- Status chips: Published (`--text-secondary`), **Draft** (`--warning`),
  **Internal** (`--accent` outline), **Missing** (`--danger`).
- **Stale filter**, default off: `lastDownloadAt` older than 180 days or null,
  sorted oldest-first.
- Row actions: `Pencil` → edit slide-over (issue 24), `Copy` → duplicate as
  draft, `Trash2` → delete dialog (issue 25).
- Skeleton, empty, and error states (PRD §5.5).

## Done when

- [x] The Stale filter lists never-downloaded and >180-day-idle tools, oldest
      first (PRD §14)
- [x] Duplicate creates a draft copy with a fresh unique slug
- [x] All four status chips render against seeded data
- [x] Sorting and filtering work on every column that claims to

## Watch out

- The Path column shows the path **relative to the storage root**, not the
  absolute host path (CONTEXT §2 item 5) — middle-truncation makes it tempting to
  show the full thing in the tooltip. Do not.
- 180 days is a threshold worth naming as a constant, not inlining in a query.

## Answer

`/admin` with `Dashboard`, `AdminToolbar`, `ToolsTable`, `StatusChips`, `PathCell`,
and route-level `loading`/`error` states. Filtering and the retention rule live in
`lib/admin-filters.ts`; `middleTruncate` joined `lib/format.ts`. 16 tests in
`tests/admin-filters.test.ts` cover the pure logic; the table itself was checked
in a browser, which is where a table is worth checking.

Verified against the seeded catalogue with the download dates spread out so all
four chips had something real to show:

```
Stale only        4 of 6, never-downloaded first, then longest-idle
Size ▲            62 MB · 84 MB · 118 MB · 412 MB · 2.1 GB · 5.8 GB
Chips             PUBLISHED · PUBLISHED+INTERNAL · DRAFT · MISSING
Path              seed/intel-networ…drivers-28.3.zip  (relative, both ends kept)
Duplicate         "Ventoy Multiboot USB (copy)", DRAFT, 0 downloads, count 6 → 7
Console           clean
```

Decisions:

- **The server renders, the client filters** — the same division as the public
  catalogue (CONTEXT §6). So no `stale=true` API parameter was added after all,
  despite the note left on the map when 22 closed: the dashboard is tens of rows,
  and a query parameter would have been a second place for the admin scoping to
  live. `listAdminTools` stays the only one.
- **Filter state is not URL-synced,** unlike the public toolbar. Engineers paste
  filtered *catalogue* links at each other (PRD §13 row 9); nobody pastes a link
  to a filtered admin table, and `?stale=true` would be state to reconcile
  against the slide-over that lands next.
- **Up to two status chips, not one.** `published` and `visibility` are
  independent axes (CONTEXT §2 item 7), so a tool can be a draft *and* internal;
  collapsing that into one chip hides one of the two reasons it is off the public
  site, on the one screen whose job is to explain exactly that. `Missing`
  replaces the lifecycle chip rather than joining it. The public card already
  badges both this way (issue 15).
- **Stale sorts as well as filters.** Turning it on means working down a list, so
  the row most in need of a decision belongs at the top. Column sorting still
  applies on top.
- **`STALE_AFTER_DAYS` is a policy, not a number.** Whoever wants 90 days finds
  one constant.
- **Duplicate needs no new endpoint.** `POST /api/admin/tools` with the same
  server path and no slug: issue 22 already derives a fresh unique one by
  suffixing. `published: false` is the point — a copy is the start of an edit,
  not a second live listing.
- **Edit and Delete render disabled** with a title naming the issue that supplies
  them (24 and 25). `RowActions.onEdit`/`onDelete` are optional props, so those
  issues wire in a handler rather than rewriting the column.
- **No `admin/layout.tsx`.** It would also wrap `/admin/login`, and admin chrome
  around a sign-in form is a worse surface than repeating a header.

### TanStack Table v9, not v8

The installed version is **9.1.2**, whose API is not the one most references
describe. `useReactTable` with `getCoreRowModel()` as an option does not exist:
v9 uses `useTable`, features are registered explicitly through `tableFeatures`,
and row models are slots inside it. State a feature owns does not exist until the
feature is imported — a missing `sorting` is a missing import, not a typing
problem. The custom comparator option is `sortFn`, not `sortingFn`. The package
ships its own skills under `node_modules/@tanstack/react-table/skills/`, which is
the thing to read before writing against it.

### Found while verifying: a hydration mismatch

The Updated column rendered "23 seconds ago" on the server and "24 seconds ago"
on the client, because `formatRelativeDate` defaults to reading the clock. React
reports that as an error and recovers by regenerating the tree — a real cost on
every dashboard load, and invisible without opening the console.

Fixed by pinning one instant: the Server Component reads the clock once and
passes `nowMs` down through the table's `meta`, so both sides compute the same
string. It goes stale until the next refresh, which is the right trade here.
`formatRelativeDate`'s doc comment now says to pass `now` explicitly from
anything server-rendered. The `react-hooks/purity` rule flags the clock read; it
is disabled at that one line with the reason, because a `force-dynamic` Server
Component renders once per request and the impurity is the point.

## Comments

**Follow-up:** `admin/page.tsx` now also renders `AdminHeader` above
`Dashboard` — a sign-out control that was missing entirely (found by
hand-testing a real deployment). Full reasoning is on issue 20, where the
logout route this calls was originally built with no UI ever wired to it.
