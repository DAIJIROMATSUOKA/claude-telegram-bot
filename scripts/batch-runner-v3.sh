#!/usr/bin/env bash
# batch-runner-v3.sh — Batch runner with setsid, PID lock, Telegram notify, skip-completed
# Usage: batch-runner-v3.sh <prompt-directory>
set -euo pipefail

PID_FILE="/tmp/batch-runner.pid"
LOG_FILE="/tmp/batch-runner.log"
NOTIFY="$HOME/claude-telegram-bot/scripts/notify-dj.sh"
REPO="$HOME/claude-telegram-bot"
TIMEOUT_SEC=7200  # 120 minutes per batch

# --- PID file lock with stale detection (no flock on macOS) ---
if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "ERROR: Another batch-runner is already running (PID=$EXISTING_PID)"
    exit 1
  fi
  echo "WARN: Stale PID file found (PID=$EXISTING_PID not running), removing"
  rm -f "$PID_FILE"
fi

# Write our PID
echo $$ > "$PID_FILE"

# Cleanup trap
cleanup() {
  rm -f "$PID_FILE"
}
trap cleanup EXIT

# --- Validate args ---
PROMPT_DIR="${1:?Usage: batch-runner-v3.sh <prompt-directory>}"
if [[ ! -d "$PROMPT_DIR" ]]; then
  echo "ERROR: Directory not found: $PROMPT_DIR"
  exit 1
fi

# Collect prompt files
mapfile -t PROMPT_FILES < <(find "$PROMPT_DIR" -maxdepth 1 -name '*.txt' -type f | sort)
TOTAL=${#PROMPT_FILES[@]}
if [[ $TOTAL -eq 0 ]]; then
  echo "No .txt files found in $PROMPT_DIR"
  exit 0
fi

# --- Start ---
START_TIME=$(date +%s)
DIRNAME=$(basename "$PROMPT_DIR")

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Batch Runner v3 started: $TOTAL tasks from $DIRNAME ==="
bash "$NOTIFY" "🚀 Batch v3 started: $TOTAL tasks from $DIRNAME" 2>/dev/null || true

COMMIT_COUNT=0
FAIL_COUNT=0
SUCCESS_COUNT=0
SKIP_COUNT=0

for PROMPT_FILE in "${PROMPT_FILES[@]}"; do
  BASENAME=$(basename "$PROMPT_FILE" .txt)
  log "--- Processing: $BASENAME ---"

  # Skip already-completed batches (check git log for commit message containing batch name)
  if git -C "$REPO" log --oneline -20 2>/dev/null | grep -qi "$BASENAME"; then
    log "SKIP: $BASENAME already committed (found in git log)"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  # Notify start
  bash "$NOTIFY" "🔄 Batch task started: $BASENAME ($((SUCCESS_COUNT + FAIL_COUNT + SKIP_COUNT + 1))/$TOTAL)" 2>/dev/null || true

  TASK_START=$(date +%s)

  # Run with timeout via setsid for SIGTERM survival
  set +e
  timeout "${TIMEOUT_SEC}s" claude -p \
    "Read the file $PROMPT_FILE and follow every instruction in it exactly." \
    --dangerously-skip-permissions --model sonnet \
    < /dev/null >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  TASK_END=$(date +%s)
  TASK_DURATION=$(( TASK_END - TASK_START ))
  TASK_DURATION_MIN=$(( TASK_DURATION / 60 ))

  if [[ $EXIT_CODE -eq 124 ]]; then
    log "TIMEOUT: $BASENAME (${TIMEOUT_SEC}s exceeded)"
    bash "$NOTIFY" "⏱ Batch timeout (120min): $BASENAME" 2>/dev/null || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  elif [[ $EXIT_CODE -ne 0 ]]; then
    log "FAIL: $BASENAME (exit $EXIT_CODE, ${TASK_DURATION_MIN}min)"
    bash "$NOTIFY" "❌ Batch failed (exit $EXIT_CODE): $BASENAME [${TASK_DURATION_MIN}min]" 2>/dev/null || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))

  # Count new commits
  NEW_COMMITS=$(git -C "$REPO" log --oneline --since="$((TASK_DURATION + 60)) seconds ago" 2>/dev/null | wc -l | tr -d ' ')
  COMMIT_COUNT=$((COMMIT_COUNT + NEW_COMMITS))

  # Run tests
  set +e
  TEST_OUTPUT=$(cd "$REPO" && bun test 2>&1 | tail -10)
  TEST_EXIT=$?
  set -e

  if [[ $TEST_EXIT -ne 0 ]]; then
    log "WARN: Tests failed after $BASENAME"
    bash "$NOTIFY" "⚠️ Tests failed after $BASENAME [${TASK_DURATION_MIN}min]" 2>/dev/null || true
  else
    log "OK: $BASENAME completed (${TASK_DURATION_MIN}min)"
    bash "$NOTIFY" "✅ Batch task done: $BASENAME [${TASK_DURATION_MIN}min]" 2>/dev/null || true
  fi
done

# --- Final summary ---
END_TIME=$(date +%s)
TOTAL_DURATION=$(( END_TIME - START_TIME ))
TOTAL_MIN=$(( TOTAL_DURATION / 60 ))

# Final test run
set +e
FINAL_TEST=$(cd "$REPO" && bun test 2>&1 | tail -5)
FINAL_TEST_EXIT=$?
set -e

TEST_STATUS="PASS"
[[ $FINAL_TEST_EXIT -ne 0 ]] && TEST_STATUS="FAIL"

SUMMARY="🏁 Batch v3 complete
✅ ${SUCCESS_COUNT} OK | ❌ ${FAIL_COUNT} failed | ⏭ ${SKIP_COUNT} skipped
📊 ${COMMIT_COUNT} commits | 🧪 Tests: ${TEST_STATUS}
⏱ Total: ${TOTAL_MIN}min"

log "$SUMMARY"
bash "$NOTIFY" "$SUMMARY" 2>/dev/null || true
