#!/usr/bin/env bash
# Tests for backup_objects.sh: snapshots are hard links (no new disk), leave
# out partly written files, expire after the retention, and refuse what would
# turn into full copies.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BACKUP="$repo_root/ops/backup_objects.sh"
bash -n "$BACKUP"

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

objects="$tmp/objects"
backups="$tmp/backups"
mkdir -p "$objects/passports/catalogue" "$objects/passports/passports/p1" "$objects/.incoming"
echo photo > "$objects/passports/passports/p1/1.jpg"
echo catalogue > "$objects/passports/catalogue/a.jpg"
echo partial > "$objects/.incoming/tmp"

bash "$BACKUP" "$objects" "$backups" >/dev/null
snapshot="$(find "$backups" -mindepth 1 -maxdepth 1 -type d -name 'objects-*' | head -1)"
[[ -n "$snapshot" ]] || fail 'a snapshot must be made'
[[ "$snapshot" != *.partial ]] || fail 'a finished snapshot must not keep the .partial name'

# The same inode: a hard link, not a copy.
[[ "$(stat -c %i "$objects/passports/passports/p1/1.jpg")" == "$(stat -c %i "$snapshot/passports/passports/p1/1.jpg")" ]] \
  || fail 'files must be hard-linked, not copied'
[[ -f "$snapshot/passports/catalogue/a.jpg" ]] || fail 'every stored file must be in the snapshot'
[[ ! -e "$snapshot/.incoming" ]] || fail 'partly written files must be left out'

# A deleted file survives in the snapshot and can be restored.
rm "$objects/passports/passports/p1/1.jpg"
[[ "$(cat "$snapshot/passports/passports/p1/1.jpg")" == photo ]] || fail 'a deleted file must survive in the snapshot'

# Snapshots older than the retention expire; newer ones stay.
old="$backups/objects-20000101T000000Z"
mkdir -p "$old" && touch -d '20 days ago' "$old"
TRACE_BACKUP_RETENTION_DAYS=14 bash "$BACKUP" "$objects" "$backups" >/dev/null
[[ ! -e "$old" ]] || fail 'a snapshot past the retention must be removed'
[[ -d "$snapshot" ]] || fail 'a snapshot within the retention must stay'

# Refusals.
if bash "$BACKUP" "$objects" 2>/dev/null; then fail 'missing arguments must be refused'; fi
if bash "$BACKUP" "$tmp/nope" "$backups" 2>/dev/null; then fail 'a missing objects directory must be refused'; fi
if TRACE_BACKUP_RETENTION_DAYS=x bash "$BACKUP" "$objects" "$backups" 2>/dev/null; then
  fail 'a bad retention must be refused'
fi
# Another filesystem (tmpfs at /dev/shm, when it is one) would make full copies.
if [[ -d /dev/shm && "$(stat -c %d /dev/shm)" != "$(stat -c %d "$tmp")" ]]; then
  other="$(mktemp -d /dev/shm/trace-backup-test.XXXXXX)"
  if bash "$BACKUP" "$objects" "$other" 2>/dev/null; then
    rm -rf -- "$other"
    fail 'a backup directory on another filesystem must be refused'
  fi
  rm -rf -- "$other"
fi

echo "backup-objects tests passed"
