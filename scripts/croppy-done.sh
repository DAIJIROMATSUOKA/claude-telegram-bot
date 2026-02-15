#!/bin/bash
# croppy-done.sh - DISARM auto-kick + notify DJ with result
MSG="${1:-🦞 作業完了}"
rm -f /tmp/autokick-armed
source ~/claude-telegram-bot/.env 2>/dev/null
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"   -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
echo 'DISARMED + NOTIFIED'
