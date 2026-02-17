#!/bin/bash
# Session End Notification - delays 60s then sends Telegram push
# Receives SessionEnd JSON on stdin from Claude Code hook
# Runs detached so Claude Code process can exit immediately

INPUT=$(cat)
REASON=$(echo "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("reason","unknown"))' 2>/dev/null || echo 'unknown')

# Detach completely: nohup + background + redirect
nohup bash -c '
sleep 60
source ~/claude-telegram-bot/.env 2>/dev/null
MSG="🤖 Claude Code session ended (reason: '"$REASON"')"
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"   -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
' &>/dev/null &
disown

exit 0
