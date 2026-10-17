#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/opt/autoshop/backups/daily}"
DB_CONTAINER="${DB_CONTAINER:-collision-shop-db}"
API_CONTAINER="${API_CONTAINER:-collision-shop-api}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/autoshop-${TIMESTAMP}"
STAGING_DIR="${BACKUP_ROOT}/.partial-${TIMESTAMP}-$$"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

container_running() {
  [[ "$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]
}

container_running "$DB_CONTAINER" || fail "Database container '$DB_CONTAINER' is not running"
container_running "$API_CONTAINER" || fail "API container '$API_CONTAINER' is not running"

DB_NAME="$(docker exec "$DB_CONTAINER" printenv POSTGRES_DB)"
DB_USER="$(docker exec "$DB_CONTAINER" printenv POSTGRES_USER)"
[[ -n "$DB_NAME" && -n "$DB_USER" ]] || fail "Database name or user is unavailable"

install -d -m 700 "$BACKUP_ROOT"
STAGING_DIR="$(mktemp -d "${BACKUP_ROOT}/.partial-${TIMESTAMP}-XXXXXX")"
trap 'rm -rf -- "$STAGING_DIR"' EXIT
[[ ! -e "$BACKUP_DIR" ]] || fail "A backup already exists for timestamp ${TIMESTAMP}"

AVAILABLE_KB="$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || fail "Could not determine free backup space"
(( AVAILABLE_KB >= 1048576 )) || fail "Less than 1 GiB free in backup filesystem"

echo "Creating database backup for ${DB_NAME}"
docker exec "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-acl \
  > "${STAGING_DIR}/database.dump"
[[ -s "${STAGING_DIR}/database.dump" ]] || fail "Database archive is empty"
docker exec -i "$DB_CONTAINER" pg_restore --list \
  < "${STAGING_DIR}/database.dump" > /dev/null

echo "Creating uploads backup"
docker exec "$API_CONTAINER" tar -czf - -C /app/uploads . \
  > "${STAGING_DIR}/uploads.tar.gz"
[[ -s "${STAGING_DIR}/uploads.tar.gz" ]] || fail "Uploads archive is empty"
tar -tzf "${STAGING_DIR}/uploads.tar.gz" > /dev/null

{
  printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'git_revision=%s\n' "$(git -c safe.directory=/opt/autoshop/app -C /opt/autoshop/app rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'database=%s\n' "$DB_NAME"
  printf 'database_container=%s\n' "$DB_CONTAINER"
  printf 'uploads_container=%s\n' "$API_CONTAINER"
  printf 'uploads_file_count=%s\n' "$(tar -tzf "${STAGING_DIR}/uploads.tar.gz" | awk '$0 !~ /\/$/ { count++ } END { print count + 0 }')"
} > "${STAGING_DIR}/manifest.txt"
(
  cd "$STAGING_DIR"
  sha256sum database.dump uploads.tar.gz > checksums.sha256
  sha256sum --check checksums.sha256
)

chmod 600 "${STAGING_DIR}/database.dump" "${STAGING_DIR}/uploads.tar.gz" "${STAGING_DIR}/manifest.txt" "${STAGING_DIR}/checksums.sha256"
mv -- "$STAGING_DIR" "$BACKUP_DIR"
trap - EXIT
echo "Backup completed and verified: ${BACKUP_DIR}"
cat "${BACKUP_DIR}/manifest.txt"
cat "${BACKUP_DIR}/checksums.sha256"

while IFS= read -r -d '' candidate; do
  name="${candidate##*/}"
  if [[ "$name" =~ ^autoshop-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo "Removing expired backup: ${candidate}"
    rm -rf -- "$candidate"
  fi
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'autoshop-????????T??????Z' -mtime "+${RETENTION_DAYS}" -print0)
