# 23 — Admin dashboard table and Stale filter

Status: ready-for-agent
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

- [ ] The Stale filter lists never-downloaded and >180-day-idle tools, oldest
      first (PRD §14)
- [ ] Duplicate creates a draft copy with a fresh unique slug
- [ ] All four status chips render against seeded data
- [ ] Sorting and filtering work on every column that claims to

## Watch out

- The Path column shows the path **relative to the storage root**, not the
  absolute host path (CONTEXT §2 item 5) — middle-truncation makes it tempting to
  show the full thing in the tooltip. Do not.
- 180 days is a threshold worth naming as a constant, not inlining in a query.
