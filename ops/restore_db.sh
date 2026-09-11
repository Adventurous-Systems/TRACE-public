#!/usr/bin/env bash
set -euo pipefail

# Restore a TRACE Postgres database from an ops/backup_db.sh dump.
#
# THIS OVERWRITES THE TARGET DATABASE. It drops and recreates every object in
# the dump (`pg_restore --clean --if-exists`). Read the whole header first.
#
# Usage:
#   ops/restore_db.sh <dump-file> <compose-dir> --yes
#
# Example:
#   ops/restore_db.sh /srv/backups/trace/trace/trace_20260901_020000.dump /opt/TRACE --yes
#
# Safety:
#   - Refuses to run without --yes.
#   - Prints the target (directory, container, database) and the dump's own
#     header before doing anything, so a wrong target is obvious.
#   - Takes a fresh safety dump of the CURRENT state first, so a mistaken
#     restore is itself reversible.
#
# After restoring the demo box, re-run the demo verification:
#   docker compose exec -T api pnpm --filter @trace/db demo:verify

DUMP_FILE="${1:-}"
COMPOSE_DIR="${2:-}"
CONFIRMED="${3:-}"

if [[ -z "$DUMP_FILE" || -z "$COMPOSE_DIR" ]]; then
  echo "Usage: $0 <dump-file> <compose-dir> --yes" >&2
  exit 1
fi

[[ -f "$DUMP_FILE" ]] || { echo "No such dump: $DUMP_FILE" >&2; exit 1; }
[[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || {
  echo "No docker-compose.yml in $COMPOSE_DIR" >&2; exit 1
}

DB_NAME="$(grep -E '^POSTGRES_DB=' "$COMPOSE_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
DB_USER="$(grep -E '^POSTGRES_USER=' "$COMPOSE_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
DB_NAME="${DB_NAME:-trace}"
DB_USER="${DB_USER:-trace}"

echo "About to RESTORE — this overwrites data."
echo "  dump      : $DUMP_FILE"
echo "  deployment: $COMPOSE_DIR"
echo "  database  : $DB_NAME (user $DB_USER)"
echo ""
echo "Dump contents (first 5 entries):"
pg_restore --list "$DUMP_FILE" | grep -vE '^;' | head -5 || true
echo ""

if [[ "$CONFIRMED" != "--yes" ]]; then
  echo "Refusing to restore without --yes." >&2
  exit 1
fi

cd "$COMPOSE_DIR"

SAFETY="/tmp/trace-pre-restore-$(date +%Y%m%d_%H%M%S).dump"
echo "==> Safety dump of CURRENT state → $SAFETY"
docker compose exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$SAFETY"
pg_restore --list "$SAFETY" > /dev/null || {
  echo "ERROR: could not validate the safety dump — aborting before any write." >&2
  exit 1
}
echo "    OK ($(du -h "$SAFETY" | cut -f1)) — keep this until you are satisfied with the restore"

echo "==> Restoring"
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges < "$DUMP_FILE"

echo "==> Restarting api so it reconnects cleanly"
docker compose restart api

echo "Done. Verify before demoing:"
echo "  docker compose exec -T api pnpm --filter @trace/db demo:verify"
