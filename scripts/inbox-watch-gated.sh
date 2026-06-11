#!/bin/bash
# inbox-watch-gated.sh [idle_min]
# Idle-gated inbox watcher: surface new inbox items into the CODE session ONLY when
# DJ has been quiet for >= idle_min (default 15). Driven by croppy's ScheduleWakeup
# loop (sentinel INBOX-WATCH-TICK). Idle source = /tmp/croppy-last-dj-ts written by the
# UserPromptSubmit hook (scripts/stamp-dj-input.sh).
#   Emergency stop: touch workspace/.inbox-watch-STOPPED   (resume: rm it)
set -uo pipefail
DIR="$HOME/claude-telegram-bot"
IDLE_MIN=${1:-15}
STAMP="$DIR/workspace/.last-dj-ts"

if [ -f "$DIR/workspace/.inbox-watch-STOPPED" ]; then
  echo "STOPPED: watcher停止中（workspace/.inbox-watch-STOPPED）。再開はrm。"
  exit 0
fi

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ "$last" != "0" ]; then
  idle=$(( (now - last) / 60 ))
  if [ "$idle" -lt "$IDLE_MIN" ]; then
    echo "BUSY: DJ作業中 (idle ${idle}分 < ${IDLE_MIN}分) → inbox表示スキップ"
    exit 0
  fi
fi

bash "$DIR/scripts/inbox-watch-tick.sh"
