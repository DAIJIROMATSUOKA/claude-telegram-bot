#!/bin/bash
# Universal Telegram notification with 🗑 delete button
# Usage: notify-dj.sh "message" [HTML|Markdown|""]
MSG="${1:-🦞 作業完了}"
PARSE="${2:-}"
source ~/claude-telegram-bot/.env 2>/dev/null

MARKUP='{"inline_keyboard":[[{"text":"🗑","callback_data":"ib:del:sys"}]]}'

ARGS=(-s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"
  -d "chat_id=$TELEGRAM_ALLOWED_USERS"
  --data-urlencode "text=$MSG"
  -d "reply_markup=$MARKUP")

if [ -n "$PARSE" ]; then
  ARGS+=(-d "parse_mode=$PARSE")
fi

curl "${ARGS[@]}" > /dev/null 2>&1
