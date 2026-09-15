#!/usr/bin/env bash
set -euo pipefail

# Restore a TRACE PostgreSQL custom-format dump.
# THIS OVERWRITES THE TARGET DATABASE. The mandatory safety directory receives
# a validated dump of the current state before the first destructive command.
#
# Usage:
#   ops/restore_db.sh <dump-file> <compose-file> <env-file> <safety-dir> --yes

DUMP_FILE="${1:-}"
COMPOSE_FILE="${2:-}"
ENV_FILE="${3:-}"
SAFETY_DIR="${4:-}"
CONFIRMED="${5:-}"

usage() {
  echo "Usage: $0 <dump-file> <compose-file> <env-file> <safety-dir> --yes" >&2
  exit 1
}

[[ -n "$DUMP_FILE" && -n "$COMPOSE_FILE" && -n "$ENV_FILE" && -n "$SAFETY_DIR" ]] || usage
[[ -f "$DUMP_FILE" ]] || { echo "No such dump: $DUMP_FILE" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "No such Compose file: $COMPOSE_FILE" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "No such environment file: $ENV_FILE" >&2; exit 1; }
[[ "$CONFIRMED" == "--yes" ]] || { echo "Refusing to restore without --yes" >&2; exit 1; }

read_env() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
  [[ -n "$value" ]] || { echo "Missing $key in $ENV_FILE" >&2; exit 1; }
  printf '%s' "$value"
}

DB_NAME="$(read_env TRACE_POSTGRES_DB)"
DB_USER="$(read_env TRACE_POSTGRES_USER)"
SAFETY_FILE="$SAFETY_DIR/${DB_NAME}_pre_restore_$(date -u +"%Y%m%dT%H%M%SZ").dump"

umask 077
mkdir -p "$SAFETY_DIR"
pg_restore --list "$DUMP_FILE" >/dev/null || { echo "Source dump is invalid" >&2; exit 1; }

echo "Target database: $DB_NAME (user $DB_USER)"
echo "Compose file: $COMPOSE_FILE"
echo "Source dump: $DUMP_FILE"

echo "Creating pre-restore safety backup"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$SAFETY_FILE"
pg_restore --list "$SAFETY_FILE" >/dev/null || {
  echo "Safety backup validation failed; restore aborted before any write" >&2
  exit 1
}
echo "Validated safety backup: $SAFETY_FILE"

echo "Restoring database"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
    --no-owner --no-privileges <"$DUMP_FILE"

echo "Restore complete. Run the operations-image migration and verification commands before routing traffic."
