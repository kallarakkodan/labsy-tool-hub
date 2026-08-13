#!/usr/bin/env bash
#
# deploy/backup.sh — nightly SQLite backup (PRD §12.7), run by
# labsy-hub-backup.timer via labsy-hub-backup.service.
#
# Backs up the database ONLY. Artifacts under STORAGE_ROOT (/srv/downloads)
# are NOT backed up by this script — they are large and reproducible from the
# source Arun rsync'd them from; back those up separately if at all, and never
# by adding them here without a deliberate, documented decision to do so.
#
# sqlite3's ".backup" is an online backup (PRD §4's WAL mode is what makes this
# safe against a live writer) — the service does not need to be stopped.

set -euo pipefail

DB_PATH="${LABSY_DB_PATH:-/var/lib/labsy-hub/db.sqlite}"
BACKUP_DIR="${LABSY_BACKUP_DIR:-/var/backups/labsy-hub}"
RETAIN_DAYS=14

mkdir -p "$BACKUP_DIR"

DEST="$BACKUP_DIR/db-$(date +%F).sqlite"

sqlite3 "$DB_PATH" ".backup $DEST"
gzip -f "$DEST"

# Prune anything older than the retention window. -mtime +N means "modified
# more than N days ago" — today's backup, just written, is never a candidate.
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sqlite.gz' -mtime "+$RETAIN_DAYS" -delete

echo "[backup] wrote ${DEST}.gz"
