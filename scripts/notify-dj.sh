#!/bin/bash
# notify-dj.sh - Send Telegram notification to DJ
# Usage: notify-dj.sh "message"
MSG="${1:-🦞 作業完了}"
source ~/claude-telegram-bot/.env 2>/dev/null
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"     -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
  echo 'NOTIFIED'
else
  echo 'NO_TOKEN'
fi
