# 27 — Server file browser modal, wired into the form

Status: ready-for-agent
Phase: P3
Blocked by: 26, 24
Spec: PRD §8.4, CONTEXT §8 step 8

## Why

Closes P3: "Admin can navigate to any file under the storage root and nothing
above it." This is Arun's whole workflow.

## Scope

- 640px modal, `--bg-surface`.
- **Breadcrumb** of the path relative to `STORAGE_ROOT`, clickable mono segments,
  rooted at a `HardDrive` icon labelled `storage`.
- **List:** directories first then files, each alphabetical. Row = icon + name
  (mono) + size (files, mono, right) + mtime. Directory = 1 click to descend.
  File = 1 click to select (accent border on the row), double-click to select
  and confirm.
- **Controls:** up-one-level (disabled at root), filter input, "show hidden
  files" toggle (default off), refresh.
- **Footer:** selected filename + size left; `Cancel` / `Select File` right.
- **States:** skeleton rows while loading; "This folder is empty"; a `--danger`
  inline message naming the directory on `EACCES`.
- Wire the **Browse Server** button in the issue 24 form to it; selection fills
  the read-only path input and displays size and mtime.

## Done when

- [ ] Navigating into subdirectories and back up works; root has no parent
      (PRD §14)
- [ ] A permission-denied directory shows the named error inline, not a crash
- [ ] `.uploads` is never listed
- [ ] Selecting a file and saving the form creates a working catalogue entry

## Watch out

- The absolute host path is never rendered — the breadcrumb is rooted at
  `storage` (PRD §8.4).
- Keep the modal keyboard-navigable: arrow keys through rows, Enter to descend or
  select, Escape to cancel.
