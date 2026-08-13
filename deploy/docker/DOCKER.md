# Docker deployment

Runs Labsy Tool Hub as a single container via Docker Compose. This is the
faster path to a working instance; `deploy/INSTALL.md` (systemd on bare
Ubuntu) is the alternative if you want the app running directly on the host
instead of inside a container — see that file's intro for the trade-offs.

Everything here targets a fresh host with nothing but Docker installed.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose version` works)
- This repo pushed to a git host you can reach from the target machine (it
  ships with no remote configured — see `deploy/INSTALL.md`'s note on this)
- A reverse proxy in front for TLS — Nginx Proxy Manager is what the rest of
  this project's docs assume (PRD §12.5); any proxy that can forward to a
  container port works

## Install

```bash
git clone <your-repo-url> labsy-tool-hub
cd labsy-tool-hub

cp .env.docker.example .env.docker
```

Generate the two secrets `.env.docker` has no default for:

```bash
# AUTH_SECRET — signs the session cookie
openssl rand -base64 48

# ADMIN_PASSWORD_HASH — the one shared admin password (PRD §11.4)
docker compose run --rm --entrypoint node app deploy/docker/gen-hash.cjs
```

The hash generator prints a ready-to-paste `ADMIN_PASSWORD_HASH="..."` line —
paste it verbatim into `.env.docker`, backslashes and all. **Every `$` must
stay escaped as `\$`** — the app's own env loader mangles a bare `$` and
refuses to boot rather than silently accept a broken hash (`src/lib/env.ts`).
Paste the `openssl` output into `AUTH_SECRET` the same way.

Then build and start:

```bash
docker compose up -d --build
```

Verify:

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"version":"...","uptime":...,"storageRootWritable":true,"dbOk":true,"toolCount":0}
```

The database schema is created automatically on first start
(`deploy/docker/entrypoint.sh` runs `prisma db push` before `next start`
every time the container starts — a no-op once the schema is current).

## Configuration

All variables live in `.env.docker` (gitignored — copy from
`.env.docker.example`, never commit a filled-in copy). Anything not set there
falls back to the default baked into the image (`Dockerfile`'s runner-stage
`ENV` block):

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | *(none — required)* | Generate as shown above |
| `AUTH_SECRET` | *(none — required)* | `openssl rand -base64 48` |
| `DATABASE_URL` | `file:/data/db.sqlite` | Points inside the `labsy-data` volume — do not change unless you also change the volume mount |
| `STORAGE_ROOT` | `/srv/downloads` | Points inside the `labsy-storage` volume |
| `NEXT_PUBLIC_APP_VERSION` | `1.0.0` | Shown in the header tag |
| `CHUNK_SIZE` | `16777216` (16 MiB) | Your proxy's max body size must exceed this |
| `UPLOAD_SUBDIR` | `uploads` | Relative to `STORAGE_ROOT` |
| `UPLOAD_TTL_HOURS` | `24` | Abandoned upload cleanup window |
| `SESSION_TTL_HOURS` | `8` | Admin session lifetime |
| `COOKIE_SECURE` | `true` | Set `false` **only** if nothing in front of this container terminates TLS — see the warning below |
| `USE_X_ACCEL` | `false` | Leave `false` unless your proxy is co-located and has the storage volume mounted — PRD §12.4 |

**`COOKIE_SECURE`**: if your reverse proxy serves the site over HTTPS (the
normal case), leave this `true`. If you are hitting the container directly
over plain HTTP — local testing only — set it `false`, or login will appear
to succeed but the session will never stick.

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

Leave **Block Common Exploits** off. TLS/certificate management is the
operator's concern and out of scope here.

### Volumes

`docker-compose.yml` uses two named volumes, not bind mounts, so file
ownership inside the container's `labsy` user matches automatically:

- `labsy-storage` → `/srv/downloads` (the artifacts)
- `labsy-data` → `/data` (the SQLite database)

Use bind mounts instead if you specifically want the artifacts addressable
from the host filesystem (e.g. so another process can `rsync` files in
directly) — replace the volume lines in `docker-compose.yml` with host paths
and make sure they're writable by whatever UID the container's `labsy` user
resolves to (`docker compose exec app id labsy`).

### Ports

`docker-compose.yml` publishes `3000:3000` on all interfaces by default.
Restrict it to loopback if the proxy is on the same host and nothing else
should reach it directly:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

## Upgrading

```bash
git pull
docker compose up -d --build
```

Rebuilds the image and recreates the container; the named volumes (database,
artifacts) are untouched. `.env.docker` is never regenerated — existing
secrets survive every upgrade.

## Backups

There is no systemd timer inside the container, so the nightly backup this
project otherwise runs via `labsy-hub-backup.timer` needs a cron job on the
**host** instead:

```cron
0 2 * * * cd /path/to/labsy-tool-hub && docker compose exec -T app env LABSY_DB_PATH=/data/db.sqlite bash deploy/backup.sh >> /var/log/labsy-backup.log 2>&1
```

Writes into `/tmp` inside the container by default unless you also set
`LABSY_BACKUP_DIR` — mount a host directory or a third named volume if you
want the `.sqlite.gz` files to survive a container recreation, since `/tmp`
does not persist across `docker compose up --build`. Same idea for the weekly
`fileMissing` integrity sweep (`labsy-hub-sweep.timer`'s job):

```cron
0 3 * * 0 cd /path/to/labsy-tool-hub && docker compose exec -T app node_modules/.bin/tsx scripts/sweep-file-missing.ts >> /var/log/labsy-sweep.log 2>&1
```

Artifacts under `STORAGE_ROOT` are deliberately **not** backed up by either
script — they are large and reproducible from source (PRD §12.7).

## Troubleshooting

- **Container restarts in a loop** — `docker compose logs app`. The most
  common cause is a malformed `ADMIN_PASSWORD_HASH` or `AUTH_SECRET` in
  `.env.docker`; the app refuses to boot rather than start with a broken
  config (`src/lib/env.ts`).
- **Login succeeds but doesn't stick** — `COOKIE_SECURE=true` (the default)
  requires the connection to actually be HTTPS by the time it reaches the
  browser. If you're testing over plain HTTP, set `COOKIE_SECURE=false`.
- **Upload stalls or the progress bar doesn't move** — almost always a proxy
  missing `proxy_request_buffering off` — see the NPM section above.
