#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/opt/autoshop/backups/daily}"
DB_CONTAINER="${DB_CONTAINER:-collision-shop-db}"
API_CONTAINER="${API_CONTAINER:-collision-shop-api}"
DOCUMENSO_DB_CONTAINER="${DOCUMENSO_DB_CONTAINER:-documenso-postgres}"
DOCUMENSO_DIR="${DOCUMENSO_DIR:-/opt/documenso}"
LEGACY_DOCUSEAL_DB_CONTAINER="${LEGACY_DOCUSEAL_DB_CONTAINER:-docuseal-postgres-1}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive-crypt:}"
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
container_running "$DOCUMENSO_DB_CONTAINER" || fail "Documenso database container '$DOCUMENSO_DB_CONTAINER' is not running"
command -v rclone >/dev/null || fail "rclone is not installed"

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

DOCUMENSO_DB_NAME="$(docker exec "$DOCUMENSO_DB_CONTAINER" printenv POSTGRES_DB)"
DOCUMENSO_DB_USER="$(docker exec "$DOCUMENSO_DB_CONTAINER" printenv POSTGRES_USER)"
[[ -n "$DOCUMENSO_DB_NAME" && -n "$DOCUMENSO_DB_USER" ]] || fail "Documenso database name or user is unavailable"
[[ -s "${DOCUMENSO_DIR}/.env" && -s "${DOCUMENSO_DIR}/compose.yml" && -s "${DOCUMENSO_DIR}/cert.p12" ]] \
  || fail "Documenso config, Compose file, or signing certificate is unavailable"

echo "Creating Documenso database backup for ${DOCUMENSO_DB_NAME}"
docker exec "$DOCUMENSO_DB_CONTAINER" pg_dump \
  -U "$DOCUMENSO_DB_USER" -d "$DOCUMENSO_DB_NAME" --format=custom --no-owner --no-acl \
  > "${STAGING_DIR}/documenso-database.dump"
[[ -s "${STAGING_DIR}/documenso-database.dump" ]] || fail "Documenso database archive is empty"
docker exec -i "$DOCUMENSO_DB_CONTAINER" pg_restore --list \
  < "${STAGING_DIR}/documenso-database.dump" > /dev/null
tar -czf "${STAGING_DIR}/documenso-recovery.tar.gz" -C "$DOCUMENSO_DIR" .env compose.yml cert.p12
[[ -s "${STAGING_DIR}/documenso-recovery.tar.gz" ]] || fail "Documenso recovery archive is empty"
tar -tzf "${STAGING_DIR}/documenso-recovery.tar.gz" > /dev/null

if container_running "$LEGACY_DOCUSEAL_DB_CONTAINER"; then
  LEGACY_DOCUSEAL_DB_NAME="$(docker exec "$LEGACY_DOCUSEAL_DB_CONTAINER" printenv POSTGRES_DB)"
  LEGACY_DOCUSEAL_DB_USER="$(docker exec "$LEGACY_DOCUSEAL_DB_CONTAINER" printenv POSTGRES_USER)"
  [[ -n "$LEGACY_DOCUSEAL_DB_NAME" && -n "$LEGACY_DOCUSEAL_DB_USER" ]] || fail "Legacy DocuSeal database name or user is unavailable"
  echo "Creating legacy DocuSeal database backup for ${LEGACY_DOCUSEAL_DB_NAME}"
  docker exec "$LEGACY_DOCUSEAL_DB_CONTAINER" pg_dump \
    -U "$LEGACY_DOCUSEAL_DB_USER" -d "$LEGACY_DOCUSEAL_DB_NAME" --format=custom --no-owner --no-acl \
    > "${STAGING_DIR}/legacy-docuseal-database.dump"
  [[ -s "${STAGING_DIR}/legacy-docuseal-database.dump" ]] || fail "Legacy DocuSeal database archive is empty"
  docker exec -i "$LEGACY_DOCUSEAL_DB_CONTAINER" pg_restore --list \
    < "${STAGING_DIR}/legacy-docuseal-database.dump" > /dev/null
fi

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
  printf 'documenso_database=%s\n' "$DOCUMENSO_DB_NAME"
  printf 'documenso_database_container=%s\n' "$DOCUMENSO_DB_CONTAINER"
  if [[ -n "${LEGACY_DOCUSEAL_DB_NAME:-}" ]]; then
    printf 'legacy_docuseal_database=%s\n' "$LEGACY_DOCUSEAL_DB_NAME"
    printf 'legacy_docuseal_database_container=%s\n' "$LEGACY_DOCUSEAL_DB_CONTAINER"
  fi
  printf 'uploads_container=%s\n' "$API_CONTAINER"
  printf 'uploads_file_count=%s\n' "$(tar -tzf "${STAGING_DIR}/uploads.tar.gz" | awk '$0 !~ /\/$/ { count++ } END { print count + 0 }')"
} > "${STAGING_DIR}/manifest.txt"
(
  cd "$STAGING_DIR"
  BACKUP_FILES=(database.dump documenso-database.dump documenso-recovery.tar.gz uploads.tar.gz)
  [[ ! -f legacy-docuseal-database.dump ]] || BACKUP_FILES+=(legacy-docuseal-database.dump)
  sha256sum "${BACKUP_FILES[@]}" > checksums.sha256
  sha256sum --check checksums.sha256
)

chmod 600 "${STAGING_DIR}/"*.dump "${STAGING_DIR}/documenso-recovery.tar.gz" \
  "${STAGING_DIR}/uploads.tar.gz" "${STAGING_DIR}/manifest.txt" "${STAGING_DIR}/checksums.sha256"
mv -- "$STAGING_DIR" "$BACKUP_DIR"
trap - EXIT
echo "Backup completed and verified: ${BACKUP_DIR}"
cat "${BACKUP_DIR}/manifest.txt"
cat "${BACKUP_DIR}/checksums.sha256"

REMOTE_DIR="${RCLONE_REMOTE%/}/${BACKUP_DIR##*/}"
REMOTE_FAILED=0
if ! rclone lsf "$RCLONE_REMOTE" --max-depth 1 >/dev/null; then
  echo "ERROR: Local backup completed, but encrypted Google Drive remote '${RCLONE_REMOTE}' is unavailable." >&2
  REMOTE_FAILED=1
else
  echo "Uploading encrypted backup to ${REMOTE_DIR}"
  if rclone copy "$BACKUP_DIR" "$REMOTE_DIR" \
    --checkers 4 --transfers 2 --retries 3 --low-level-retries 10 \
    && rclone check "$BACKUP_DIR" "$REMOTE_DIR" --download --one-way; then
    echo "Encrypted Google Drive copy verified: ${REMOTE_DIR}"
  else
    echo "ERROR: Local backup completed, but Google Drive upload or verification failed." >&2
    REMOTE_FAILED=1
  fi
fi

while IFS= read -r -d '' candidate; do
  name="${candidate##*/}"
  if [[ "$name" =~ ^autoshop-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo "Removing expired backup: ${candidate}"
    rm -rf -- "$candidate"
  fi
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'autoshop-????????T??????Z' -mtime "+${RETENTION_DAYS}" -print0)

(( REMOTE_FAILED == 0 )) || fail "Local backup succeeded; offsite Google Drive backup did not. See the preceding rclone error."
