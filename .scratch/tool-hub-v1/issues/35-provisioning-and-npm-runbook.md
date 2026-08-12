# 35 — Server provisioning, ACLs, NPM proxy host, deploy runbook

Status: ready-for-human
Phase: P5
Blocked by: 34
Spec: PRD §12.1, §12.2, §12.5, §12.6, PRD §16 D1, D2

## Why

Needs root on the Ubuntu box and access to the Nginx Proxy Manager admin UI. The
`proxy_request_buffering off` directive in particular is an **integration
contract**, not tuning — uploads break without it.

## Scope

**On the host** (PRD §12.2):
- Create the `labsy` system user; install Node 22, sqlite3, `acl`; enable corepack/pnpm.
- Create the directory layout from PRD §12.1 with the stated owners and modes,
  including the setgid bit on `/srv/downloads` (mode 2775) and `.uploads` at 0700.
- Default POSIX ACLs, both lines:
  - `setfacl -R -m g:labsy:rX /srv/downloads`
  - `setfacl -R -d -m g:labsy:rX /srv/downloads`
- `/etc/labsy-hub/env` populated (mode 0640, `root:labsy`) with a real
  `AUTH_SECRET` and a hash from `pnpm gen:hash`. **Paste the line `gen:hash`
  prints verbatim, backslashes and all** — see "Watch out" below.
- `ufw allow from <NPM-IP> to any port 3000 proto tcp` — or skip it entirely and
  bind `127.0.0.1` if NPM is co-located (PRD §12.6).
- Optional: Samba share with `force group = labsy`, `create mask = 0664`,
  `directory mask = 2775`.

**In NPM** (PRD §12.5) — proxy host to the app on `:3000`, Advanced tab:
```nginx
client_max_body_size 32m;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
send_timeout 3600s;
proxy_set_header X-Forwarded-Proto $scheme;
```
Leave **Block Common Exploits off**. TLS/cert management is the operator's and
out of scope (D1).

**Runbook** — commit `deploy/RUNBOOK.md` covering the release procedure:
`git pull` → `pnpm install --frozen-lockfile` → `pnpm prisma migrate deploy` →
`pnpm build` → `sudo systemctl restart labsy-hub`.

## Done when

- [ ] A file dropped into `/srv/downloads` by `rsync -a` as a *different* user is
      readable by `labsy` with no manual `chmod`:
      `sudo -u labsy test -r <file> && echo readable` (PRD §14)
- [ ] The service starts under systemd and survives a reboot
- [ ] The site loads over HTTPS through NPM and login persists across a reload
      (proves `COOKIE_SECURE` matches the scheme NPM serves)

## Watch out

- `proxy_request_buffering off` is the directive most easily missed — without it
  NPM spools every 16 MiB chunk to its own container disk, doubling write I/O and
  making the progress bar meaningless.
- If NPM ever fronts this over plain HTTP, `COOKIE_SECURE=false` is required or
  login silently never sticks. That is the only place the app couples to the TLS
  decision.
- **Every `$` in `ADMIN_PASSWORD_HASH` must be escaped as `\$`,** in
  `/etc/labsy-hub/env` exactly as in `.env.local`. Next loads the environment
  through `@next/env`, which runs dotenv-expand over `process.env` itself — so
  the hash is mangled even when systemd's `EnvironmentFile=` sets it correctly.
  `pnpm gen:hash` prints the escaped line; paste it as-is. Found while verifying
  issue 20; the boot gate now refuses the mangled form rather than starting a
  service whose password can never be accepted (CONTEXT §3).
