#!/usr/bin/env bash
# Restore CAST from a backup tarball made by backup.sh.
# Usage:  sudo bash scripts/restore.sh /opt/cast/backups/cast-backup-<TS>.tar.gz
set -euo pipefail
tarball="${1:?usage: restore.sh <backup tarball>}"
APP_DIR="${APP_DIR:-/opt/cast/app}"
DATA_DIR="${CAST_DATA_HOST:-/opt/cast/data}"

stage="$(mktemp -d)"
tar -xzf "$tarball" -C "$stage"
cd "$APP_DIR"

echo "Stopping CAST..."
docker compose down

mkdir -p "$DATA_DIR"
cp "$stage/cast.db" "$DATA_DIR/cast.db"
# Drop stale WAL/SHM so the restored DB is authoritative.
rm -f "$DATA_DIR/cast.db-wal" "$DATA_DIR/cast.db-shm"
[ -f "$stage/secret.key" ] && cp "$stage/secret.key" "$DATA_DIR/secret.key"
[ -f "$stage/env" ] && cp "$stage/env" "$APP_DIR/components/api/.env"
[ -f "$stage/cast-ext-signing.pem" ] && { mkdir -p /opt/cast/keys; cp "$stage/cast-ext-signing.pem" /opt/cast/keys/; }
[ -f "$stage/acmedns.json" ] && cp "$stage/acmedns.json" /etc/letsencrypt/acmedns.json
rm -rf "$stage"

echo "Starting CAST..."
docker compose up -d
echo "Restored from $tarball"
