#!/bin/bash
# poller-watchdog.sh - Cron job to ensure task-poller stays alive
# Install: crontab -e -> */1 * * * * /Users/daijiromatsuokam1/claude-telegram-bot/scripts/poller-watchdog.sh

HEARTBEAT="/tmp/poller-heartbeat"
PLIST="$HOME/Library/LaunchAgents/com.jarvis.task-poller.plist"
LABEL="com.jarvis.task-poller"
LOG="/tmp/poller-watchdog.log"
MAX_AGE=60  # seconds - poller polls every 3s, so 60s = very generous

needs_restart=0

# Check 1: heartbeat file freshness
if [ ! -f "$HEARTBEAT" ]; then
  needs_restart=1
  echo "[$(date '+%H:%M:%S')] No heartbeat file" >> "$LOG"
else
  AGE=$(( $(date +%s) - $(stat -f %m "$HEARTBEAT") ))
  if [ "$AGE" -gt "$MAX_AGE" ]; then
    needs_restart=1
    echo "[$(date '+%H:%M:%S')] Heartbeat stale (${AGE}s old)" >> "$LOG"
  fi
fi

# Check 2: process existence (belt + suspenders)
if ! pgrep -f "task-poller.ts" > /dev/null 2>&1; then
  needs_restart=1
  echo "[$(date '+%H:%M:%S')] No poller process found" >> "$LOG"
fi

if [ "$needs_restart" -eq 1 ]; then
  echo "[$(date '+%H:%M:%S')] Restarting poller..." >> "$LOG"
  
  # Ensure plist is loaded (covers unload case)
  launchctl load "$PLIST" 2>/dev/null
  
  # Kill any zombie and restart
  launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl start "$LABEL" 2>/dev/null
  
  sleep 3
  
  if pgrep -f "task-poller.ts" > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] Poller restarted OK" >> "$LOG"
    MSG="Poller auto-restart OK"
  else
    echo "[$(date '+%H:%M:%S')] Poller restart FAILED" >> "$LOG"
    MSG="Poller auto-restart FAILED"
  fi
  
  # Telegram notification
  source ~/claude-telegram-bot/.env 2>/dev/null
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"     -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1
fi

# Keep log small (last 100 lines)
if [ -f "$LOG" ] && [ $(wc -l < "$LOG") -gt 200 ]; then
  tail -100 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
