#!/bin/bash
# croppy-start.sh - ARM auto-kick + notify DJ that work started
touch /tmp/autokick-armed
source ~/claude-telegram-bot/.env 2>/dev/null
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"   -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=🦞 作業開始。Auto-Kick armed." > /dev/null 2>&1
echo 'ARMED'
