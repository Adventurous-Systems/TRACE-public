#!/usr/bin/env bash
set -euo pipefail

# Snapshot a TRACE deployment's stored files (photos and QR codes).
#
# Stored files are write-once (packages/db/src/object-store.ts): a key is never
# overwritten. So a snapshot is a tree of hard links, not copies: it costs no
# disk for files that are still in the store, and only keeps a deleted file's
# space until the last snapshot holding it expires. That is how the backup
# avoids doubling the store on a disk it shares (owner, 2026-10-06).
#
# A snapshot guards against files being deleted or a store being emptied; it
# lives on the same disk, so it does not guard against losing the disk.
#
# Usage:
#   ops/backup_objects.sh <objects-dir> <backup-dir>
#
# Optional process environment:
#   TRACE_BACKUP_RETENTION_DAYS (default: 14, as ops/backup_db.sh)
#   TRACE_BACKUP_PUSH_URL        (dead-man's-switch URL)
#
# Restoring one file: cp -a <backup-dir>/objects-<time>/<bucket>/<key> <objects-dir>/<bucket>/<key>

OBJECTS_DIR="${1:-}"
BACKUP_DIR="${2:-}"
RETENTION_DAYS="${TRACE_BACKUP_RETENTION_DAYS:-14}"

usage() {
  echo "Usage: $0 <objects-dir> <backup-dir>" >&2
  exit 1
}

[[ -n "$OBJECTS_DIR" && -n "$BACKUP_DIR" ]] || usage
[[ -d "$OBJECTS_DIR" ]] || { echo "No such objects directory: $OBJECTS_DIR" >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || {
  echo "TRACE_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
}

push_status() {
  local status="$1" message="$2"
  [[ -n "${TRACE_BACKUP_PUSH_URL:-}" ]] || return 0
  curl --fail --silent --show-error --max-time 10 --get \
    --data-urlencode "status=$status" --data-urlencode "msg=$message" \
    "$TRACE_BACKUP_PUSH_URL" >/dev/null 2>&1 ||
    echo "WARNING: backup monitor notification failed" >&2
}

umask 077
mkdir -p "$BACKUP_DIR"

# Hard links only work within one filesystem; across two, every snapshot would
# be a full copy, which is exactly what this must not do.
if [[ "$(stat -c %d "$OBJECTS_DIR")" != "$(stat -c %d "$BACKUP_DIR")" ]]; then
  echo "Refusing: $BACKUP_DIR is not on the same filesystem as $OBJECTS_DIR" >&2
  push_status down "different-filesystem"
  exit 1
fi

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
SNAPSHOT="$BACKUP_DIR/objects-$TIMESTAMP"
PARTIAL="$SNAPSHOT.partial"
rm -rf -- "$PARTIAL"

echo "Snapshotting $OBJECTS_DIR"
if ! cp -al -- "$OBJECTS_DIR/." "$PARTIAL/"; then
  echo "Snapshot failed; removing the partial snapshot" >&2
  rm -rf -- "$PARTIAL"
  push_status down "snapshot-failed"
  exit 1
fi
# Files still being written live in .incoming; they are not stored files yet.
rm -rf -- "$PARTIAL/.incoming"
mv -- "$PARTIAL" "$SNAPSHOT"
touch -- "$SNAPSHOT"

files="$(find "$SNAPSHOT" -type f | wc -l)"
echo "Snapshot: $SNAPSHOT ($files files, hard-linked)"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'objects-*' -mtime "+$RETENTION_DAYS" \
  -print -exec rm -rf -- {} +
push_status up "snapshot-ok"
