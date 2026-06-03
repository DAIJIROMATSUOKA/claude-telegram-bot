#!/bin/bash
# morning-briefing.sh - 毎朝2:00自動実行
# FA業界ニュース（世界+日本）+ KEYENCE重点監視
# Claude Code Max subscription (フラット課金) のみ使用
#
# CRITICAL: < /dev/null for headless mode
# CRITICAL: prompt via file (shell arg breaks with Japanese)
# CRITICAL: notify via Python (curl breaks UTF-8)

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
NOTIFY="python3 $PROJECT_DIR/scripts/line-notify.py"
LOG_DIR="/tmp/jarvis-briefing"
STOP_FILE="/tmp/jarvis-briefing-stop"
PROMPT_FILE="$LOG_DIR/fa-prompt.txt"
RESULT_FILE="$LOG_DIR/fa-result.txt"
TASK_TIMEOUT=600

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/briefing-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }


# === Kill stale Claude Code processes (>6h old) ===
cleanup_stale_claude() {
  local now=$(date +%s)
  for pid in $(pgrep -f "claude.*--output-format" 2>/dev/null); do
    local start=$(ps -o lstart= -p "$pid" 2>/dev/null)
    if [ -n "$start" ]; then
      local start_epoch=$(date -j -f "%c" "$start" +%s 2>/dev/null)
      if [ -n "$start_epoch" ]; then
        local age=$(( (now - start_epoch) / 3600 ))
        if [ "$age" -ge 6 ]; then
          kill "$pid" 2>/dev/null
          log "Killed stale Claude Code PID=$pid (${age}h old)"
        fi
      fi
    fi
  done
}
cleanup_stale_claude

# === Stop file check ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file exists, skipping"
  exit 0
fi

log "=== FA News Briefing Start ==="

# === Write prompt to file ===
cat > "$PROMPT_FILE" << 'PROMPT_EOF'
You are DJs Factory Automation industry news briefing AI. Gather FA news from the LAST 24 HOURS covering both global and Japanese markets. KEYENCE news must NEVER be missed.

STEP 1: KEYENCE DEDICATED CHECK (MANDATORY)
web_search: KEYENCE OR キーエンス (last 7 days)
web_search: keyence new product OR partnership OR acquisition 2026

STEP 2: GLOBAL FA NEWS
web_search: factory automation industry news (last 7 days)
web_search: Fanuc OR ABB OR Siemens OR Rockwell automation news
web_search: smart factory AI manufacturing 2026

STEP 3: JAPAN FA NEWS
web_search: ファクトリーオートメーション ニュース 2026
web_search: ファナック OR 三菱電機 OR オムロン OR 安川電機 最新
web_search: 製造業 DX 自動化 AI

OUTPUT FORMAT (plain text, no markdown):

🏭 FA News [DATE]

📌 KEYENCE
- (news items or 特になし)

🌍 Global FA
- (3-5 items)

🇯🇵 Japan FA
- (3-5 items)

💡 注目トレンド
- (1-2 items)

RULES:
- KEYENCE section is mandatory (write 特になし if no news)
- Source name in parentheses for each item
- Output in Japanese
- 1-2 lines per item, concise
- Include IR and earnings info
- Merge duplicate news
- No speculation or outdated news
- No markdown formatting, plain text only
PROMPT_EOF

# === Run Claude Code with retry ===
run_claude() {
  cd "$PROJECT_DIR" && timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" -p --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" --max-turns 15 < /dev/null 2>>"$LOGFILE"
}

validate_result() {
  local r="$1"
  [ ${#r} -lt 200 ] && return 1
  echo "$r" | grep -qi "^Execution error$" && return 1
  echo "$r" | grep -qi "^Error:" && return 1
  return 0
}

RESULT=$(run_claude)
EXIT_CODE=$?

log "Claude Code exit: $EXIT_CODE (${#RESULT} chars)"

# Retry once if failed or invalid output
if [ $EXIT_CODE -ne 0 ] || ! validate_result "$RESULT"; then
  log "RETRY: waiting 60s (exit=$EXIT_CODE, len=${#RESULT})"
  sleep 60
  RESULT=$(run_claude)
  EXIT_CODE=$?
  log "RETRY result: exit=$EXIT_CODE (${#RESULT} chars)"
fi

if [ $EXIT_CODE -ne 0 ]; then
  log "ERROR: Claude Code failed (exit=$EXIT_CODE)"
  $NOTIFY "🏭 FA News Briefing failed (exit=$EXIT_CODE)"
  exit 1
fi

# === Save and send ===
echo "$RESULT" > "$RESULT_FILE"

if [ -n "$RESULT" ] && validate_result "$RESULT"; then
  $NOTIFY --file "$RESULT_FILE"
  SEND_EXIT=$?
  if [ $SEND_EXIT -eq 0 ]; then
    log "Sent to Telegram OK"
  else
    log "ERROR: Telegram send failed (exit=$SEND_EXIT)"
  fi
elif [ -n "$RESULT" ]; then
  log "ERROR: Invalid result content (${#RESULT} chars): $(echo "$RESULT" | head -1)"
  $NOTIFY "🏭 Briefing ERROR: Claude returned invalid output (${#RESULT} chars)"
else
  $NOTIFY "🏭 FA News Briefing ${DATE} - empty response"
  log "Empty response"
fi

log "=== FA News Briefing Done ==="
