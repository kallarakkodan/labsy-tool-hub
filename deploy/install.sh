#!/usr/bin/env bash
#
# deploy/install.sh — provisions Ubuntu 24.04 and deploys Labsy Tool Hub from
# a git checkout. Safe to re-run: a second run on an already-installed host
# upgrades in place (fetches REPO_REF, rebuilds, restarts) without touching
# existing secrets. See deploy/INSTALL.md for the full walkthrough.
#
# Usage:
#   REPO_URL=https://your-git-host/labsy-tool-hub.git ./install.sh
#   ./install.sh https://your-git-host/labsy-tool-hub.git [REPO_REF]
#
# Env vars:
#   REPO_URL       git remote to clone/fetch (required — this repo ships
#                   with no remote configured; push it somewhere first)
#   REPO_REF       branch, tag, or commit to deploy (default: main)
#   INSTALL_DIR    where the checkout + build live (default: /opt/labsy-hub)
#   ADMIN_PASSWORD admin password for a *fresh* install, set non-interactively.
#                   Omit to be prompted (hidden input). Ignored on upgrades —
#                   an existing /etc/labsy-hub/env is never overwritten.

set -euo pipefail

REPO_URL="${1:-${REPO_URL:-}}"
REPO_REF="${2:-${REPO_REF:-main}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/labsy-hub}"
ENV_FILE="/etc/labsy-hub/env"
SERVICE_USER="labsy"
NODE_MAJOR="26"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo $0 ...)"
[[ -n "$REPO_URL" ]] || die "REPO_URL is required — see the usage note at the top of this script"
command -v apt-get >/dev/null 2>&1 || die "this script targets Ubuntu/Debian (apt-get not found)"

if [[ -d "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
  die "$INSTALL_DIR exists and is not a git checkout this script manages — move it aside and re-run"
fi

# ---- OS packages --------------------------------------------------------------

log "Installing OS packages (curl, git, sqlite3, acl, openssl)"
apt-get update -y
apt-get install -y --no-install-recommends curl ca-certificates gnupg git sqlite3 acl openssl

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "Installing pnpm"
  # Not `corepack enable`: corepack is unbundled from Node 25+ (PRD §12.2).
  npm install -g pnpm
fi

# ---- system user + directory layout (PRD §12.1, §12.2) ------------------------

log "Creating the ${SERVICE_USER} system user"
id -u "$SERVICE_USER" >/dev/null 2>&1 || \
  adduser --system --group --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

log "Creating directory layout"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 2775 /srv/downloads
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 /srv/downloads/.uploads
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 /var/lib/labsy-hub /var/backups/labsy-hub
install -d -o root -g "$SERVICE_USER" -m 0750 /etc/labsy-hub

log "Applying default ACLs on /srv/downloads (files staged by rsync/scp/Samba stay readable)"
setfacl -R -m g:"$SERVICE_USER":rX /srv/downloads
setfacl -R -d -m g:"$SERVICE_USER":rX /srv/downloads

# The two calls above are recursive over all of /srv/downloads, which also
# reaches .uploads — but .uploads is the app's own chunk-assembly scratch
# space, not an rsync/scp/Samba staging target, and PRD §12.1 states it stays
# 0700 (owner-only). Strip the ACL entries back off it so it doesn't inherit
# group-readability it was never meant to have; -b removes all extended ACL
# entries (access and default) while leaving the base owner/group/other bits
# alone. `chmod g-s`, not a numeric mode: a setgid directory forces the bit
# onto every subdirectory created inside it at the kernel level, and GNU
# chmod's numeric form silently leaves an already-set setgid bit alone unless
# given an unambiguous 5-digit mode (`chmod 0700` does NOT clear it — found by
# testing, not by reading the man page). The symbolic `g-s` clears it every
# time.
setfacl -R -b /srv/downloads/.uploads
chmod g-s /srv/downloads/.uploads

# ---- fetch the app --------------------------------------------------------------

# git refuses to operate on a repo owned by a different user than the one
# running it (CVE-2022-24765) — and after the first run's chown below,
# $INSTALL_DIR is labsy-owned while these commands run as root. Without this,
# every upgrade re-run fails with "detected dubious ownership".
git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$INSTALL_DIR" || \
  git config --global --add safe.directory "$INSTALL_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Updating existing checkout at ${INSTALL_DIR} to ${REPO_REF}"
else
  log "Cloning ${REPO_URL} (${REPO_REF}) into ${INSTALL_DIR}"
  install -d -o root -g root -m 0755 "$INSTALL_DIR"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi
# `fetch <ref> && checkout FETCH_HEAD` works uniformly whether REPO_REF is a
# branch, a tag, or a bare commit SHA — no need to special-case any of them.
git -C "$INSTALL_DIR" fetch --quiet origin "$REPO_REF"
git -C "$INSTALL_DIR" checkout --quiet FETCH_HEAD
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# ---- secrets (fresh install only — never overwrite an existing env file) ------

if [[ -f "$ENV_FILE" ]]; then
  log "${ENV_FILE} already exists — leaving it as-is (this is an upgrade)"
else
  log "Generating AUTH_SECRET and the admin password hash"
  AUTH_SECRET="$(openssl rand -base64 48)"

  if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
    HASH_LINE="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" node "$INSTALL_DIR/deploy/docker/gen-hash.cjs" | grep '^ADMIN_PASSWORD_HASH=')"
  else
    echo
    echo "Set the admin password (signs in at /admin — PRD §11.4, one shared password):"
    HASH_LINE="$(node "$INSTALL_DIR/deploy/docker/gen-hash.cjs" | grep '^ADMIN_PASSWORD_HASH=')"
  fi

  cat > "$ENV_FILE" <<EOF
DATABASE_URL="file:/var/lib/labsy-hub/db.sqlite"
STORAGE_ROOT="/srv/downloads"
NEXT_PUBLIC_APP_VERSION="1.0.0"
$HASH_LINE
AUTH_SECRET="$AUTH_SECRET"
SESSION_TTL_HOURS="8"
COOKIE_SECURE="true"
CHUNK_SIZE="16777216"
UPLOAD_SUBDIR="uploads"
UPLOAD_TTL_HOURS="24"
USE_X_ACCEL="false"
X_ACCEL_PREFIX="/_protected"
EOF
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

# ---- install + build ------------------------------------------------------------

log "Installing dependencies, syncing the database schema, and building"
# Runs as the labsy user (which now owns $INSTALL_DIR) so build output and
# node_modules land with the right ownership without a trailing chown pass.
# Sourcing $ENV_FILE means `next build`'s boot-time env validation (lib/env.ts,
# instrumentation.ts) exercises the real production config, not a placeholder.
BUILD_SCRIPT="$(mktemp)"
cat > "$BUILD_SCRIPT" <<EOF
set -euo pipefail
cd "$INSTALL_DIR"
set -a
source "$ENV_FILE"
set +a
pnpm install --frozen-lockfile
pnpm db:push
pnpm build
EOF
chmod 644 "$BUILD_SCRIPT"
sudo -u "$SERVICE_USER" bash "$BUILD_SCRIPT"
rm -f "$BUILD_SCRIPT"

# ---- systemd ----------------------------------------------------------------------

log "Installing and (re)starting systemd units"
cp "$INSTALL_DIR"/deploy/labsy-hub.service \
   "$INSTALL_DIR"/deploy/labsy-hub-backup.service \
   "$INSTALL_DIR"/deploy/labsy-hub-backup.timer \
   "$INSTALL_DIR"/deploy/labsy-hub-sweep.service \
   "$INSTALL_DIR"/deploy/labsy-hub-sweep.timer \
   /etc/systemd/system/
systemctl daemon-reload
systemctl enable labsy-hub.service
systemctl restart labsy-hub.service
systemctl enable --now labsy-hub-backup.timer
systemctl enable --now labsy-hub-sweep.timer

log "Verifying the service is up"
sleep 2
if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo "  Health check OK: http://127.0.0.1:3000/api/health"
else
  echo "  Health check failed — inspect: journalctl -u labsy-hub -n 50 --no-pager" >&2
  exit 1
fi

log "Done"
echo "Next: point Nginx Proxy Manager at 127.0.0.1:3000 (PRD §12.5) — see deploy/README.md."
echo "Re-run this script any time to upgrade: it fetches ${REPO_REF}, rebuilds, and restarts."
