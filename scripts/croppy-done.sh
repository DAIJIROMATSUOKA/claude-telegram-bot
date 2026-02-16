#!/bin/bash
# croppy-done.sh - JARVIS v2: Stop hook -> Telegram direct notify
# Jarvis経由しない。Claude Code終了時に直接Telegram APIを叩く。
source ~/claude-telegram-bot/.env 2>/dev/null

LAST_COMMIT=$(cd ~/claude-telegram-bot && git log --oneline -1 2>/dev/null || echo "no commits")
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
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
fi
rm -f /tmp/autokick-armed
