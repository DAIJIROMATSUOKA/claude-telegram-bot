#!/usr/bin/env bash
# health-check.sh — Comprehensive health check for JARVIS infrastructure
set -euo pipefail

WARN_DISK_GB=10
WARN_MEM_PCT=85

echo "=== JARVIS Health Check ==="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 1. Bot PID
echo "--- Bot Process ---"
SESSION_FILE="/tmp/claude-telegram-session.json"
if [[ -f "$SESSION_FILE" ]]; then
  BOT_PID=$(python3 -c "import json; print(json.load(open('$SESSION_FILE')).get('pid',''))" 2>/dev/null || true)
  if [[ -n "$BOT_PID" ]] && kill -0 "$BOT_PID" 2>/dev/null; then
    echo "Bot PID: $BOT_PID (running)"
  else
    BOT_PID=$(pgrep -f "bun.*src/index.ts" || true)
    if [[ -n "$BOT_PID" ]]; then
      echo "Bot PID: $BOT_PID (running, found via pgrep)"
    else
      echo "⚠️  Bot: NOT RUNNING"
    fi
  fi
else
  BOT_PID=$(pgrep -f "bun.*src/index.ts" || true)
  if [[ -n "$BOT_PID" ]]; then
    echo "Bot PID: $BOT_PID (running, no session file)"
  else
    echo "⚠️  Bot: NOT RUNNING (no session file)"
  fi
fi

# 2. Poller PID
echo ""
echo "--- Task Poller ---"
POLLER_PID=$(pgrep -f "task-poller" || true)
if [[ -n "$POLLER_PID" ]]; then
  echo "Poller PID: $POLLER_PID (running)"
else
  echo "⚠️  Poller: NOT RUNNING"
fi

# 3. Disk space with threshold warning
echo ""
echo "--- Disk Space ---"
DISK_INFO=$(df -h / | tail -1)
echo "$DISK_INFO" | awk '{printf "Used: %s / %s (%s)\n", $3, $2, $5}'
AVAIL_GB=$(df -g / | tail -1 | awk '{print $4}')
if [[ "$AVAIL_GB" -lt "$WARN_DISK_GB" ]]; then
  echo "⚠️  WARNING: Only ${AVAIL_GB}GB free (threshold: ${WARN_DISK_GB}GB)"
fi

# 4. Memory usage
echo ""
echo "--- Memory ---"
MEM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
MEM_TOTAL_GB=$((MEM_TOTAL / 1073741824))
MEM_PRESSURE=$(memory_pressure 2>/dev/null | grep "System-wide" | head -1 || echo "unknown")
echo "Total RAM: ${MEM_TOTAL_GB}GB"
echo "Pressure: $MEM_PRESSURE"
# Check vm_stat for page stats
VM_STAT=$(vm_stat 2>/dev/null || true)
if [[ -n "$VM_STAT" ]]; then
  PAGES_FREE=$(echo "$VM_STAT" | grep "Pages free" | awk '{print $3}' | tr -d '.')
  PAGES_ACTIVE=$(echo "$VM_STAT" | grep "Pages active" | awk '{print $3}' | tr -d '.')
  if [[ -n "$PAGES_FREE" ]] && [[ -n "$PAGES_ACTIVE" ]]; then
    TOTAL_PAGES=$((PAGES_FREE + PAGES_ACTIVE))
    if [[ $TOTAL_PAGES -gt 0 ]]; then
      USED_PCT=$((PAGES_ACTIVE * 100 / TOTAL_PAGES))
      echo "Active memory: ~${USED_PCT}%"
      if [[ $USED_PCT -gt $WARN_MEM_PCT ]]; then
        echo "⚠️  WARNING: Memory usage high (${USED_PCT}% > ${WARN_MEM_PCT}%)"
      fi
    fi
  fi
fi

# 5. Zombie processes
echo ""
echo "--- Zombie Processes ---"
ZOMBIES=$(ps aux | awk '$8 ~ /Z/ {print $2, $11}' || true)
if [[ -n "$ZOMBIES" ]]; then
  echo "⚠️  Zombies found:"
  echo "$ZOMBIES"
else
  echo "None"
fi

# 6. LaunchAgent status for all JARVIS agents
echo ""
echo "--- LaunchAgents ---"
AGENTS=(
  "com.claude-telegram-ts"
  "com.jarvis.task-poller"
  "com.jarvis.autokick-watchdog"
  "com.jarvis.nightly"
  "com.jarvis.morning-briefing"
)
for AGENT in "${AGENTS[@]}"; do
  PLIST="$HOME/Library/LaunchAgents/${AGENT}.plist"
  if [[ -f "$PLIST" ]]; then
    # Check if loaded
    if launchctl list 2>/dev/null | grep -q "$AGENT"; then
      PID=$(launchctl list 2>/dev/null | grep "$AGENT" | awk '{print $1}')
      if [[ "$PID" == "-" ]] || [[ -z "$PID" ]]; then
        echo "⚪ $AGENT: loaded (not running)"
      else
        echo "🟢 $AGENT: running (PID $PID)"
      fi
    else
      echo "⚠️  $AGENT: not loaded"
    fi
  else
    echo "— $AGENT: plist not found"
  fi
done

# 7. D1 / Memory Gateway connectivity
echo ""
echo "--- D1 Memory Gateway ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 \
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "Gateway: OK (HTTP $HTTP_CODE)"
elif [[ "$HTTP_CODE" == "000" ]]; then
  echo "⚠️  Gateway: UNREACHABLE (timeout or DNS failure)"
else
  echo "⚠️  Gateway: HTTP $HTTP_CODE"
fi

# 8. Stale lock files
echo ""
echo "--- Lock Files ---"
LOCK_FILES=(
  "/tmp/batch-runner.lock"
  "/tmp/croppy-stop"
  "/tmp/triage-stop"
  "/tmp/nightly-forge.lock"
)
STALE_FOUND=0
for LF in "${LOCK_FILES[@]}"; do
  if [[ -f "$LF" ]]; then
    AGE_MIN=$(( ($(date +%s) - $(stat -f %m "$LF")) / 60 ))
    if [[ $AGE_MIN -gt 120 ]]; then
      echo "⚠️  STALE: $LF (${AGE_MIN}min old)"
      STALE_FOUND=1
    else
      echo "🔒 $LF (${AGE_MIN}min old)"
    fi
  fi
done
if [[ $STALE_FOUND -eq 0 ]]; then
  echo "No stale locks"
fi

echo ""
echo "=== Done ==="
