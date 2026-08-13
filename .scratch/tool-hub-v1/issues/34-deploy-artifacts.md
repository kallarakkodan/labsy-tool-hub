# 34 — deploy/: systemd unit, timers, backup script

Status: ready-for-human
Phase: P5
Blocked by: 33, 32
Spec: PRD §12.3, PRD §12.7, PRD §13 row 14, PRD §10

## Why

The sandboxing in the unit file is defence in depth for the one class of bug
(path traversal) that would otherwise be catastrophic — a traversal that slips
past issue 08 still cannot write outside the storage root.

## Scope

- `deploy/labsy-hub.service` exactly as PRD §12.3, including every hardening
  directive: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`,
  `ProtectHome`, `ReadWritePaths=/srv/downloads /var/lib/labsy-hub`,
  `ProtectKernelTunables`, `ProtectControlGroups`, `RestrictSUIDSGID`,
  `LockPersonality`, `MemoryMax=1G`.
- `deploy/backup.sh`: `sqlite3 db.sqlite ".backup …/db-$(date +%F).sqlite"`, gzip,
  retain 14 days. Artifacts in `/srv/downloads` are explicitly **not** backed up —
  say so in the script header.
- Timer units: nightly backup, weekly `fileMissing` sweep (issue 33).
- `deploy/README.md` documenting what each file is and where it installs.
- **Resolved:** `deploy/nginx.conf` is dropped — there is no nginx on the app
  host (PRD §12.4). In its place, `deploy/npm-advanced.conf` holds the §12.5
  directives with a header stating it is pasted into the Nginx Proxy Manager
  proxy host's Advanced tab and is read by no process on this machine.
  PRD §10's directory tree has been corrected to match.

## Done when

- [ ] `systemd-analyze verify deploy/labsy-hub.service` passes — **not
      verified**; see Comments
- [x] `backup.sh` produces a restorable gzipped copy and prunes past 14 days —
      verified with real `sqlite3`/`gzip`/`find` against a throwaway sandbox
      DB: backed up, gunzipped, restored, and queried back the seeded row;
      separately confirmed a synthetic 2020-dated backup gets pruned on the
      next run and a fresh one does not
- [ ] The service cannot write outside `/srv/downloads` and `/var/lib/labsy-hub`
      (PRD §14) — verified by attempting a write in issue 36 (unchanged, as scoped)

## Comments

`systemd` is Linux-only and this machine is macOS, so `systemd-analyze verify`
itself could not run directly. Tried running it inside a Docker container
(`ubuntu:24.04` + `apt-get install systemd`) three times; Docker Desktop's
networking never came up cleanly in this session — even a bare `docker pull
hello-world` hung indefinitely and had to be killed. That is an environment
problem, not a finding about the unit files.

What did happen instead: a careful line-by-line read of every directive in
all five unit files against known systemd syntax — section headers, one
directive per line, comments only ever on their own line (never trailing
after a value, which the literal PRD §12.3 markdown snippet renders as an
inline `#` comment that would NOT be valid systemd syntax — written here as a
separate comment line above `ExecStart` instead, per the issue's own "watch
out": "ship the localhost default and comment the alternative"). All the
hardening directives from PRD §12.3 are present, in the same order, same
values.

This is short of the issue's literal bar. Marked `ready-for-human` for a
`systemd-analyze verify` pass on an actual Linux box (or a working Docker
setup) before this is trusted — everything else (`backup.sh`'s actual
behaviour, the file contents, the README) is either verified or a faithful
transcription of the spec.

Chose the "standalone script over systemd calling an HTTP endpoint" split
consistently: `labsy-hub-sweep.service` runs `scripts/sweep-file-missing.ts`
directly via `node node_modules/.bin/tsx`, the same pattern issue 33 already
settled on and the same `node node_modules/.bin/X` invocation style the main
`labsy-hub.service` already uses for `next start`.

## Watch out

- `ExecStart` binds `127.0.0.1` when NPM is co-located, the LAN interface when it
  is not (PRD §12.3). Ship the localhost default and comment the alternative.
- `ProtectSystem=strict` will break the app if any path outside `ReadWritePaths`
  is written — including a stray temp file. `PrivateTmp=true` covers `/tmp`.
- `MemoryMax=1G` against a <300 MB RSS target is generous; do not raise it to
  paper over a leak.
