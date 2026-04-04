#!/bin/bash
# restart-bot.sh — Clean bot restart (handles LaunchAgent conflict)
cd ~/claude-telegram-bot || exit 1

PLIST="$HOME/Library/LaunchAgents/com.jarvis.telegram-bot.plist"
LOG="/tmp/jarvis-bot.log"

echo "[restart] Stopping LaunchAgent..."
launchctl unload "$PLIST" 2>/dev/null
sleep 1

echo "[restart] Killing all bun processes..."
pkill -9 -f 'bun.*index.ts' 2>/dev/null
sleep 2

# Verify all dead
if pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
  echo "[restart] ERROR: process still alive after kill"
  exit 1
fi

echo "[restart] Starting bot..."
nohup bun --env-file=.env run src/index.ts > "$LOG" 2>&1 &
BOT_PID=$!
sleep 5

# Check if started successfully
if ! pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
  echo "[restart] ERROR: bot failed to start"
  tail -10 "$LOG"
  exit 1
fi

echo "[restart] Re-enabling LaunchAgent (KeepAlive)..."
launchctl load "$PLIST" 2>/dev/null

echo "[restart] OK (PID: $(pgrep -f 'bun.*index.ts' | head -1))"
tail -3 "$LOG"
