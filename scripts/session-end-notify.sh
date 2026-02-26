#!/bin/bash
# Session End Notification - delays 60s then sends Telegram push
# Receives SessionEnd JSON on stdin from Claude Code hook
# Runs detached so Claude Code process can exit immediately

INPUT=$(cat)
REASON=$(echo "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("reason","unknown"))' 2>/dev/null || echo 'unknown')

# Dedup: skip if notified within 30s
DEDUP_FILE="/tmp/session-end-notify-last"
NOW=$(date +%s)
if [ -f "$DEDUP_FILE" ]; then
  LAST_TIME=$(cat "$DEDUP_FILE" 2>/dev/null)
  if [ -n "$LAST_TIME" ] && [ $((NOW - LAST_TIME)) -lt 30 ]; then
    exit 0
  fi
fi
echo "$NOW" > "$DEDUP_FILE"


# Detach completely: nohup + background + redirect
nohup bash -c '
sleep 60
source ~/claude-telegram-bot/.env 2>/dev/null
MSG="🤖 Claude Code session ended (reason: '"$REASON"')"
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"   -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
' &>/dev/null &
disown

exit 0
