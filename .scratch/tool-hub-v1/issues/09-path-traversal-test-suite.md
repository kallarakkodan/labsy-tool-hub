# 09 — Path-traversal test suite

Status: ready-for-agent
Phase: Security core
Blocked by: 08
Spec: PRD §11.1, CONTEXT §7.1, CONTEXT §9, PRD §14 (Server browser)

## Why

CONTEXT §7.1: "`tests/storage.test.ts` is written alongside this file, not after."
This is the gate on P3 shipping — `pnpm test:security` must be green.

## Scope

- `tests/storage.test.ts` against a **temp fixture root** created per run, not the
  real storage root.
- One case per row of PRD §11.1:
  - `../../etc/passwd`
  - `%2e%2e%2f%2e%2e%2fetc/passwd`
  - `%252e%252e%252f`
  - `/etc/shadow`
  - `foo\0.iso`
  - a **real symlink** inside the fixture root pointing at `/etc`
  - prefix confusion: fixture root `X`, target `X-evil` (create both)
  - `..\..\windows\system32`
  - a 5,000-character path
- Plus: `.uploads` never appears in `listDirectory` output; hidden files appear
  only with `showHidden`; a directory chmod-ed `000` yields the named `EACCES`
  error rather than a crash; the 5,000-entry cap sets `truncated`.
- `pnpm test:security` script wired to this file (CONTEXT §4).

## Done when

- [ ] `pnpm test:security` is green
- [ ] Deliberately weakening the check to bare `startsWith(root)` makes the
      prefix-confusion case fail (proves the test has teeth)

## Watch out

- The symlink and the `X-evil` sibling directory must be created for real in the
  fixture — asserting against a string is not a test of `realpath`.
- Clean up the fixture in `afterEach`, including chmod-ing the unreadable
  directory back so the temp dir can be removed.
