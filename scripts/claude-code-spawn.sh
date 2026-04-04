#!/bin/bash
# claude-code-spawn.sh — Fire-and-forget Claude Code headless task
# Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model]
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
TASK_DIR="/tmp/claude-code-tasks"
mkdir -p "$TASK_DIR"

PROMPT_B64="${1:?Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model]}"
CWD="${2:-$HOME/claude-telegram-bot}"
MODEL="${3:-sonnet}"

# Decode prompt
PROMPT_FILE="$TASK_DIR/prompt-$$.txt"
echo "$PROMPT_B64" | base64 -d > "$PROMPT_FILE" 2>/dev/null
if [ ! -s "$PROMPT_FILE" ]; then
  echo "ERROR: failed to decode base64 prompt"
  exit 1
fi
PREVIEW=$(head -c 150 "$PROMPT_FILE")

# Guard: check for running task
CURRENT="$TASK_DIR/current.json"
if [ -f "$CURRENT" ]; then
  EXISTING_PID=$(python3 -c "import json; print(json.load(open('$CURRENT')).get('pid',''))" 2>/dev/null)
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    EXISTING_TASK=$(python3 -c "import json; print(json.load(open('$CURRENT')).get('task_id','?'))" 2>/dev/null)
    echo "BLOCKED: task already running (PID=$EXISTING_PID, task=$EXISTING_TASK)"
    echo "Use: bash scripts/claude-code-status.sh to check progress"
    exit 1
  fi
  STALE_ID=$(python3 -c "import json; print(json.load(open('$CURRENT')).get('task_id','stale'))" 2>/dev/null)
  mv "$CURRENT" "$TASK_DIR/${STALE_ID}.done.json" 2>/dev/null
fi

TASK_ID="cc_$(date '+%Y%m%d_%H%M%S')_$$"
OUTPUT_LOG="$TASK_DIR/${TASK_ID}.log"

# Create runner script (isolates shell escaping)
RUNNER="$TASK_DIR/${TASK_ID}.runner.sh"
cat > "$RUNNER" << RUNNER_EOF
#!/bin/bash
cd "$CWD" || exit 1
claude -p --dangerously-skip-permissions --model "$MODEL" < "$PROMPT_FILE" > "$OUTPUT_LOG" 2>&1
CC_EXIT=\$?
python3 -c "
import json
try:
    d = json.load(open('$CURRENT'))
    d['status'] = 'done' if \$CC_EXIT == 0 else 'failed'
    d['exit_code'] = \$CC_EXIT
    json.dump(d, open('$CURRENT', 'w'), indent=2)
except: pass
" 2>/dev/null
mv "$CURRENT" "$TASK_DIR/${TASK_ID}.done.json" 2>/dev/null
bash "$NOTIFY" "\$([ \$CC_EXIT -eq 0 ] && echo '✅' || echo '❌') Claude Code完了 (exit=\$CC_EXIT)
🆔 $TASK_ID" 2>/dev/null
RUNNER_EOF
chmod +x "$RUNNER"

# Save metadata
python3 << PYEOF
import json
from datetime import datetime
d = {
    "task_id": "$TASK_ID",
    "pid": 0,
    "cwd": "$CWD",
    "model": "$MODEL",
    "started_at": datetime.now().isoformat(),
    "status": "starting",
    "output_log": "$OUTPUT_LOG",
    "prompt_file": "$PROMPT_FILE"
}
json.dump(d, open("$CURRENT", "w"), indent=2)
PYEOF

# Spawn (nohup = independent from Poller process tree)
nohup bash "$RUNNER" > /dev/null 2>&1 &
PID=$!

# Update PID
python3 -c "
import json
d = json.load(open('$CURRENT'))
d['pid'] = $PID
d['status'] = 'running'
json.dump(d, open('$CURRENT', 'w'), indent=2)
" 2>/dev/null

bash "$NOTIFY" "🚀 Claude Code起動
📋 ${PREVIEW}...
🆔 $TASK_ID (PID=$PID)
📂 $CWD | 🤖 $MODEL" 2>/dev/null &

echo "SPAWNED: $TASK_ID"
echo "PID: $PID"
echo "LOG: $OUTPUT_LOG"
