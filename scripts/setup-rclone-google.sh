#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_DIR="${RCLONE_CONFIG_DIR:-/root/.config/rclone}"
CONFIG_FILE="${CONFIG_DIR}/rclone.conf"
RECOVERY_FILE="${CONFIG_DIR}/crypt-recovery.txt"
DRIVE_REMOTE="${DRIVE_REMOTE:-gdrive}"
CRYPT_REMOTE="${CRYPT_REMOTE:-gdrive-crypt}"
DRIVE_FOLDER="${DRIVE_FOLDER:-Autoshop-Encrypted-Backups}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root so the unattended backup service can use its config." >&2
  exit 1
fi
command -v rclone >/dev/null || { echo "rclone is not installed" >&2; exit 1; }
install -d -m 700 "$CONFIG_DIR"
[[ ! -e "$RECOVERY_FILE" ]] || { echo "Refusing to overwrite ${RECOVERY_FILE}" >&2; exit 1; }
REMOTE_LIST="$(rclone --config "$CONFIG_FILE" listremotes 2>/dev/null || true)"
DRIVE_EXISTS=0
CRYPT_EXISTS=0
grep -qx "${DRIVE_REMOTE}:" <<<"$REMOTE_LIST" && DRIVE_EXISTS=1 || true
grep -qx "${CRYPT_REMOTE}:" <<<"$REMOTE_LIST" && CRYPT_EXISTS=1 || true
(( CRYPT_EXISTS == 0 )) || { echo "The crypt remote already exists; refusing to replace it." >&2; exit 1; }

DRIVE_PASSWORD="$(openssl rand -hex 32)"
DRIVE_SALT="$(openssl rand -hex 32)"
OBSCURED_PASSWORD="$(rclone obscure "$DRIVE_PASSWORD")"
OBSCURED_SALT="$(rclone obscure "$DRIVE_SALT")"

if (( DRIVE_EXISTS == 0 )); then
  rclone --config "$CONFIG_FILE" config create "$DRIVE_REMOTE" drive \
    scope drive.file config_is_local false >/dev/null
fi
rclone --config "$CONFIG_FILE" config create "$CRYPT_REMOTE" crypt \
  "remote=${DRIVE_REMOTE}:${DRIVE_FOLDER}" \
  filename_encryption standard \
  directory_name_encryption true \
  "password=${OBSCURED_PASSWORD}" "password2=${OBSCURED_SALT}" \
  --no-obscure >/dev/null

{
  printf 'Keep this file in an offline password manager or other storage independent of this VM and Google Drive.\n'
  printf 'Without both secrets, encrypted backup contents cannot be recovered.\n\n'
  printf 'Google Drive folder: %s\n' "$DRIVE_FOLDER"
  printf 'rclone crypt remote: %s\n\n' "$CRYPT_REMOTE"
  printf 'crypt password: %s\n' "$DRIVE_PASSWORD"
  printf 'crypt password salt: %s\n' "$DRIVE_SALT"
} > "$RECOVERY_FILE"
chmod 600 "$CONFIG_FILE" "$RECOVERY_FILE"

echo "Drive and encrypted remotes created in ${CONFIG_FILE}."
echo "Recovery secrets stored in ${RECOVERY_FILE} (root-only)."
echo "Complete Google authorization with: rclone --config ${CONFIG_FILE} config update ${DRIVE_REMOTE} config_is_local true"
echo "Then run: rclone --config ${CONFIG_FILE} config reconnect ${DRIVE_REMOTE}:"
