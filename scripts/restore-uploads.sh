#!/usr/bin/env bash
# Restores the api_uploads volume from a tarball produced by backup-uploads.sh.
# Usage: scripts/restore-uploads.sh /mnt/gdrive-backups/uploads/api_uploads-20260918-020000.tar.gz
set -euo pipefail

FILE="${1:?Usage: restore-uploads.sh <path-to-backup.tar.gz>}"
VOLUME="${UPLOADS_VOLUME:-autoshop-software_api_uploads}"

if [[ ! -f "${FILE}" ]]; then
  echo "Backup file not found: ${FILE}" >&2
  exit 1
fi

read -r -p "This will overwrite all files in volume '${VOLUME}'. Continue? [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  echo "Cancelled."
  exit 1
fi

echo "==> Restoring ${FILE} into ${VOLUME}"
docker run --rm \
  -v "${VOLUME}:/data" \
  -v "$(dirname "${FILE}"):/backup" \
  alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/$(basename "${FILE}") -C /data"

echo "==> Restore complete"
