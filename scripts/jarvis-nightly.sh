#!/bin/bash
# jarvis-nightly.sh - Ralph Loop: Autonomous nightly execution
# Loops until all tasks done, stop file, consecutive failures, or max runtime
# Pattern: https://www.anthropic.com/engineering/building-c-compiler
#
# CRITICAL: < /dev/null required for headless mode via cron/launchd
# CRITICAL: No API keys used - Max subscription CLI only

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
MEMORY_DIR="$HOME/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory"
LOG_DIR="/tmp/jarvis-nightly"
ENV_FILE="$PROJECT_DIR/.env"
STOP_FILE="/tmp/jarvis-nightly-stop"
MAX_TURNS=30
TASK_TIMEOUT=900        # 15min per task
COOLDOWN=30             # seconds between tasks
MAX_CONSECUTIVE_FAIL=3  # circuit breaker
MAX_RUNTIME=14400       # 4 hours (23:00 -> 03:00)
# RALPH LOOP marker - do not remove (idempotency check)

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
LOGFILE="$LOG_DIR/nightly-${DATE}-${TIME}.log"
START_EPOCH=$(date +%s)

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

notify() {
  source "$ENV_FILE" 2>/dev/null || true
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_ALLOWED_USERS}" -d "text=$1" > /dev/null 2>&1 || true
}

elapsed() {
  echo $(( $(date +%s) - START_EPOCH ))
}

# === Pre-flight ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file detected. Exiting."
  exit 0
fi

# Health check
VERSION=$("$CLAUDE_BIN" --version 2>/dev/null || echo "FAIL")
if [ "$VERSION" = "FAIL" ]; then
  log "ERROR: Claude Code not available"
  notify "🌙 Nightly FAIL: Claude Code not available"
  exit 1
fi
log "Claude Code $VERSION"

# Quick auth test
AUTH_TEST=$(timeout 30 "$CLAUDE_BIN" -p "Reply with exactly: AUTH_OK" --output-format text < /dev/null 2>/dev/null || echo "AUTH_FAIL")
if echo "$AUTH_TEST" | grep -q "AUTH_OK"; then
  log "Auth OK"
else
  log "ERROR: Auth failed - $AUTH_TEST"
  notify "🌙 Nightly FAIL: Auth failed"
  exit 1
fi

# === Read task-state.md ===
TASK_STATE="$MEMORY_DIR/task-state.md"
if [ ! -f "$TASK_STATE" ]; then
  log "ERROR: task-state.md not found"
  notify "🌙 Nightly FAIL: task-state.md not found"
  exit 1
fi

log "Starting Ralph Loop (${MAX_RUNTIME}s max, ${TASK_TIMEOUT}s/task, circuit breaker=${MAX_CONSECUTIVE_FAIL})"
notify "🌙 Nightly START: $(date '+%H:%M') - Ralph Loop - Claude Code $VERSION"

# === Ralph Loop ===
COMPLETED=0
FAILED=0
SKIPPED=0
CONSECUTIVE_FAIL=0
ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))

  # --- Stop conditions ---
  if [ -f "$STOP_FILE" ]; then
    log "Stop file detected. Halting loop."
    break
  fi

  if [ $(elapsed) -ge $MAX_RUNTIME ]; then
    log "Max runtime reached (${MAX_RUNTIME}s). Halting loop."
    break
  fi

  if [ $CONSECUTIVE_FAIL -ge $MAX_CONSECUTIVE_FAIL ]; then
    log "Circuit breaker: $MAX_CONSECUTIVE_FAIL consecutive failures. Halting loop."
    break
  fi

  log "=== Iteration $ITERATION (elapsed: $(elapsed)s, done=$COMPLETED, fail=$FAILED, skip=$SKIPPED) ==="

  # Build prompt with current git state for context continuity
  GIT_SHORT=$(cd "$PROJECT_DIR" && git log --oneline -3 2>/dev/null || echo "no git")

  PROMPT="You are running in nightly autonomous mode (Ralph Loop iteration $ITERATION).
Recent git commits:
$GIT_SHORT

Read task-state.md from your Auto Memory context.

Pick the FIRST unchecked task from the Active section (marked with '- [ ]').
Execute it following these rules:
1. Read all relevant files before making changes
2. Make minimal, focused changes
3. Run the test command if specified
4. If tests pass, update task-state.md to mark the task as completed (change '- [ ]' to '- [x]')
5. Commit your changes with a descriptive message
6. Report what you did

CONSTRAINTS:
- Do NOT use any API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)
- Do NOT modify files outside this project
- Do NOT run destructive commands (rm -rf, drop database, etc.)
- If you are unsure about a task, SKIP it and move to the next one
- If all tasks require human judgment, report that and stop

Report format:
TASK: <task name>
STATUS: DONE|SKIPPED|FAILED
CHANGES: <brief summary>
"

  TASK_OUTPUT=$(timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" \
    -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --dangerously-skip-permissions \
    --output-format text \
    < /dev/null 2>>"$LOGFILE" || echo "TIMEOUT_OR_ERROR")

  echo "$TASK_OUTPUT" >> "$LOGFILE"

  if echo "$TASK_OUTPUT" | grep -q "TIMEOUT_OR_ERROR"; then
    log "Iteration $ITERATION: TIMEOUT or ERROR"
    FAILED=$((FAILED + 1))
    CONSECUTIVE_FAIL=$((CONSECUTIVE_FAIL + 1))
  elif echo "$TASK_OUTPUT" | grep -q "STATUS: DONE"; then
    log "Iteration $ITERATION: COMPLETED"
    COMPLETED=$((COMPLETED + 1))
    CONSECUTIVE_FAIL=0  # Reset circuit breaker
  elif echo "$TASK_OUTPUT" | grep -qi "STATUS: SKIPPED\|human judgment\|all tasks.*require\|no.*unchecked"; then
    log "Iteration $ITERATION: SKIPPED / All tasks need human"
    SKIPPED=$((SKIPPED + 1))
    # If skip, likely remaining tasks also need human - break
    break
  else
    log "Iteration $ITERATION: FAILED or unclear output"
    FAILED=$((FAILED + 1))
    CONSECUTIVE_FAIL=$((CONSECUTIVE_FAIL + 1))
  fi

  # Cooldown between iterations
  sleep "$COOLDOWN"
done

# === Summary ===
TOTAL_TIME=$(elapsed)
log "Ralph Loop complete: $COMPLETED done, $FAILED failed, $SKIPPED skipped in ${TOTAL_TIME}s ($ITERATION iterations)"

# Sync memory
bash "$PROJECT_DIR/scripts/memory-sync.sh" 2>/dev/null || true

# Trigger auto-handoff
python3 "$PROJECT_DIR/scripts/auto-handoff.py" 2>/dev/null || true

notify "🌙 Nightly DONE: ${COMPLETED}完了 / ${FAILED}失敗 / ${SKIPPED}スキップ (${ITERATION}回, ${TOTAL_TIME}s) log: $LOGFILE"
