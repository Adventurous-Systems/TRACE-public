#!/usr/bin/env bash
# Tests for write_status.sh: the newest dump and snapshot times, null when
# there is none, the disk numbers, a world-readable file, and nothing else.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WRITE="$repo_root/ops/write_status.sh"
bash -n "$WRITE"

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
field() { python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

db="$tmp/backups/db"
objects="$tmp/backups/objects"
status="$tmp/status/status.json"
mkdir -p "$db" "$objects" "$tmp/status"

# Nothing backed up yet: the times are null, the disk numbers are still there.
umask 077
bash "$WRITE" "$db" "$objects" "$tmp" "$status"
[[ "$(field "$status" lastDbDump)" == None ]] || fail 'no dump must read as null'
[[ "$(field "$status" lastObjectSnapshot)" == None ]] || fail 'no snapshot must read as null'
pct="$(field "$status" diskFreePercent)"
[[ "$pct" =~ ^[0-9]+$ && "$pct" -le 100 ]] || fail "disk free percent must be 0..100, got $pct"
[[ "$(stat -c %a "$status")" == 644 ]] || fail 'the status file must be world-readable whatever the umask'

# The newest of each, by modification time, in UTC.
touch -d '2026-10-19T01:00:00Z' "$db/trace_20261019T010000Z.dump"
touch -d '2026-10-21T01:00:00Z' "$db/trace_20261021T010000Z.dump"
touch -d '2026-10-22T09:00:00Z' "$db/not-a-dump.txt"
mkdir "$objects/objects-20261021T010318Z" "$objects/objects-20261022T010000Z.partial"
touch -d '2026-10-21T01:03:18Z' "$objects/objects-20261021T010318Z"
bash "$WRITE" "$db" "$objects" "$tmp" "$status"
[[ "$(field "$status" lastDbDump)" == 2026-10-21T01:00:00Z ]] || fail 'the newest dump, and only .dump files'
[[ "$(field "$status" lastObjectSnapshot)" == 2026-10-21T01:03:18Z ]] \
  || fail 'the newest finished snapshot (a .partial one is not finished)'
generated="$(field "$status" generatedAt)"
[[ "$generated" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || fail "generatedAt must be ISO UTC, got $generated"

# Times and numbers only: no path or name from the host.
! grep -q "$tmp" "$status" || fail 'the status file must not contain host paths'
[[ "$(python3 -I -c 'import json, sys; print(sorted(json.load(open(sys.argv[1]))))' "$status")" \
  == "['diskFreeBytes', 'diskFreePercent', 'generatedAt', 'lastDbDump', 'lastObjectSnapshot']" ]] \
  || fail 'the status file must hold exactly the documented fields'

# A missing data directory is refused, and the old status file is kept.
cp "$status" "$tmp/before.json"
! bash "$WRITE" "$db" "$objects" "$tmp/missing" "$status" 2>/dev/null || fail 'a missing data dir must fail'
cmp -s "$status" "$tmp/before.json" || fail 'a failed run must leave the previous status file alone'
[[ -z "$(find "$tmp/status" -name 'status.json.*')" ]] || fail 'a failed run must not leave a temporary file'

echo "write-status tests passed"
