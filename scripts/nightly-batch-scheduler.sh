#!/bin/bash
# nightly-batch-scheduler.sh — Run pending nightly_tasks from D1
# Called from nightly-maintenance.sh
# Creates table if not exists, spawns pending tasks via claude-code-spawn.sh
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
GATEWAY="${GATEWAY_URL:-https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev}"

source "$HOME/claude-telegram-bot/.env" 2>/dev/null || true

log() { echo "[$(date '+%H:%M:%S')] [nightly-batch] $1"; }

d1_query() {
  local sql="$1"
  local params="${2:-[]}"
  curl -s -X POST "$GATEWAY/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${GATEWAY_API_KEY:-}" \
    -d "{\"sql\": $(echo "$sql" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), \"params\": $params}" 2>/dev/null
}

# Ensure nightly_tasks table exists
d1_query "CREATE TABLE IF NOT EXISTS nightly_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL DEFAULT '/Users/daijiromatsuokam1/claude-telegram-bot',
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  done_at TEXT,
  result TEXT
)" > /dev/null

# Fetch pending tasks
PENDING=$(d1_query "SELECT id, prompt, cwd, model FROM nightly_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5")

TASK_COUNT=$(echo "$PENDING" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    print(len(d.get('results', [])))
except:
    print(0)
" 2>/dev/null || echo "0")

log "Pending tasks: $TASK_COUNT"
[ "$TASK_COUNT" -eq 0 ] && exit 0

# Process each task
echo "$PENDING" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for row in d.get('results', []):
    print(row['id'], '|', row['prompt'], '|', row.get('cwd', '.'), '|', row.get('model', 'claude-sonnet-4-5'))
" 2>/dev/null | while IFS='|' read -r task_id prompt cwd model; do
  task_id=$(echo "$task_id" | tr -d ' ')
  prompt=$(echo "$prompt" | xargs)
  cwd=$(echo "$cwd" | xargs)
  model=$(echo "$model" | xargs)

  log "Starting task $task_id: ${prompt:0:60}..."

  # Mark as running
  d1_query "UPDATE nightly_tasks SET status='running', started_at=datetime('now') WHERE id=$task_id" > /dev/null

  # Spawn via claude-code-spawn.sh
  SPAWN_SCRIPT="$SCRIPTS_DIR/claude-code-spawn.sh"
  if [ -f "$SPAWN_SCRIPT" ]; then
    RESULT=$(bash "$SPAWN_SCRIPT" "$prompt" "$cwd" 2>&1 || echo "SPAWN_FAILED")
    EXIT_CODE=$?
  else
    # Fallback: direct claude -p
    RESULT=$(cd "$cwd" && claude -p --dangerously-skip-permissions "$prompt" < /dev/null 2>&1 || echo "FAILED")
    EXIT_CODE=$?
  fi

  STATUS="done"
  [ $EXIT_CODE -ne 0 ] && STATUS="failed"

  # Escape for JSON
  RESULT_JSON=$(echo "$RESULT" | head -c 500 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '"error"')

  d1_query "UPDATE nightly_tasks SET status='$STATUS', done_at=datetime('now'), result=$RESULT_JSON WHERE id=$task_id" > /dev/null

  log "Task $task_id: $STATUS"

  # 30s cooldown between tasks
  sleep 30
done

log "Batch scheduler done"
