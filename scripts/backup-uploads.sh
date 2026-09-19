#!/usr/bin/env bash
# Archives the api_uploads Docker volume (customer documents/photos) to
# $BACKUP_DIR as a timestamped tarball, alongside the Postgres backups.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/mnt/gdrive-backups/uploads}"
VOLUME="${UPLOADS_VOLUME:-autoshop-software_api_uploads}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/api_uploads-${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

echo "==> Archiving volume ${VOLUME} to ${FILE}"
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine \
  tar czf "/backup/$(basename "${FILE}")" -C /data .

SIZE="$(du -h "${FILE}" | cut -f1)"
echo "==> Backup complete: ${FILE} (${SIZE})"

# Backups are never deleted here by design — the Google Drive mount is the
# long-term archive.
