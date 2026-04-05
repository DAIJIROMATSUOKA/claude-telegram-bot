#!/usr/bin/env bash
# batch-runner-safe.sh — Safe batch runner with flock, PID file, and Telegram notification
set -euo pipefail

LOCK_FILE="/tmp/batch-runner.lock"
PID_FILE="/tmp/batch-runner.pid"
NOTIFY="$HOME/claude-telegram-bot/scripts/notify-dj.sh"
TIMEOUT_SEC=5400  # 90 minutes

# Cleanup trap
cleanup() {
  rm -f "$PID_FILE"
  # Lock fd released automatically on exit
}
trap cleanup EXIT

# Acquire exclusive non-blocking lock
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "ERROR: Another batch-runner is already running (lock held)"
  exit 1
fi

# Write PID
echo $$ > "$PID_FILE"

# Validate args
PROMPT_DIR="${1:?Usage: batch-runner-safe.sh <prompt-dir>}"
if [[ ! -d "$PROMPT_DIR" ]]; then
  echo "ERROR: Directory not found: $PROMPT_DIR"
  exit 1
fi

# Count prompt files
mapfile -t PROMPT_FILES < <(find "$PROMPT_DIR" -maxdepth 1 -name '*.txt' -type f | sort)
TOTAL=${#PROMPT_FILES[@]}
if [[ $TOTAL -eq 0 ]]; then
  echo "No .txt files found in $PROMPT_DIR"
  exit 0
fi

bash "$NOTIFY" "🚀 Batch runner started: $TOTAL tasks from $(basename "$PROMPT_DIR")" 2>/dev/null || true

COMMIT_COUNT=0
FAIL_COUNT=0
SUCCESS_COUNT=0

for PROMPT_FILE in "${PROMPT_FILES[@]}"; do
  BASENAME=$(basename "$PROMPT_FILE")
  echo "=== Processing: $BASENAME ==="

  # Run with timeout
  set +e
  timeout "${TIMEOUT_SEC}s" claude -p --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" < /dev/null 2>&1
  EXIT_CODE=$?
  set -e

  if [[ $EXIT_CODE -eq 124 ]]; then
    bash "$NOTIFY" "⏱ Batch timeout (90min): $BASENAME" 2>/dev/null || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  elif [[ $EXIT_CODE -ne 0 ]]; then
    bash "$NOTIFY" "❌ Batch failed (exit $EXIT_CODE): $BASENAME" 2>/dev/null || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))

  # Count commits made
  NEW_COMMITS=$(git -C "$HOME/claude-telegram-bot" log --oneline --since="5 minutes ago" 2>/dev/null | wc -l | tr -d ' ')
  COMMIT_COUNT=$((COMMIT_COUNT + NEW_COMMITS))

  # Run tests
  set +e
  TEST_OUTPUT=$(cd "$HOME/claude-telegram-bot" && bun test 2>&1 | tail -5)
  TEST_EXIT=$?
  set -e

  if [[ $TEST_EXIT -ne 0 ]]; then
    bash "$NOTIFY" "⚠️ Tests failed after $BASENAME" 2>/dev/null || true
  fi
done

# Final summary
SUMMARY="✅ Batch complete: ${SUCCESS_COUNT}/${TOTAL} OK, ${FAIL_COUNT} failed, ${COMMIT_COUNT} commits"
echo "$SUMMARY"
bash "$NOTIFY" "$SUMMARY" 2>/dev/null || true
