#!/bin/bash
# nightly-claude.sh - Phase 4: Autonomous nightly Claude Code execution
# LaunchAgent: com.jarvis.nightly-claude (23:00 daily)
#
# Reads task-state.md from Auto Memory, executes pending tasks via Claude Code headless.
# Safety: allowedTools restricted, 2-hour timeout, exit logging.

set -euo pipefail

PROJECT_DIR="$HOME/claude-telegram-bot"
MEMORY_DIR="$HOME/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/nightly-claude-$(date +%Y-%m-%d).log"
LOCK_FILE="/tmp/nightly-claude.lock"
MAX_DURATION=7200  # 2 hours

# Ensure PATH includes homebrew + bun
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

# Source .env for Telegram
source "$PROJECT_DIR/.env" 2>/dev/null || true

log() {
  echo "[$(date '+%H:%M:%S')] $1" >> "$LOG_FILE"
}

notify() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_ALLOWED_USERS}" -d "text=$1" > /dev/null 2>&1 || true
}

cleanup() {
  rm -f "$LOCK_FILE"
  log "Lock released"
}

# --- Guard: single instance ---
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Already running (PID $PID)" >> "$LOG_FILE"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap cleanup EXIT

# --- Guard: stop flag ---
if [ -f /tmp/nightly-claude-stop ]; then
  log "Stop flag detected. Skipping."
  exit 0
fi

mkdir -p "$LOG_DIR"
log "=== Nightly Claude Code session started ==="

# --- Read task state ---
TASK_STATE=""
if [ -f "$MEMORY_DIR/task-state.md" ]; then
  TASK_STATE=$(cat "$MEMORY_DIR/task-state.md")
  log "Task state loaded ($(wc -l < "$MEMORY_DIR/task-state.md") lines)"
else
  log "WARNING: task-state.md not found"
  notify "Nightly Claude: task-state.md not found, skipping"
  exit 0
fi

# --- Check for active tasks ---
ACTIVE_COUNT=$(echo "$TASK_STATE" | grep -c '^\- \[ \]' || true)
if [ "$ACTIVE_COUNT" -eq 0 ]; then
  log "No active tasks found. Skipping."
  notify "Nightly Claude: no active tasks"
  exit 0
fi

log "Found $ACTIVE_COUNT active tasks"
notify "Nightly Claude starting ($ACTIVE_COUNT tasks)"

# --- Build prompt ---
read -r -d '' PROMPT << 'PROMPTEOF' || true
You are running in nightly autonomous mode on M1 MAX.

RULES:
1. Read task-state.md in the memory directory for active tasks
2. Pick the highest priority task marked with [ ] (unchecked)
3. Work on it: read relevant code, make changes, run tests
4. After completing a task, update task-state.md to mark it [x]
5. Move to the next task if time permits
6. When done or if stuck, update MEMORY.md and task-state.md with your progress
7. DO NOT: push to git, modify .env, delete files outside project, run production deployments
8. DO NOT: install new system packages or modify system configs
9. If a task requires DJ input, skip it and note why in task-state.md
10. Always run: bun test after code changes to verify nothing is broken

Start working on the highest priority active task.
PROMPTEOF

# --- Execute ---
log "Launching claude -p (timeout ${MAX_DURATION}s)"

timeout "$MAX_DURATION" claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Write,Edit,MultiEdit,Bash(bun:*),Bash(cat:*),Bash(grep:*),Bash(find:*),Bash(ls:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(diff:*),Bash(echo:*),Bash(mkdir:*),Bash(cp:*),Bash(mv:*),Bash(python3:*),Glob,Grep,TodoRead,TodoWrite" \
  --output-format text \
  >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

log "Claude Code exited with code $EXIT_CODE"

# --- Post-execution ---
if [ $EXIT_CODE -eq 0 ]; then
  notify "Nightly Claude completed successfully"
elif [ $EXIT_CODE -eq 124 ]; then
  log "TIMEOUT: exceeded ${MAX_DURATION}s"
  notify "Nightly Claude timed out after ${MAX_DURATION}s"
else
  notify "Nightly Claude failed (exit=$EXIT_CODE)"
fi

# --- Trigger auto-handoff ---
if [ -f "$PROJECT_DIR/scripts/auto-handoff.py" ]; then
  python3 "$PROJECT_DIR/scripts/auto-handoff.py" >> "$LOG_FILE" 2>&1 || true
  log "Auto-handoff triggered"
fi

log "=== Nightly session ended ==="
