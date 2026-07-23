#!/usr/bin/env bash
# Strong CAST backup: a consistent (WAL-safe) sqlite snapshot + all non-git
# runtime state — encryption key, .env secrets, the extension signing key, and
# the acme-dns cert account — tarred with retention. Code is already in git.
# Run as root (systemd) or:  sudo bash scripts/backup.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cast/app}"
DATA_DIR="${CAST_DATA_HOST:-/opt/cast/data}"
BACKUP_DIR="${CAST_BACKUP_DIR:-/opt/cast/backups}"
KEEP="${CAST_BACKUP_KEEP:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

# 1. Consistent sqlite snapshot via better-sqlite3's online backup (handles WAL).
docker compose exec -T api node -e "const D=require('better-sqlite3');const db=new D('/app/components/api/.data/cast.db',{readonly:true});db.backup('/app/components/api/.data/.snapshot.db').then(()=>{db.close();process.exit(0)}).catch(e=>{console.error(String(e));process.exit(1)})"

# 2. Stage everything that is NOT in git.
stage="$(mktemp -d)"
cp "$DATA_DIR/.snapshot.db" "$stage/cast.db"
[ -f "$DATA_DIR/secret.key" ] && cp "$DATA_DIR/secret.key" "$stage/secret.key"
[ -f "$APP_DIR/components/api/.env" ] && cp "$APP_DIR/components/api/.env" "$stage/env"
[ -f /opt/cast/keys/cast-ext-signing.pem ] && cp /opt/cast/keys/cast-ext-signing.pem "$stage/cast-ext-signing.pem"
[ -f /etc/letsencrypt/acmedns.json ] && cp /etc/letsencrypt/acmedns.json "$stage/acmedns.json"

# 3. Tar it up (root-only perms — the archive contains secrets).
tarball="$BACKUP_DIR/cast-backup-$TS.tar.gz"
tar -czf "$tarball" -C "$stage" .
chmod 600 "$tarball"
rm -rf "$stage" "$DATA_DIR/.snapshot.db"
echo "backup written: $tarball ($(du -h "$tarball" | cut -f1))"

# 4. Retention — keep the newest $KEEP, prune older.
ls -1t "$BACKUP_DIR"/cast-backup-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "backups retained: $(ls -1 "$BACKUP_DIR"/cast-backup-*.tar.gz 2>/dev/null | wc -l)"

# NOTE: these live on the VM. For true DR, copy off-box (encrypted) to a second
# location — rclone/scp to cloud or another host. Destination TBD (see canon).
