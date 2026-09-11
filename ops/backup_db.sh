#!/usr/bin/env bash
set -euo pipefail

# Logical backup of a TRACE Postgres database.
#
# Mirrors the established pattern on this VPS (/srv/cricintel-prod/ops/backup_db.sh):
# pg_dump custom format (-Fc, compressed, selective restore), validated with
# `pg_restore --list` before being kept, timestamped, with age-based retention.
#
# Usage:
#   ops/backup_db.sh [compose-dir]        # default: the repo this script lives in
#
# Examples:
#   ops/backup_db.sh /opt/TRACE
#   ops/backup_db.sh /opt/TRACE-staging
#
# Cron (as root):
#   0 2 * * * cd /opt/TRACE && ./ops/backup_db.sh >> /var/log/trace-backup.log 2>&1
#
# Restore with ops/restore_db.sh — read its header before you need it in anger.
#
# STALENESS ALERTING (audit D-06, 9 Sept 2026)
# Set TRACE_BACKUP_PUSH_URL to an uptime-kuma push-monitor URL
# (Add Monitor -> Push -> copy its URL) and this script pings it with
# status=up on every successful backup. Configure that monitor's expected
# heartbeat interval to ~26h with a couple of retries: uptime-kuma then
# flags DOWN on its own the first time a nightly backup is missed or fails
# — the dead-man's-switch pattern. Unset (the default), this is a silent
# no-op; a two-month API outage went unnoticed for exactly this reason, so
# leaving it unwired defeats the point of this fix.

COMPOSE_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="${TRACE_BACKUP_DIR:-/srv/backups/trace}"
RETENTION_DAYS="${TRACE_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"

# Restrict every file/directory this script creates from the moment of
# creation — no window where a dump is briefly world- or group-readable.
# Covers both mkdir below and the pg_dump redirection further down.
umask 077

[[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || {
  echo "No docker-compose.yml in $COMPOSE_DIR" >&2; exit 1
}

# Name backups after the deployment directory so prod and staging never collide.
ENV_NAME="$(basename "$COMPOSE_DIR" | tr '[:upper:]' '[:lower:]')"
BACKUP_DIR="$BACKUP_ROOT/$ENV_NAME"
mkdir -p "$BACKUP_DIR"

# DB name/user come from the deployment's own .env, falling back to the compose defaults.
DB_NAME="$(grep -E '^POSTGRES_DB=' "$COMPOSE_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
DB_USER="$(grep -E '^POSTGRES_USER=' "$COMPOSE_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
DB_NAME="${DB_NAME:-trace}"
DB_USER="${DB_USER:-trace}"

BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"

echo "==> Backing up $ENV_NAME ($DB_NAME) at $(date)"

# Best-effort push to the configured uptime-kuma monitor. Never lets a
# monitoring hiccup fail the backup job itself — curl errors are swallowed.
push_status() {
  local status="$1" msg="$2"
  [[ -n "${TRACE_BACKUP_PUSH_URL:-}" ]] || return 0
  curl -fsS -m 10 "${TRACE_BACKUP_PUSH_URL}&status=${status}&msg=$(printf '%s' "$msg" | sed 's/ /%20/g')" \
    > /dev/null 2>&1 || echo "WARNING: push to TRACE_BACKUP_PUSH_URL failed (backup itself is unaffected)" >&2
}

cd "$COMPOSE_DIR"
if docker compose exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_FILE"; then
  if pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
    echo "    OK  $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    echo "ERROR: dump did not validate — removing $BACKUP_FILE" >&2
    rm -f "$BACKUP_FILE"
    push_status down "validation-failed-$ENV_NAME"
    exit 1
  fi
else
  echo "ERROR: pg_dump failed for $DB_NAME" >&2
  rm -f "$BACKUP_FILE"
  push_status down "pg_dump-failed-$ENV_NAME"
  exit 1
fi

echo "==> Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -type f -name '*.dump' -mtime "+${RETENTION_DAYS}" -print -delete

push_status up "ok-$ENV_NAME"
echo "Done at $(date)"
