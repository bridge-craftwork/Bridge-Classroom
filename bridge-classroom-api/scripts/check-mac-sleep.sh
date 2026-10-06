#!/bin/bash
# check-mac-sleep.sh — the API's Mac must never system-sleep. Run daily by
# com.bridgeclassroom.sleepcheck; notifies (Pushover, via ~/bin/notify) if:
#
#   1. the Mac slept since the last check (power log "Entering Sleep state"),
#   2. the mains-power sleep setting is no longer 0 (`pmset -c sleep 0`), or
#   3. the keep-awake backup (com.bridgeclassroom.keepawake, caffeinate) isn't running.
#
# Why: every system sleep drops this Mac's network, so the Cloudflare Tunnel to
# the API goes down (Error 1033) and the app shows empty lobbies. On 2026-10-05
# that happened ~95 times a day, silently, for two days: the setting had been
# "sleep after 1 minute" since January, and the Mac had only stayed awake
# because a Windows VM in Parallels held an audio stream open. Moving the VM to
# the Express2T drive stopped it. This check turns a recurrence into a next-day
# alert instead of a classroom surprise.
#
# Deliberately NOT `set -e`: a failing probe must still lead to a report.
#
# Usage: check-mac-sleep.sh [--dry-run]   (--dry-run prints instead of notifying)

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

LOG_FILE="$HOME/Library/Logs/bridge-classroom-sleepcheck.log"
STATE_FILE="$HOME/Library/Application Support/bridge-classroom/sleepcheck-last-run"
NOTIFY="$HOME/bin/notify"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"; }

mkdir -p "$(dirname "$STATE_FILE")"
now_epoch=$(date +%s)
# Look back to the previous run, or 24h on the first run.
since_epoch=$(cat "$STATE_FILE" 2>/dev/null || echo $((now_epoch - 86400)))
since_text=$(date -r "$since_epoch" '+%Y-%m-%d %H:%M:%S')

problems=()

# 1. Sleeps since the last run. pmset's log lines start "YYYY-MM-DD HH:MM:SS -0700".
sleeps=$(pmset -g log 2>/dev/null | python3 -c '
import sys, datetime
since = datetime.datetime.fromtimestamp(int(sys.argv[1]))
times = []
for line in sys.stdin:
    if "Entering Sleep state" not in line:
        continue
    try:
        t = datetime.datetime.strptime(line[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        continue
    if t >= since:
        times.append(t)
first = times[0].strftime("%m-%d %H:%M") if times else ""
print(len(times), first)
' "$since_epoch")
sleep_count=${sleeps%% *}
first_sleep=${sleeps#* }
if [ "${sleep_count:-0}" -gt 0 ] 2>/dev/null; then
    problems+=("Slept $sleep_count time(s) since $since_text (first at $first_sleep). The API was offline during each sleep.")
fi

# 2. The mains-power setting.
ac_sleep=$(pmset -g custom 2>/dev/null | awk '/^AC Power:/{ac=1; next} /^[A-Za-z]/{ac=0} ac && $1=="sleep"{print $2; exit}')
if [ "$ac_sleep" != "0" ]; then
    problems+=("Mains-power system sleep is set to '${ac_sleep:-unknown}' (should be 0). Fix: sudo pmset -c sleep 0")
fi

# 3. The keep-awake backup.
if ! launchctl list com.bridgeclassroom.keepawake 2>/dev/null | grep -q '"PID" = [0-9]'; then
    problems+=("Keep-awake backup (com.bridgeclassroom.keepawake) is not running. Fix: launchctl kickstart gui/\$(id -u)/com.bridgeclassroom.keepawake")
fi

echo "$now_epoch" > "$STATE_FILE"

if [ ${#problems[@]} -eq 0 ]; then
    log "OK: no sleep since $since_text; sleep setting 0; keep-awake running"
    [ $DRY_RUN -eq 1 ] && echo "OK: no sleep since $since_text; sleep setting 0; keep-awake running"
    exit 0
fi

message="Bridge Classroom server Mac:"
for p in "${problems[@]}"; do message="$message"$'\n'"• $p"; done
log "ALERT: ${problems[*]}"
if [ $DRY_RUN -eq 1 ]; then
    echo "$message"
else
    "$NOTIFY" "$message" || log "notify failed"
fi
