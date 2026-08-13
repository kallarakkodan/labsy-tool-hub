# 25 — Delete confirmation dialog with the file-deletion choice

Status: resolved
Phase: P2
Blocked by: 22, 23
Spec: PRD §8.2, PRD §16 D4, PRD §14 (Admin)

## Why

The only destructive action in the product. D4's asymmetry argument applies: an
accidentally deleted golden image is unrecoverable; a stale catalogue row costs
nothing. The UI must make the safe choice the easy one.

## Scope

- Destructive confirm dialog with an **explicit radio choice**, defaulting to safe:
  - ◉ Remove from catalogue (keep the file on disk) — default
  - ○ Remove and permanently delete the file from the server
- The second option is **only offered** when the server confirms the file
  resolves inside `STORAGE_ROOT`, is not a symlink, and is not referenced by
  another `Tool` row. Otherwise it is absent with a one-line reason.
- Confirm button is `--danger`. When file deletion is selected, the admin must
  **type the tool name** to enable it.
- The single permitted overlay shadow (PRD §5.3).

## Done when

- [x] Delete defaults to catalogue-only removal (PRD §14)
- [x] File deletion requires typing the exact tool name
- [x] Two tools pointing at the same path: neither offers file deletion
- [x] A symlinked path never offers file deletion
- [x] Both outcomes write the correct `AuditLog` detail

## Watch out

- Eligibility is decided **server-side** and returned to the dialog. A client-side
  check would be trivially bypassed by calling the API directly — issue 22's
  handler enforces it regardless, and this dialog must agree with it rather than
  duplicate the logic.
