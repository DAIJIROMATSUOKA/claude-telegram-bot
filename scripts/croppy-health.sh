#!/bin/bash
# croppy-health.sh - Periodic health check for Croppy worker tabs
# Location: ~/claude-telegram-bot/scripts/croppy-health.sh
# Run via LaunchAgent com.jarvis.croppy-health (every 60s when nightshift active)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPT_DIR/croppy-tab-manager.sh"
NOTIFY="$SCRIPT_DIR/notify-dj.sh"
CAFFEINATE_PID="/tmp/nightshift-caffeinate.pid"
HEALTH_LOG="/tmp/croppy-health.log"
LAST_ALERT="/tmp/croppy-health-last-alert"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$HEALTH_LOG"; }

# Only run during night mode (caffeinate active = nightshift on)
if [ ! -f "$CAFFEINATE_PID" ] || ! kill -0 "$(cat "$CAFFEINATE_PID")" 2>/dev/null; then
  exit 0
fi

# Check Chrome is running
if ! pgrep -x "Google Chrome" > /dev/null 2>&1; then
  log "ALERT: Chrome not running"
  
  # Debounce alerts (max 1 per 10 min)
  if [ -f "$LAST_ALERT" ]; then
    LAST=$(cat "$LAST_ALERT")
    NOW=$(date +%s)
    DIFF=$((NOW - LAST))
    if [ "$DIFF" -lt 600 ]; then
      exit 0
    fi
  fi
  
  date +%s > "$LAST_ALERT"
  "$NOTIFY" "🔴 Chrome not running! Worker tabs lost." 2>/dev/null
  exit 1
fi

# Check worker tab health
HEALTH=$("$TAB_MANAGER" health 2>/dev/null)

if echo "$HEALTH" | grep -q "NO_WORKERS"; then
  log "ALERT: No worker tabs"
  
  # Debounce
  if [ -f "$LAST_ALERT" ]; then
    LAST=$(cat "$LAST_ALERT")
    NOW=$(date +%s)
    if [ $((NOW - LAST)) -lt 600 ]; then
      exit 0
    fi
  fi
  
  date +%s > "$LAST_ALERT"
  
  # Try to recover
  log "Attempting recovery..."
  RECOVER_RESULT=$("$TAB_MANAGER" recover 2>&1)
  log "Recovery result: $RECOVER_RESULT"
  
  if echo "$RECOVER_RESULT" | grep -q "RESTORED"; then
    "$NOTIFY" "🔧 Worker tabs auto-recovered" 2>/dev/null
  else
    "$NOTIFY" "🔴 Worker tabs missing! Auto-recovery failed." 2>/dev/null
  fi
  exit 1
fi

# Check for ERROR status
if echo "$HEALTH" | grep -q "ERROR"; then
  log "WARNING: Some workers in ERROR state"
  log "$HEALTH"
fi

# Normal - just log
log "OK: $HEALTH"
