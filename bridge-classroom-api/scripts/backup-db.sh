#!/bin/bash
# Nightly backup of the Bridge Classroom SQLite database.
#
# Writes a timestamped daily snapshot locally and to Google Drive, then
# promotes it into longer-lived tiers (grandfather-father-son retention):
#
#   daily     - kept 14 (≈ two weeks)
#   monthly   - kept 3  (this month + previous 2)
#   quarterly - kept 4  (a rolling year)
#   annual    - kept forever
#
# A tier is populated on the *first* backup run of each period ("promote if
# the period isn't represented yet"), so a missed night never skips a tier.
# Each snapshot is an independent full copy — restoring is just picking a file.

DB_PATH="/Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api/data/bridge_classroom.db"
LOCAL_BACKUP_DIR="/Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api/data"
GDRIVE_BACKUP_DIR="/Users/rick/Library/CloudStorage/GoogleDrive-rick.wilson.ca@gmail.com/My Drive/Bridge Classroom/Backups"

DATE=$(date +%Y%m%d)
BACKUP_NAME="bridge_classroom_backup_${DATE}.db"

# Period keys for the longer-lived tiers. macOS `date` has no `%-m`, so strip
# the leading zero arithmetically (10# forces base-10 so "08"/"09" don't read
# as invalid octal).
YEAR=$(date +%Y)
MONTH_KEY=$(date +%Y%m)
MM=$((10#$(date +%m)))
QUARTER_KEY="${YEAR}Q$(( (MM - 1) / 3 + 1 ))"

# --- Daily snapshot (SQLite .backup handles WAL correctly) ------------------
sqlite3 "$DB_PATH" ".backup '${LOCAL_BACKUP_DIR}/${BACKUP_NAME}'"
if [ $? -ne 0 ]; then
  echo "ERROR: SQLite backup failed" >&2
  exit 1
fi

mkdir -p "$GDRIVE_BACKUP_DIR"
cp "${LOCAL_BACKUP_DIR}/${BACKUP_NAME}" "$GDRIVE_BACKUP_DIR/"
if [ $? -ne 0 ]; then
  echo "ERROR: Google Drive copy failed" >&2
  exit 1
fi

# Keep only the N most recent files matching the backup glob in a directory.
# keep=0 means retain everything (used for the annual tier).
prune_tier() {
  local dir="$1" keep="$2"
  [ "$keep" -gt 0 ] || return 0
  ls -t "${dir}"/bridge_classroom_backup_*.db 2>/dev/null | tail -n +$((keep + 1)) | xargs rm -f 2>/dev/null
}

# Copy today's snapshot into a tier iff that period isn't represented yet,
# then prune the tier. Runs for both local and Google Drive roots.
promote_tier() {
  local root="$1" subdir="$2" period_key="$3" keep="$4"
  local dir="${root}/${subdir}"
  local name="bridge_classroom_backup_${period_key}.db"
  mkdir -p "$dir"
  if [ ! -f "${dir}/${name}" ]; then
    cp "${LOCAL_BACKUP_DIR}/${BACKUP_NAME}" "${dir}/${name}"
  fi
  prune_tier "$dir" "$keep"
}

# --- Prune dailies, then promote longer-lived tiers -------------------------
prune_tier "$LOCAL_BACKUP_DIR" 14
prune_tier "$GDRIVE_BACKUP_DIR" 14

for root in "$LOCAL_BACKUP_DIR" "$GDRIVE_BACKUP_DIR"; do
  promote_tier "$root" "backups/monthly"   "$MONTH_KEY"   3
  promote_tier "$root" "backups/quarterly" "$QUARTER_KEY" 4
  promote_tier "$root" "backups/annual"    "$YEAR"        0
done

echo "Backup complete: ${BACKUP_NAME} ($(du -h "${LOCAL_BACKUP_DIR}/${BACKUP_NAME}" | cut -f1)) — tiers: monthly=${MONTH_KEY} quarterly=${QUARTER_KEY} annual=${YEAR}"
