# 34 — deploy/: systemd unit, timers, backup script

Status: ready-for-agent
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

- [ ] `systemd-analyze verify deploy/labsy-hub.service` passes
- [ ] `backup.sh` produces a restorable gzipped copy and prunes past 14 days
- [ ] The service cannot write outside `/srv/downloads` and `/var/lib/labsy-hub`
      (PRD §14) — verified by attempting a write in issue 36

## Watch out

- `ExecStart` binds `127.0.0.1` when NPM is co-located, the LAN interface when it
  is not (PRD §12.3). Ship the localhost default and comment the alternative.
- `ProtectSystem=strict` will break the app if any path outside `ReadWritePaths`
  is written — including a stray temp file. `PrivateTmp=true` covers `/tmp`.
- `MemoryMax=1G` against a <300 MB RSS target is generous; do not raise it to
  paper over a leak.
