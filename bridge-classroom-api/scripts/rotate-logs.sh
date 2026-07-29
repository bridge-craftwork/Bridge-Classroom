#!/bin/bash
#
# Rotate the API and tunnel logs. Run nightly by com.bridgeclassroom.logrotate.
#
# WHY THIS EXISTS: nothing pruned these files. The API log reached 322 MB
# spanning 2026-02-05 → 2026-07-29 before rotation was added — six months of
# every request line, including full User-Agents and ~130 distinct email
# addresses that the /api/diagnostics GET path carries in its query string.
# Unbounded logs are a retention problem, not just a disk problem.
#
# WHY copy-and-truncate RATHER THAN move: launchd opens StandardOutPath itself
# and holds the descriptor for the life of the process. Renaming the file would
# leave the API writing happily into the *moved* inode — rotation would appear to
# work while the live log silently stopped growing. Truncating in place keeps the
# descriptor valid (launchd opens O_APPEND, so the next write lands at offset 0).
# The tradeoff is a narrow race: lines written between the copy and the truncate
# are lost. For a debug log that is the right trade; for an audit log it wouldn't be.
set -uo pipefail

# Overridable so the script can be exercised against a scratch directory rather
# than only ever tested in production.
LOG_DIR="${LOG_DIR:-/Users/rick/Library/Logs}"
KEEP_DAYS="${KEEP_DAYS:-14}"                    # matches the daily database-backup tier
MIN_BYTES="${MIN_BYTES:-$((1024 * 1024))}"      # skip files under 1 MB — don't litter tiny archives

LOGS=(
  "bridge-classroom-api.log"
  "cloudflared-tunnel.log"
)

STAMP=$(date +%Y%m%d)

for name in "${LOGS[@]}"; do
  log="${LOG_DIR}/${name}"
  [ -f "$log" ] || { echo "skip ${name}: not present"; continue; }

  size=$(stat -f%z "$log" 2>/dev/null || echo 0)
  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "skip ${name}: ${size} bytes, under threshold"
    continue
  fi

  archive="${log}.${STAMP}.gz"
  # If today's archive already exists (a second run in one day), append a counter
  # rather than clobbering the earlier one.
  if [ -e "$archive" ]; then
    n=2
    while [ -e "${log}.${STAMP}.${n}.gz" ]; do n=$((n + 1)); done
    archive="${log}.${STAMP}.${n}.gz"
  fi

  if ! gzip -c "$log" > "$archive"; then
    echo "ERROR ${name}: gzip failed, leaving log intact" >&2
    rm -f "$archive"
    continue
  fi

  # Only truncate once the archive is verifiably readable — never lose the log to
  # a half-written archive.
  if ! gzip -t "$archive" 2>/dev/null; then
    echo "ERROR ${name}: archive failed integrity check, leaving log intact" >&2
    rm -f "$archive"
    continue
  fi

  : > "$log"
  echo "rotated ${name}: ${size} bytes → $(basename "$archive") ($(stat -f%z "$archive") bytes)"
done

# Prune archives past the retention window.
pruned=$(find "$LOG_DIR" -maxdepth 1 -name "*.log.*.gz" -mtime +"${KEEP_DAYS}" -print -delete | wc -l | tr -d ' ')
echo "pruned ${pruned} archive(s) older than ${KEEP_DAYS} days"
