#!/usr/bin/env bash
# health-check.sh — Quick health check for JARVIS infrastructure
set -euo pipefail

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
    # Fallback to pgrep
    BOT_PID=$(pgrep -f "bun.*src/index.ts" || true)
    if [[ -n "$BOT_PID" ]]; then
      echo "Bot PID: $BOT_PID (running, found via pgrep)"
    else
      echo "Bot: NOT RUNNING"
    fi
  fi
else
  BOT_PID=$(pgrep -f "bun.*src/index.ts" || true)
  if [[ -n "$BOT_PID" ]]; then
    echo "Bot PID: $BOT_PID (running, no session file)"
  else
    echo "Bot: NOT RUNNING (no session file)"
  fi
fi

# 2. Poller PID
echo ""
echo "--- Task Poller ---"
POLLER_PID=$(pgrep -f "task-poller" || true)
if [[ -n "$POLLER_PID" ]]; then
  echo "Poller PID: $POLLER_PID (running)"
else
  echo "Poller: NOT RUNNING"
fi

# 3. Disk space
echo ""
echo "--- Disk Space ---"
df -h / | tail -1 | awk '{printf "Used: %s / %s (%s)\n", $3, $2, $5}'

# 4. D1 / Memory Gateway connectivity
echo ""
echo "--- D1 Memory Gateway ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 \
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "Gateway: OK (HTTP $HTTP_CODE)"
elif [[ "$HTTP_CODE" == "000" ]]; then
  echo "Gateway: UNREACHABLE (timeout or DNS failure)"
else
  echo "Gateway: HTTP $HTTP_CODE"
fi

echo ""
echo "=== Done ==="
