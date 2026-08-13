# Bare-metal install (systemd)

Runs Labsy Tool Hub directly on Ubuntu Server 24.04 — a `labsy` system user,
Node under `systemd`, sandboxed with `ProtectSystem=strict` (PRD §12). This is
the deployment this project was built for; `deploy/docker/DOCKER.md` is the
alternative if you'd rather run it in a container.

Targets a VPS, LXC container, or bare metal — anything that boots systemd and
has `apt`. One script, `deploy/install.sh`, does the whole thing and is safe
to re-run for upgrades.

## Before you start: push this repo somewhere

The script deploys by `git clone`/`git fetch`, and this repo ships with **no
git remote configured**. Push it to a git host reachable from the target
machine first — a private GitHub/GitLab repo, or a self-hosted Gitea/Forgejo
instance on the same LAN both work; a plain bare repo over SSH
(`git init --bare` on a server you already have) works too. Whatever URL you'd
use with `git clone` is what `install.sh` needs as `REPO_URL`.

## Install

On the target machine, as root (or via `sudo`):

```bash
curl -fsSL <raw-url-to-deploy/install.sh-on-your-git-host> -o install.sh
# or: scp deploy/install.sh you@target:~/ , then run it there

REPO_URL=https://your-git-host/labsy-tool-hub.git ./install.sh
```

You'll be prompted for the admin password partway through (hidden input, not
echoed). For a non-interactive install — provisioning from a script, CI, or
similar — set `ADMIN_PASSWORD` in the environment instead:

```bash
REPO_URL=https://your-git-host/labsy-tool-hub.git \
ADMIN_PASSWORD='a real password, at least 12 characters' \
  ./install.sh
```

What it does, in order (all idempotent — see "Upgrading" below):

1. Installs OS packages: `curl`, `git`, `sqlite3`, `acl`, `openssl`, and
   Node.js 26 + `pnpm` if not already present (PRD §12.2).
2. Creates the `labsy` system user and the directory layout from PRD §12.1
   (`/srv/downloads`, `/var/lib/labsy-hub`, `/var/backups/labsy-hub`,
   `/etc/labsy-hub`), with the ACLs that keep files staged by `rsync`/`scp`/
   Samba readable by the app without a manual `chmod` (PRD §12.2).
3. Clones (or, on a re-run, fetches and checks out) `REPO_REF` — default
   `main` — into `/opt/labsy-hub`.
4. Generates `AUTH_SECRET` and the admin password hash, and writes
   `/etc/labsy-hub/env` (mode `0640`, `root:labsy`) — **skipped entirely if
   that file already exists**, so re-running never resets your credentials.
5. Installs dependencies, syncs the database schema (`prisma db push`), and
   builds — all as the `labsy` user, with the real `/etc/labsy-hub/env`
   sourced, so the build-time config check (`src/instrumentation.ts` /
   `src/lib/env.ts`) exercises production values, not placeholders.
6. Installs and enables the five systemd units from `deploy/*.service` and
   `deploy/*.timer`, then restarts `labsy-hub.service` and does a local health
   check.

Verify:

```bash
curl -s http://127.0.0.1:3000/api/health
systemctl status labsy-hub.service
```

`labsy-hub.service` binds `0.0.0.0:3000` — reachable from any interface,
which is what you want when NPM runs on a different host (the common case).
If NPM is genuinely co-located on this same host and you'd rather close off
every other interface, edit `deploy/labsy-hub.service`'s `ExecStart` to bind
`127.0.0.1` instead — see that file's own comment.

## Configuration

Everything lives in `/etc/labsy-hub/env` (mode `0640`, `root:labsy` —
readable by the app, not by arbitrary users). `install.sh` writes it once on
first install with these values; edit it directly for anything you want to
change afterward, then `sudo systemctl restart labsy-hub`:

| Variable | Install default | Notes |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | generated | Regenerate: `sudo -u labsy /opt/labsy-hub/node_modules/.bin/tsx /opt/labsy-hub/scripts/gen-hash.ts` (needs the app's own `node_modules`, already installed) |
| `AUTH_SECRET` | generated | `openssl rand -base64 48` — rotating it invalidates all existing sessions |
| `DATABASE_URL` | `file:/var/lib/labsy-hub/db.sqlite` | |
| `STORAGE_ROOT` | `/srv/downloads` | Must stay inside `ReadWritePaths` in `labsy-hub.service` if you change it |
| `NEXT_PUBLIC_APP_VERSION` | `1.0.0` | Shown in the header tag |
| `CHUNK_SIZE` | `16777216` (16 MiB) | Your proxy's max body size must exceed this |
| `UPLOAD_SUBDIR` | `uploads` | Relative to `STORAGE_ROOT` |
| `UPLOAD_TTL_HOURS` | `24` | Abandoned upload cleanup window |
| `SESSION_TTL_HOURS` | `8` | Admin session lifetime |
| `COOKIE_SECURE` | `true` | See the warning below |
| `USE_X_ACCEL` | `false` | Only relevant if NPM is co-located — PRD §12.4 |

**Every `$` in `ADMIN_PASSWORD_HASH` must stay escaped as `\$`** exactly as
generated — `install.sh` writes it correctly, but if you ever hand-edit the
line, dotenv-expand deletes an unescaped `$NNNNN` and the app refuses to boot
on the mangled form rather than start with a password that can never be
accepted (PRD §35 "Watch out").

**`COOKIE_SECURE`**: leave `true` for any real deployment behind TLS. Set
`false` only if nothing in front of this host terminates TLS — e.g. testing
over plain HTTP directly. If NPM ever fronts this over plain HTTP,
`COOKIE_SECURE=false` is required or login silently never sticks; it is the
only place the app couples to the TLS decision (PRD §35).

### Reverse proxy (Nginx Proxy Manager)

Point a proxy host at this host on port `3000`. Paste into the proxy host's
**Advanced** tab — these are load-bearing, not tuning (PRD §12.5, §35):

```nginx
client_max_body_size 32m;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
send_timeout 3600s;
proxy_set_header X-Forwarded-Proto $scheme;
```

Leave **Block Common Exploits** off. `proxy_request_buffering off` is the
directive most easily missed — without it NPM spools every 16 MiB chunk to
its own container disk, doubling write I/O and making the upload progress bar
meaningless.

### Backups and the integrity sweep

Already handled — `install.sh` enables `labsy-hub-backup.timer` (nightly DB
backup, 02:00, 14-day retention) and `labsy-hub-sweep.timer` (weekly
`fileMissing` integrity sweep, Sunday 03:00). See `deploy/README.md` for what
each does and how to verify or restore from a backup manually.

## Upgrading

Re-run the same command used to install:

```bash
REPO_URL=https://your-git-host/labsy-tool-hub.git ./install.sh
```

Fetches `REPO_REF`, reinstalls dependencies, rebuilds, and restarts the
service. `/etc/labsy-hub/env` is left untouched — existing secrets and
sessions survive every upgrade. To deploy a specific tag or commit instead of
the latest `main`:

```bash
REPO_URL=https://your-git-host/labsy-tool-hub.git REPO_REF=v1.2.0 ./install.sh
```

## Troubleshooting

- **Health check fails at the end of the script** — `journalctl -u labsy-hub
  -n 50 --no-pager`. Most often a build failure further up the log, or the
  service failing its own env validation on boot.
- **`systemctl status` shows the service sandboxed-denied on a write** —
  intentional (`ProtectSystem=strict` + a narrow `ReadWritePaths` — PRD
  §12.3). If a legitimate write is being blocked, check `STORAGE_ROOT` and
  `DATABASE_URL` in `/etc/labsy-hub/env` actually point inside
  `/srv/downloads` or `/var/lib/labsy-hub`.
- **A file staged by `rsync`/Samba isn't visible to the app** — verify the
  ACLs: `sudo -u labsy test -r <file> && echo readable`. If that fails,
  re-apply them: `sudo setfacl -R -m g:labsy:rX /srv/downloads && sudo setfacl
  -R -d -m g:labsy:rX /srv/downloads` (PRD §12.2).
