# 33 — fileMissing integrity sweep

Status: ready-for-agent
Phase: P5
Blocked by: 22
Spec: PRD §11.3, PRD §13 row 6, PRD §16 D4

## Why

Files registered by path get moved or deleted out-of-band. Silent 404s destroy
trust in the catalogue.

## Scope

- A weekly job that re-`stat`s every registered `filePath` through
  `resolveWithinRoot` and sets `fileMissing` accordingly — **both directions**: a
  file that reappears clears the flag.
- Driven by a `systemd` timer (unit shipped in issue 34) hitting an admin-only
  route or a standalone script; pick one and document it in `deploy/`.
- The download handler already sets `fileMissing` on `ENOENT` (issue 12); this is
  the proactive sweep so the card is correct *before* someone clicks it.
- Log a summary: how many checked, how many newly missing, how many recovered.

## Done when

- [ ] Moving a registered file away flags it within one sweep; moving it back
      clears the flag
- [ ] A flagged tool renders as Unavailable and returns 410 (PRD §14)
- [ ] The sweep never modifies anything on disk

## Watch out

- **This job reads only.** PRD §14: "No scheduled job anywhere in the repo
  deletes a file from `STORAGE_ROOT`." D4 is explicit — surface candidates, let a
  human decide.
- Stat one file at a time; a burst of thousands of stats during a download window
  is avoidable contention.
