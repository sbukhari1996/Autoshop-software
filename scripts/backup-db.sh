#!/usr/bin/env bash
# Dumps the production Postgres database to $BACKUP_DIR as a timestamped, gzipped file.
# Intended to run on the Ubuntu VM via cron, with $BACKUP_DIR pointed at the
# mounted Google Drive storage so backups survive even if the VM is lost.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/mnt/gdrive-backups/postgres}"
CONTAINER="${DB_CONTAINER:-collision-shop-db}"
DB_NAME="${POSTGRES_DB:-collision_shop}"
DB_USER="${POSTGRES_USER:-collision_shop_app}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/collision_shop-${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "==> Dumping ${DB_NAME} from ${CONTAINER} to ${FILE}"
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" | gzip > "${FILE}"

SIZE="$(du -h "${FILE}" | cut -f1)"
echo "==> Backup complete: ${FILE} (${SIZE})"

# Backups are never deleted here by design — the Google Drive mount is the
# long-term archive. If you later want local retention limits on the VM
# itself (separate from the Drive archive), add pruning logic here.
