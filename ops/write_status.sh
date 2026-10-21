#!/usr/bin/env bash
set -euo pipefail

# Write a small, world-readable status file about a TRACE deployment's backups
# and disk space, for a check that runs without privileges
# (.github/workflows/health-watch.yml reads it on the demo host's runner).
# It holds times and numbers only: no paths, names or secrets.
#
# Usage:
#   ops/write_status.sh <db-backup-dir> <objects-backup-dir> <data-dir> <status-file>
#
# Fields: generatedAt, lastDbDump and lastObjectSnapshot (ISO 8601 UTC, or
# null when there is none), diskFreePercent and diskFreeBytes (the filesystem
# holding <data-dir>).

DB_DIR="${1:-}"
OBJECTS_DIR="${2:-}"
DATA_DIR="${3:-}"
STATUS_FILE="${4:-}"

usage() {
  echo "Usage: $0 <db-backup-dir> <objects-backup-dir> <data-dir> <status-file>" >&2
  exit 1
}

[[ -n "$DB_DIR" && -n "$OBJECTS_DIR" && -n "$DATA_DIR" && -n "$STATUS_FILE" ]] || usage
[[ -d "$DATA_DIR" ]] || { echo "No such data directory: $DATA_DIR" >&2; exit 1; }

# The newest finished entry matching a pattern, as a quoted ISO time, or null.
# backup_objects.sh builds a snapshot under a .partial name and renames it.
newest() {
  local dir="$1" pattern="$2" epoch
  epoch="$(find "$dir" -maxdepth 1 -name "$pattern" ! -name '*.partial' -printf '%T@\n' 2>/dev/null \
    | sort -n | tail -n 1)"
  if [[ -n "$epoch" ]]; then
    printf '"%s"' "$(date -u -d "@${epoch%.*}" +%Y-%m-%dT%H:%M:%SZ)"
  else
    printf 'null'
  fi
}

read -r size avail < <(df -P -B1 "$DATA_DIR" | awk 'NR == 2 {print $2, $4}')
[[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 && "$avail" =~ ^[0-9]+$ ]] \
  || { echo "Could not read free space for $DATA_DIR" >&2; exit 1; }

tmp="$(mktemp "$STATUS_FILE.XXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
printf '{"generatedAt":"%s","lastDbDump":%s,"lastObjectSnapshot":%s,"diskFreePercent":%d,"diskFreeBytes":%d}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(newest "$DB_DIR" '*.dump')" \
  "$(newest "$OBJECTS_DIR" 'objects-*')" \
  "$((avail * 100 / size))" \
  "$avail" >"$tmp"
chmod 644 "$tmp"
mv -f -- "$tmp" "$STATUS_FILE"
trap - EXIT
