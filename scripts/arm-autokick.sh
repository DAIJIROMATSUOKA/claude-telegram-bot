#!/bin/bash
# arm-autokick.sh - ARM watchdog with current Chrome tab URL as target
# Usage: bash ~/claude-telegram-bot/scripts/arm-autokick.sh

TARGET_URL_FILE="/tmp/autokick-target-url"
ARMED_FLAG="/tmp/autokick-armed"

# Get current active Chrome tab URL
CURRENT_URL=$(osascript -e 'tell application "Google Chrome" to get URL of active tab of front window' 2>/dev/null)

if echo "$CURRENT_URL" | grep -q 'claude.ai/chat'; then
  echo "$CURRENT_URL" > "$TARGET_URL_FILE"
  echo "[arm-autokick] Target URL set: $CURRENT_URL"
else
  echo "[arm-autokick] WARNING: Active tab is not claude.ai/chat ($CURRENT_URL)"
  echo "[arm-autokick] Set target manually: echo 'URL' > $TARGET_URL_FILE"
fi

touch "$ARMED_FLAG"
echo "[arm-autokick] ARMED"
