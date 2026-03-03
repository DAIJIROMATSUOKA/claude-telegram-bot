#!/bin/bash
MSG="${1:-🦞 作業完了}"
PARSE="${2:-HTML}"
source ~/claude-telegram-bot/.env 2>/dev/null
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"   -d "chat_id=$TELEGRAM_ALLOWED_USERS"   -d "text=$MSG"   -d "parse_mode=$PARSE" > /dev/null 2>&1
