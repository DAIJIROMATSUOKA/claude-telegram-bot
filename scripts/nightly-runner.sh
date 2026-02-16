#!/bin/bash
# nightly-runner.sh — Claude Code headless nightly execution
# Cron: 0 23 * * * ~/claude-telegram-bot/scripts/nightly-runner.sh
#
# Reads task-state.md, executes highest priority uncompleted task.
# Safety: 2h timeout, PreToolUse hook guards, /tmp/nightly-stop kill switch.

set -euo pipefail

PROJECT_DIR="$HOME/claude-telegram-bot"
LOG_DIR="$PROJECT_DIR/logs/nightly"
STOP_FLAG="/tmp/nightly-stop"
MAX_RUNTIME=7200  # 2 hours in seconds
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/$DATE.log"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

notify() {
  source "$PROJECT_DIR/.env" 2>/dev/null || true
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_ALLOWED_USERS}" \
    -d "text=$1" > /dev/null 2>&1 || true
}

# --- Pre-flight checks ---

# Emergency stop
if [ -f "$STOP_FLAG" ]; then
  log "ABORT: $STOP_FLAG exists. Remove to enable nightly runs."
  exit 0
fi

# Check Claude Code CLI
if ! command -v claude &>/dev/null; then
  log "ABORT: claude CLI not found"
  notify "🌙 Nightly ABORT: claude CLI not found"
  exit 1
fi

# Check not already running
PIDFILE="/tmp/nightly-runner.pid"
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    log "ABORT: Already running (PID $OLD_PID)"
    exit 0
  fi
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE" /tmp/nightly-mode' EXIT

# Set nightly mode flag (for PreToolUse guard)
touch /tmp/nightly-mode

# --- Read task state ---
MEMORY_DIR="$HOME/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory"
TASK_STATE="$MEMORY_DIR/task-state.md"

if [ ! -f "$TASK_STATE" ]; then
  log "ABORT: task-state.md not found"
  notify "🌙 Nightly ABORT: task-state.md not found"
  exit 1
fi

# Extract active tasks (lines starting with "- [ ]" under "## 🔴 Active")
ACTIVE_TASKS=$(sed -n '/^## 🔴 Active/,/^## /p' "$TASK_STATE" | grep '^\- \[ \]' | head -3)
if [ -z "$ACTIVE_TASKS" ]; then
  log "No active tasks found. Skipping."
  exit 0
fi

log "=== Nightly Runner START ==="
log "Active tasks:"
log "$ACTIVE_TASKS"
notify "🌙 Nightly START: $(echo "$ACTIVE_TASKS" | head -1 | sed 's/- \[ \] //')"

# --- Build prompt ---
PROMPT="You are running as a nightly autonomous agent on M1 MAX.

## Rules
1. Read memory/task-state.md for the current task list
2. Pick the HIGHEST PRIORITY uncompleted task under '## 🔴 Active'
3. Work on it step by step. Run tests after changes.
4. Update memory/task-state.md when done (mark [x] and add completion date)
5. If you get stuck, document what you tried in memory/lessons.md and move on
6. Do NOT run git push. Only git add + git commit --no-verify.
7. Do NOT modify .env or any credential files.
8. Do NOT restart the Jarvis bot process.
9. Maximum focus: one task at a time. Stop after completing one task.
10. Before any implementation, read docs/DESIGN-RULES.md

## Current active tasks:
$ACTIVE_TASKS

Start working on the first task now."

# --- Execute ---
log "Starting Claude Code headless..."

timeout "$MAX_RUNTIME" claude -p "$PROMPT" \
  --dangerously-skip-permissions \
  --output-format text \
  --verbose \
  > "$LOG_DIR/${DATE}-output.txt" 2> "$LOG_DIR/${DATE}-stderr.txt" &

CLAUDE_PID=$!
log "Claude PID: $CLAUDE_PID"

# Monitor loop: check stop flag every 30s
while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [ -f "$STOP_FLAG" ]; then
    log "STOP FLAG detected. Killing Claude (PID $CLAUDE_PID)..."
    kill "$CLAUDE_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$CLAUDE_PID" 2>/dev/null || true
    notify "🌙 Nightly STOPPED by kill switch"
    log "=== Nightly Runner STOPPED ==="
    exit 0
  fi
  sleep 30
done

# Get exit code
wait "$CLAUDE_PID"
EXIT_CODE=$?

# --- Report ---
OUTPUT_SIZE=$(wc -c < "$LOG_DIR/${DATE}-output.txt" 2>/dev/null || echo 0)
log "Claude exited: code=$EXIT_CODE output=${OUTPUT_SIZE}B"

if [ "$EXIT_CODE" -eq 0 ]; then
  # Check git status for changes
  cd "$PROJECT_DIR"
  CHANGES=$(git status --short | wc -l | tr -d ' ')
  log "Git changes: $CHANGES files"
  notify "🌙 Nightly DONE (exit=0, ${CHANGES} changed files). Check logs/nightly/${DATE}-output.txt"
else
  notify "🌙 Nightly FAIL (exit=$EXIT_CODE). Check logs/nightly/${DATE}-stderr.txt"
fi

log "=== Nightly Runner END ==="
