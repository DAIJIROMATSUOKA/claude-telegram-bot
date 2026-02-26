#!/bin/bash
# scout-agent.sh - Scout Agent: autonomous codebase scanner
# Runs Claude Code to scan codebase, sends report to Telegram
# Usage: bash scripts/scout-agent.sh          (normal run)
#        bash scripts/scout-agent.sh --dry-run (print to stdout only)

# Best-effort script - don't exit on errors

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
SCAN_PROMPT="$PROJECT_DIR/scripts/scout-scan.md"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="/tmp/jarvis-scout"
STOP_FILE="/tmp/jarvis-scout-stop"
TASK_TIMEOUT=300  # 5 min max
DRY_RUN=0

[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/scout-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

notify() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "=== TELEGRAM MESSAGE ==="
    echo "$1"
    echo "========================"
    return
  fi
  source "$ENV_FILE" 2>/dev/null || true
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALLOWED_USERS:-}" ]; then
    # Telegram max 4096 chars
    MSG=$(echo "$1" | head -c 4000)
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_ALLOWED_USERS}" \
      --data-urlencode "text=${MSG}" > /dev/null 2>&1 || true
  fi
}

# === Pre-flight ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file detected. Exiting."
  exit 0
fi

if [ ! -f "$SCAN_PROMPT" ]; then
  log "ERROR: scan prompt not found: $SCAN_PROMPT"
  exit 1
fi

# Auth check
VERSION=$("$CLAUDE_BIN" --version 2>/dev/null || echo "FAIL")
if [ "$VERSION" = "FAIL" ]; then
  log "ERROR: Claude Code not available"
  exit 1
fi
log "Claude Code $VERSION"

AUTH_TEST=$(timeout 30 "$CLAUDE_BIN" -p "Reply with exactly: AUTH_OK" --output-format text < /dev/null 2>/dev/null || echo "AUTH_FAIL")
if ! echo "$AUTH_TEST" | grep -q "AUTH_OK"; then
  log "ERROR: Auth failed"
  notify "🔭 Scout FAIL: Auth failed"
  exit 1
fi
log "Auth OK"

# === Run scan ===
log "Starting scan..."
PROMPT=$(cat "$SCAN_PROMPT")

SCAN_OUTPUT=$(timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" \
  -p "$PROMPT" \
  --max-turns 10 \
  --dangerously-skip-permissions \
  --output-format text \
  < /dev/null 2>>"$LOGFILE" || echo "SCOUT_TIMEOUT")

echo "$SCAN_OUTPUT" >> "$LOGFILE"

# === Extract report ===
if echo "$SCAN_OUTPUT" | grep -q "SCOUT_TIMEOUT"; then
  log "ERROR: Scan timed out"
  notify "🔭 Scout FAIL: Timeout (${TASK_TIMEOUT}s)"
  exit 1
fi

# Strip markdown code fences then extract between markers
CLEAN_OUTPUT=$(echo "$SCAN_OUTPUT" | sed 's/^```.*//; s/^```//')
REPORT=$(echo "$CLEAN_OUTPUT" | sed -n '/SCOUT_REPORT_START/,/SCOUT_REPORT_END/p' | grep -v 'SCOUT_REPORT_\(START\|END\)' || true)

if [ -z "$REPORT" ]; then
  # Fallback: look for the emoji header directly
  REPORT=$(echo "$CLEAN_OUTPUT" | sed -n '/🔭 Scout Report/,$ p' | head -40)
fi

if [ -z "$REPORT" ]; then
  log "WARN: Could not extract report, using raw output"
  REPORT=$(echo "$SCAN_OUTPUT" | tail -30)
fi

log "Scan complete. Report length: ${#REPORT} chars"

# === Send report ===
notify "$REPORT"
log "Report sent to Telegram"

# === Save for Phase 2 (future: numbered item dispatch) ===
echo "$REPORT" > "$LOG_DIR/latest-report.txt"

log "Scout Agent complete"
