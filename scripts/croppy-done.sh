#!/bin/bash
# croppy-done.sh - JARVIS v2: Stop hook -> Telegram direct notify
# Jarvis経由しない。Claude Code終了時に直接Telegram APIを叩く。
source ~/claude-telegram-bot/.env 2>/dev/null

LAST_COMMIT=$(cd ~/claude-telegram-bot && git log --oneline -1 2>/dev/null || echo "no commits")
# Dedup: skip if same commit notified within 30s
DEDUP_FILE="/tmp/croppy-done-last"
if [ -f "$DEDUP_FILE" ]; then
  LAST_HASH=$(head -1 "$DEDUP_FILE" 2>/dev/null)
  LAST_TIME=$(tail -1 "$DEDUP_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [ "$LAST_HASH" = "$LAST_COMMIT" ] && [ -n "$LAST_TIME" ] && [ $((NOW - LAST_TIME)) -lt 30 ]; then
    exit 0
  fi
fi
echo "$LAST_COMMIT" > "$DEDUP_FILE"
date +%s >> "$DEDUP_FILE"

BRANCH=$(cd ~/claude-telegram-bot && git branch --show-current 2>/dev/null || echo "unknown")
CHANGED=$(cd ~/claude-telegram-bot && git diff --name-only HEAD~1 2>/dev/null | head -5 | tr '\n' ',' || echo "none")
CUSTOM="${1:-}"

if [ -n "$CUSTOM" ]; then
  MSG="🦞 $CUSTOM"
else
  MSG="🦞 Claude Code完了
📌 $LAST_COMMIT
🌿 $BRANCH
📁 ${CHANGED%,}"
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALLOWED_USERS:-}" ]; then
  bash ~/scripts/notify-line.sh "通知"
    -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
fi
rm -f /tmp/autokick-armed
