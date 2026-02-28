#!/bin/bash
# dj-ops-briefing.sh - 毎朝2:15自動実行
# DJの運用を世界トップ1%にするための最新情報配信
# X(Twitter)重点 + 英語→日本語翻訳
# Claude Code Max subscription (フラット課金) のみ使用
#
# CRITICAL: < /dev/null for headless mode
# CRITICAL: prompt via file (shell arg breaks with Japanese)
# CRITICAL: notify via Python (curl breaks UTF-8)

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
NOTIFY="python3 $PROJECT_DIR/scripts/telegram-notify.py"
LOG_DIR="/tmp/jarvis-briefing"
STOP_FILE="/tmp/jarvis-briefing-stop"
PROMPT_FILE="$LOG_DIR/ops-prompt.txt"
RESULT_FILE="$LOG_DIR/ops-result.txt"
TASK_TIMEOUT=600
# Obsidian CLI (daily note integration)
OBSIDIAN_CLI="/Applications/Obsidian.app/Contents/MacOS/Obsidian"


# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/dj-ops-${DATE}.log"

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

log "=== DJ Ops Briefing Start ==="

# === Write prompt to file ===
cat > "$PROMPT_FILE" << 'PROMPT_EOF'
You are DJs personal operations intelligence AI. Your mission: find information from the LAST 24-48 HOURS that will help DJ operate in the top 1% worldwide as a CEO who leverages AI automation.

DJ PROFILE:
- CEO of Kikai Lab (FA design engineering + food machinery company)
- Runs JARVIS: Telegram Bot AI assistant system (Bun/TypeScript/Grammy)
- Uses Claude Code CLI for autonomous task execution
- Uses ComfyUI + FLUX for AI image/video generation on M1 MAX
- Obsessed with "post 1 line, then do nothing" automation philosophy
- Flat-rate AI subscriptions only (Claude Max, Gemini Pro, ChatGPT Pro)
- macOS power user with launchd-based process management

STEP 1: X (TWITTER) - PRIORITY SOURCE
web_search: site:x.com Claude Code new feature OR update (last 7 days)
web_search: site:x.com AI automation workflow agent 2026
web_search: site:x.com AI coding agent productivity
web_search: site:x.com one person company AI automation
web_search: site:x.com MCP server new tool 2026
web_search: site:x.com CEO AI productivity

STEP 2: WEB - TOOLS AND TECHNIQUES
web_search: Claude Code tips advanced usage 2026
web_search: AI agent autonomous workflow breakthrough
web_search: best MCP servers 2026
web_search: Anthropic Claude announcement 2026

STEP 3: COMPETITIVE EDGE
web_search: Cursor vs Claude Code comparison 2026
web_search: AI image generation FLUX ComfyUI latest

OUTPUT FORMAT (plain text, no markdown):

🚀 DJ Ops Intel [DATE]

🐦 X/Twitter Highlights
- (3-5 notable posts/threads from X. Include @handle and key point)

🔧 Tools and Updates
- (2-4 tool updates directly relevant to DJs stack)

💡 Tactics and Insights
- (2-3 specific techniques/workflows that could improve DJs operations)

⚡ Action Items
- (1-2 concrete actions DJ should take today. Specify what, why, and how)

RULES:
- All output in Japanese (translate English sources)
- Include @handle for X posts
- Only actionable info. Skip anything that ends with just "interesting"
- No speculation or outdated info
- No markdown formatting, plain text only
PROMPT_EOF


# === Append to Obsidian Daily Note ===
append_to_obsidian() {
  local text="$1"
  if [ ! -x "$OBSIDIAN_CLI" ]; then
    log "Obsidian CLI not found, skipping daily note"
    return 1
  fi
  # Check if Obsidian is running (CLI requires GUI)
  if ! pgrep -xq "Obsidian"; then
    log "Obsidian not running, skipping daily note"
    return 1
  fi
  # Escape content for CLI (newlines as \n)
  local escaped=$(echo "$text" | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')
  local obs_content="\n## 🚀 DJ Ops Intel\n${escaped}"
  "$OBSIDIAN_CLI" daily:append content="$obs_content" 2>>"$LOGFILE"
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    log "Appended to Obsidian daily note OK"
  else
    log "Obsidian daily:append failed (exit=$exit_code)"
  fi
  return $exit_code
}

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
  $NOTIFY "🚀 DJ Ops Briefing failed (exit=$EXIT_CODE)"
  exit 1
fi

# === Save and send ===
echo "$RESULT" > "$RESULT_FILE"

if [ -n "$RESULT" ] && validate_result "$RESULT"; then
  $NOTIFY --file "$RESULT_FILE"
  SEND_EXIT=$?
  if [ $SEND_EXIT -eq 0 ]; then
    log "Sent to Telegram OK"
    # Append to Obsidian daily note
    append_to_obsidian "$RESULT"
  else
    log "ERROR: Telegram send failed (exit=$SEND_EXIT)"
  fi
elif [ -n "$RESULT" ]; then
  log "ERROR: Invalid result content (${#RESULT} chars): $(echo "$RESULT" | head -1)"
  $NOTIFY "🚀 Briefing ERROR: Claude returned invalid output (${#RESULT} chars)"
else
  $NOTIFY "🚀 DJ Ops Briefing ${DATE} - empty response"
  log "Empty response"
fi

log "=== DJ Ops Briefing Done ==="
