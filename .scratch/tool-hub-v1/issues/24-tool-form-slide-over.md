# 24 — Add/Edit slide-over form (Server Path source)

Status: resolved
Phase: P2
Blocked by: 23
Spec: PRD §8.3, CONTEXT §6 (shared Zod), CONTEXT §5 (input recipe)

## Why

This is the issue that makes P2's exit criterion true: an admin registers a
pre-staged file end to end, in under 30 seconds, with no bytes copied.

## Scope

- Right slide-over, 560px, `--bg-surface`, 1px left border, Escape/overlay to
  close **with a dirty-state guard**.
- Fields and validation exactly per the PRD §8.3 table: Name (2–80, slug
  auto-derived + editable + uniqueness checked on blur), Description (≤ 280, with
  counter), Category (combobox: pick existing or type new, ≤ 40), Version (≤ 40,
  mono), Icon URL (optional, live 40px preview, `http(s)` or `/`-rooted),
  Notes (≤ 2000), Published switch (default on), Internal-only switch (default
  off) with the helper text quoted in the PRD.
- File source segmented control: `Server Path` | `Upload`. **This issue ships
  Server Path only**; the Upload tab is present but disabled until issue 31.
- Server Path: read-only mono input + a **Browse Server** button (wired in issue
  27; a manual paste field works until then). Manual paste is allowed but
  revalidated server-side on submit. On selection, size and mtime are displayed.
- `react-hook-form` + `zodResolver` against the **same** schemas the handler
  re-parses (`lib/validation.ts`).
- Save blocked until a valid file source exists. Edit mode pre-selects the
  current source and permits switching — the old file is never touched
  automatically.

## Done when

- [x] Create from a server path appears in the public catalogue immediately
- [x] Closing with unsaved changes prompts; closing clean does not
- [x] Slug uniqueness conflict is surfaced on blur, before submit
- [x] An invalid pasted path is rejected by the server with a readable message

## Watch out

- Client validation is UX, server validation is truth (CONTEXT §6) — the handler
  re-parses regardless of what the form allowed through.
- The Internal-only switch is a **discovery** control, not a security boundary
  (PRD §16 D3). The helper text must not overclaim.
