#!/bin/bash
# nightshift.sh - Night mode manager for Jarvis->Croppy Bridge
# Location: ~/claude-telegram-bot/scripts/nightshift.sh
#
# Usage:
#   ./nightshift.sh start    # Start night mode (caffeinate + open worker tabs)
#   ./nightshift.sh stop     # Stop night mode (kill caffeinate + optionally close tabs)
#   ./nightshift.sh status   # Show current night mode status

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPT_DIR/croppy-tab-manager.sh"
NOTIFY="$SCRIPT_DIR/notify-dj.sh"
PID_FILE="/tmp/nightshift.pid"
CAFFEINATE_PID_FILE="/tmp/nightshift-caffeinate.pid"
WORKER_CONFIG="/tmp/croppy-workers.json"
LOG="/tmp/nightshift.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

case "$1" in

# ============================================================
# START: Begin night mode
# ============================================================
start)
  # Check if already running
  if [ -f "$CAFFEINATE_PID_FILE" ] && kill -0 "$(cat "$CAFFEINATE_PID_FILE")" 2>/dev/null; then
    log "Night mode already running (caffeinate PID=$(cat "$CAFFEINATE_PID_FILE"))"
    exit 0
  fi

  log "=== NIGHT MODE START ==="

  # 1. Start caffeinate (prevent system sleep, allow display sleep)
  caffeinate -ims &
  CAFF_PID=$!
  echo "$CAFF_PID" > "$CAFFEINATE_PID_FILE"
  log "caffeinate started (PID=$CAFF_PID) - system sleep disabled"

  # 3. Check if worker tabs exist
  WORKERS=$("$TAB_MANAGER" list 2>/dev/null)
  WORKER_COUNT=$(echo "$WORKERS" | grep -c "\[J-WORKER" 2>/dev/null || echo 0)

  if [ "$WORKER_COUNT" -lt 1 ]; then
    log "No worker tabs found. Checking config..."

    if [ -f "$WORKER_CONFIG" ]; then
      log "Recovering workers from config..."
      "$TAB_MANAGER" recover
    else
      log "WARNING: No worker config at $WORKER_CONFIG"
      log "Open claude.ai tabs manually and mark them:"
      log "  $TAB_MANAGER mark W:T 1"
      log "  $TAB_MANAGER mark W:T 2"
    fi
  else
    log "Found $WORKER_COUNT worker tab(s)"
  fi

  # 4. Health check
  HEALTH=$("$TAB_MANAGER" health 2>/dev/null)
  log "Worker health: $HEALTH"

  # 5. Notify DJ
  if [ -x "$NOTIFY" ]; then
    "$NOTIFY" "🌙 Night mode started. Workers: $WORKER_COUNT" 2>/dev/null
  fi

  log "Night mode active"
  ;;

# ============================================================
# STOP: End night mode
# ============================================================
stop)
  log "=== NIGHT MODE STOP ==="

  # 1. Kill caffeinate
  if [ -f "$CAFFEINATE_PID_FILE" ]; then
    CAFF_PID=$(cat "$CAFFEINATE_PID_FILE")
    if kill -0 "$CAFF_PID" 2>/dev/null; then
      kill "$CAFF_PID"
      log "caffeinate stopped (PID=$CAFF_PID)"
    fi
    rm -f "$CAFFEINATE_PID_FILE"
  else
    # Kill any lingering caffeinate from us
    pkill -f "caffeinate -ims" 2>/dev/null
    log "caffeinate cleaned up"
  fi

  # 2. Clean PID files
  rm -f "$PID_FILE" "$CAFFEINATE_PID_FILE"

  # 3. Unmark worker tabs (optional - keep them for quick restart)
  # "$TAB_MANAGER" unmark ...

  # 4. Notify DJ
  if [ -x "$NOTIFY" ]; then
    "$NOTIFY" "☀️ Night mode stopped." 2>/dev/null
  fi

  log "Night mode deactivated"
  ;;

# ============================================================
# STATUS: Show current state
# ============================================================
status)
  echo "=== Nightshift Status ==="

  # Caffeinate
  if [ -f "$CAFFEINATE_PID_FILE" ] && kill -0 "$(cat "$CAFFEINATE_PID_FILE")" 2>/dev/null; then
    echo "caffeinate: RUNNING (PID=$(cat "$CAFFEINATE_PID_FILE"))"
  else
    echo "caffeinate: OFF"
  fi

  # Night mode
  if [ -f "$CAFFEINATE_PID_FILE" ] && kill -0 "$(cat "$CAFFEINATE_PID_FILE")" 2>/dev/null; then
    echo "nightshift: ACTIVE"
  else
    echo "nightshift: INACTIVE"
  fi

  # Workers
  echo "--- Workers ---"
  "$TAB_MANAGER" health 2>/dev/null || echo "No workers"

  # Config
  if [ -f "$WORKER_CONFIG" ]; then
    echo "--- Config ---"
    cat "$WORKER_CONFIG"
  else
    echo "config: NOT SET ($WORKER_CONFIG)"
  fi
  ;;

*)
  echo "nightshift.sh - Night mode manager"
  echo ""
  echo "Commands:"
  echo "  start    Start caffeinate + check worker tabs"
  echo "  stop     Stop caffeinate + cleanup"
  echo "  status   Show current state"
  ;;
esac
