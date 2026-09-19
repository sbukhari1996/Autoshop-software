#!/usr/bin/env bash
# Restores a Postgres backup produced by backup-db.sh.
# Usage: scripts/restore-db.sh /mnt/gdrive-backups/postgres/collision_shop-20260918-020000.sql.gz
set -euo pipefail

FILE="${1:?Usage: restore-db.sh <path-to-backup.sql.gz>}"
CONTAINER="${DB_CONTAINER:-collision-shop-db}"
DB_NAME="${POSTGRES_DB:-collision_shop}"
DB_USER="${POSTGRES_USER:-collision_shop_app}"

if [[ ! -f "${FILE}" ]]; then
  echo "Backup file not found: ${FILE}" >&2
  exit 1
fi

read -r -p "This will overwrite the '${DB_NAME}' database in ${CONTAINER}. Continue? [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  echo "Cancelled."
  exit 1
fi

echo "==> Restoring ${FILE} into ${DB_NAME}"
gunzip -c "${FILE}" | docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "==> Restore complete"
