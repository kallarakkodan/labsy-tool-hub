# deploy/

Deployment artifacts for Ubuntu Server 24.04 LTS (PRD §12). Provisioning the
host itself — users, packages, ACLs, the NPM proxy host — is issue 35's
runbook; this directory holds the files that runbook installs.

## Two ways to deploy

| Method | Guide | When |
|---|---|---|
| **Bare metal, via systemd** | [`INSTALL.md`](./INSTALL.md) | Follows PRD §12 exactly — `labsy` system user, `ProtectSystem=strict` sandboxing, the app running directly on the host. One script (`install.sh`) provisions and deploys from a git checkout; safe to re-run for upgrades. |
| **Docker** | [`docker/DOCKER.md`](./docker/DOCKER.md) | Faster to stand up, isolates the app in a container. `docker compose up -d --build` after filling in two secrets. |

Both need this repo pushed to a git host reachable from the target machine
first — it ships with no remote configured. Both cover installation and
configuration end-to-end in their own guide; this file only indexes the raw
files underneath.

## Files

| File | Installs to | Purpose |
|---|---|---|
| `labsy-hub.service` | `/etc/systemd/system/labsy-hub.service` | The app itself: `next start`, sandboxed (PRD §12.3). |
| `labsy-hub-backup.service` | `/etc/systemd/system/labsy-hub-backup.service` | Oneshot unit that runs `backup.sh`. |
| `labsy-hub-backup.timer` | `/etc/systemd/system/labsy-hub-backup.timer` | Triggers the backup service nightly at 02:00. |
| `labsy-hub-sweep.service` | `/etc/systemd/system/labsy-hub-sweep.service` | Oneshot unit that runs the `fileMissing` sweep (issue 33). |
| `labsy-hub-sweep.timer` | `/etc/systemd/system/labsy-hub-sweep.timer` | Triggers the sweep service weekly, Sunday 03:00. |
| `backup.sh` | `/opt/labsy-hub/deploy/backup.sh` (ships with the app checkout) | Nightly SQLite backup, gzipped, 14-day retention (PRD §12.7). |
| `npm-advanced.conf` | Nowhere on this host | Pasted into Nginx Proxy Manager's proxy-host **Advanced** tab (PRD §12.5). Not read by any process here — there is no nginx on the app host (PRD §12.4). |
| `install.sh` | Run once on the target host, not installed anywhere | Provisions and deploys the bare-metal method end-to-end — see [`INSTALL.md`](./INSTALL.md). |
| `docker/` | — | The Docker method's `entrypoint.sh` and `gen-hash.cjs` — see [`docker/DOCKER.md`](./docker/DOCKER.md). The `Dockerfile` and `docker-compose.yml` themselves live at the repo root. |

There is deliberately no `nginx.conf` in this directory — see the note above
and PRD §16's resolved-decisions log.

## Installing the systemd units

`install.sh` does this step automatically — the manual version below is for
reference, or for installing/updating just the units without the rest of what
the script does.

```bash
sudo cp deploy/labsy-hub.service deploy/labsy-hub-backup.service \
        deploy/labsy-hub-backup.timer deploy/labsy-hub-sweep.service \
        deploy/labsy-hub-sweep.timer \
        /etc/systemd/system/

sudo systemctl daemon-reload

# The app itself
sudo systemctl enable --now labsy-hub.service

# The timers — note *.timer is what gets enabled, not the *.service
sudo systemctl enable --now labsy-hub-backup.timer
sudo systemctl enable --now labsy-hub-sweep.timer
```

Verify a unit file before installing it:

```bash
systemd-analyze verify deploy/labsy-hub.service
```

Check timer schedules and confirm sandboxing is actually in effect:

```bash
systemctl list-timers labsy-hub-*
systemctl show labsy-hub.service -p ReadWritePaths -p ProtectSystem
```

## `backup.sh`

Run by `labsy-hub-backup.service`, but safe to run by hand at any time —
`sqlite3 .backup` is an online backup and does not require stopping the app
(PRD §4's WAL mode is what makes concurrent reads/writes during the backup
safe). Two environment variables override its defaults, matching PRD §12.1's
layout table:

- `LABSY_DB_PATH` (default `/var/lib/labsy-hub/db.sqlite`)
- `LABSY_BACKUP_DIR` (default `/var/backups/labsy-hub`)

It backs up the database only. Artifacts under `STORAGE_ROOT`
(`/srv/downloads`) are **not** backed up here — they are large and
reproducible from whatever Arun `rsync`'d them from. Back those up
separately, deliberately, if at all.

### Restoring

```bash
gunzip -k /var/backups/labsy-hub/db-2026-08-13.sqlite.gz
sudo systemctl stop labsy-hub.service
sudo -u labsy cp /var/backups/labsy-hub/db-2026-08-13.sqlite /var/lib/labsy-hub/db.sqlite
sudo systemctl start labsy-hub.service
```

## Sandboxing (`labsy-hub.service`)

The hardening directives (`ProtectSystem=strict`, `ReadWritePaths=/srv/downloads
/var/lib/labsy-hub`, and the rest) are defence in depth for the one class of
bug that would otherwise be catastrophic: a path-traversal that slips past
`lib/storage.ts`'s boundary (PRD §11.1) still cannot write outside the storage
root, because `ProtectSystem=strict` makes the entire filesystem read-only to
the process except the two paths explicitly listed. Issue 36 verifies this
against the real, provisioned host — a passing `systemd-analyze verify` here
only proves the unit file is *syntactically* valid, not that the constraint
actually holds at runtime.

Do not raise `MemoryMax=1G` to paper over a leak — it is already generous
against the <300 MB RSS target (PRD §12.8).
