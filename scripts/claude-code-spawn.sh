#!/bin/bash
# claude-code-spawn.sh — Fire-and-forget Claude Code headless task
# Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model]
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
CLEANUP="$SCRIPTS_DIR/claude-code-cleanup.py"
TASK_DIR="/tmp/claude-code-tasks"
mkdir -p "$TASK_DIR"

PROMPT_B64="${1:?Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model]}"
CWD="${2:-$HOME/claude-telegram-bot}"
# Resolve container paths to M1 home
CWD=$(echo "$CWD" | sed "s|^/root|$HOME|;s|^~|$HOME|")
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
RUNNER="$TASK_DIR/${TASK_ID}.runner.sh"
RUNNER_LOG="$TASK_DIR/${TASK_ID}.runner.log"

# Save task metadata
python3 - "$TASK_ID" "$CWD" "$MODEL" "$OUTPUT_LOG" "$PROMPT_FILE" "$CURRENT" << 'PYMETA'
import json, sys
from datetime import datetime
task_id, cwd, model, output_log, prompt_file, current = sys.argv[1:7]
json.dump({
    "task_id": task_id, "pid": 0, "cwd": cwd, "model": model,
    "started_at": datetime.now().isoformat(), "status": "starting",
    "output_log": output_log, "prompt_file": prompt_file,
}, open(current, "w"), indent=2)
PYMETA

# Write .run.sh file then nohup (avoids bash -c quoting hell + poller pgid kill)
RUNSH="$TASK_DIR/${TASK_ID}.run.sh"
python3 - "$RUNSH" "$CWD" "$MODEL" "$PROMPT_FILE" "$OUTPUT_LOG" "$CURRENT" "$TASK_DIR" "$TASK_ID" "$NOTIFY" "$CLEANUP" << 'PYBLOCK'
import sys, os, stat
runsh, cwd, model, prompt, output, current, task_dir, task_id, notify, cleanup = sys.argv[1:11]
script = f"""#!/bin/bash
cd "{cwd}" || exit 1
PROMPT=$(cat "{prompt}")
claude -p --bare "$PROMPT" \
  --dangerously-skip-permissions --output-format json --model "{model}" \
  < /dev/null > "{output}" 2>&1
CC_EXIT=$?
python3 "{cleanup}" "{current}" "{task_dir}" "{task_id}" "$CC_EXIT" "{notify}"
"""
with open(runsh, "w") as f:
    f.write(script)
os.chmod(runsh, os.stat(runsh).st_mode | stat.S_IEXEC)
PYBLOCK

# setsid detaches from poller process group; nohup survives HUP
nohup bash "$RUNSH" > "$TASK_DIR/${TASK_ID}.runner.log" 2>&1 &
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
