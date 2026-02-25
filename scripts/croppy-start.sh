#!/bin/bash
# croppy-start.sh - ARM auto-kick (silent)
# --- M1_STATUS_CHECK: skip arm if task is DONE/IDLE ---
M1_STATE="/Users/daijiromatsuokam1/claude-telegram-bot/autonomous/state/M1.md"
if [ -f "$M1_STATE" ]; then
  STATUS=$(head -1 "$M1_STATE" | grep -oE '(DONE|IDLE)')
  if [ -n "$STATUS" ]; then
    echo "SKIP (M1=$STATUS)"
    exit 0
  fi
fi
# --- END M1_STATUS_CHECK ---
touch /tmp/autokick-armed
echo 'ARMED'
