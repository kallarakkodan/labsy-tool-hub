#!/usr/bin/env bash
#
# deploy/docker/entrypoint.sh — runs as the container's PID 1 (via ENTRYPOINT),
# before handing off to CMD.
#
# Two jobs, both idempotent and safe to run on every start:
#   1. Sync the SQLite schema onto whatever's mounted at DATABASE_URL. On a
#      fresh volume this creates the file; on an existing one it is a no-op
#      unless the image shipped a newer prisma/schema.prisma.
#   2. `exec "$@"` — replaces this shell with the real process (Next), so
#      Node becomes PID 1 and receives SIGTERM directly. Without `exec`,
#      `docker stop` would kill this wrapper script and Next would linger
#      until the grace period expired.

set -euo pipefail

echo "[entrypoint] syncing database schema..."
node_modules/.bin/prisma db push

echo "[entrypoint] starting: $*"
exec "$@"
