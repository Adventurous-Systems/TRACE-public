#!/usr/bin/env bash
set -euo pipefail

# Create and validate a custom-format PostgreSQL backup for a TRACE deployment.
# The operator supplies every filesystem target explicitly; this script contains
# no assumptions about a maintainer workstation or deployment host.
#
# Usage:
#   ops/backup_db.sh <compose-file> <env-file> <backup-dir>
#
# Required env-file keys:
#   TRACE_POSTGRES_DB, TRACE_POSTGRES_USER
#
# Optional process environment:
#   TRACE_BACKUP_RETENTION_DAYS (default: 14)
#   TRACE_BACKUP_PUSH_URL        (dead-man's-switch URL)

COMPOSE_FILE="${1:-}"
ENV_FILE="${2:-}"
BACKUP_DIR="${3:-}"
RETENTION_DAYS="${TRACE_BACKUP_RETENTION_DAYS:-14}"

usage() {
  echo "Usage: $0 <compose-file> <env-file> <backup-dir>" >&2
  exit 1
}

[[ -n "$COMPOSE_FILE" && -n "$ENV_FILE" && -n "$BACKUP_DIR" ]] || usage
[[ -f "$COMPOSE_FILE" ]] || { echo "No such Compose file: $COMPOSE_FILE" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "No such environment file: $ENV_FILE" >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || {
  echo "TRACE_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
}

read_env() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
  [[ -n "$value" ]] || { echo "Missing $key in $ENV_FILE" >&2; exit 1; }
  printf '%s' "$value"
}

DB_NAME="$(read_env TRACE_POSTGRES_DB)"
DB_USER="$(read_env TRACE_POSTGRES_USER)"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"

umask 077
mkdir -p "$BACKUP_DIR"

push_status() {
  local status="$1" message="$2"
  [[ -n "${TRACE_BACKUP_PUSH_URL:-}" ]] || return 0
  curl --fail --silent --show-error --max-time 10 --get \
    --data-urlencode "status=$status" --data-urlencode "msg=$message" \
    "$TRACE_BACKUP_PUSH_URL" >/dev/null 2>&1 ||
    echo "WARNING: backup monitor notification failed" >&2
}

echo "Creating PostgreSQL backup for $DB_NAME"
if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$BACKUP_FILE"; then
  if pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
    echo "Validated backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    echo "Backup validation failed; removing incomplete dump" >&2
    rm -f -- "$BACKUP_FILE"
    push_status down "validation-failed"
    exit 1
  fi
else
  echo "PostgreSQL backup failed; removing incomplete dump" >&2
  rm -f -- "$BACKUP_FILE"
  push_status down "pg-dump-failed"
  exit 1
fi

find "$BACKUP_DIR" -type f -name '*.dump' -mtime "+$RETENTION_DAYS" -print -delete
push_status up "backup-ok"
