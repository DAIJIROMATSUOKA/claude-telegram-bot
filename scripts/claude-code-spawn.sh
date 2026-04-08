#!/bin/bash
# claude-code-spawn.sh — Fire-and-forget Claude Code headless task
# Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model]
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
CLEANUP="$SCRIPTS_DIR/claude-code-cleanup.py"
TASK_DIR="/tmp/claude-code-tasks"
mkdir -p "$TASK_DIR"

RESUME_SESSION=""
# Parse --resume flag
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == --resume=* ]]; then
    RESUME_TASK_ID="${arg#--resume=}"
    # Look up session_id from that task's done.json
    RESUME_DONE="$TASK_DIR/${RESUME_TASK_ID}.done.json"
    if [ -f "$RESUME_DONE" ]; then
      RESUME_SESSION=$(python3 -c "import json; print(json.load(open('$RESUME_DONE')).get('session_id',''))" 2>/dev/null)
    fi
  else
    ARGS+=("$arg")
  fi
done

PROMPT_B64="${ARGS[0]:?Usage: claude-code-spawn.sh <base64_prompt> [cwd] [model] [--resume=task_id]}"
CWD="${ARGS[1]:-$HOME/claude-telegram-bot}"
# Resolve container paths to M1 home
CWD=$(echo "$CWD" | sed "s|^/root|$HOME|;s|^~|$HOME|")
MODEL="${ARGS[2]:-sonnet}"

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
    "resume_session": "",
}, open(current, "w"), indent=2)
PYMETA

# Write .run.sh file then nohup (avoids bash -c quoting hell + poller pgid kill)
RUNSH="$TASK_DIR/${TASK_ID}.run.sh"
python3 - "$RUNSH" "$CWD" "$MODEL" "$PROMPT_FILE" "$OUTPUT_LOG" "$CURRENT" "$TASK_DIR" "$TASK_ID" "$NOTIFY" "$CLEANUP" "$RESUME_SESSION" << 'PYBLOCK'
import sys, os, stat
runsh, cwd, model, prompt, output, current, task_dir, task_id, notify, cleanup = sys.argv[1:11]
resume_session = sys.argv[11] if len(sys.argv) > 11 else ""
script = f"""#!/bin/bash
trap '' TERM HUP  # Survive SIGTERM from poller process group cleanup
RESUME_SESSION="{resume_session}"
cd "{cwd}" || exit 1

# Safety: detect corrupted git index (worktree kill recovery)
if git rev-parse --git-dir >/dev/null 2>&1; then
  STAGED_DELETES=$(git diff --cached --name-status 2>/dev/null | grep -c "^D" || true)
  if [ "$STAGED_DELETES" -gt 5 ]; then
    echo "SAFETY: $STAGED_DELETES staged deletions in index — resetting to HEAD" >&2
    git reset HEAD -- . >/dev/null 2>&1
  fi
fi

# Enable Agent Teams for batch coordination
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Load API key for headless auth (no OAuth in background)
if [ -f "$HOME/claude-telegram-bot/.env" ]; then
  _AK=$(grep '^#\{0,1\}ANTHROPIC_API_KEY=' "$HOME/claude-telegram-bot/.env" | tail -1 | sed 's/^#//;s/ANTHROPIC_API_KEY=//')
  if [ -n "$_AK" ]; then export ANTHROPIC_API_KEY="$_AK"; fi
fi

# Workaround: claude-code issue #7263 — long prompt as arg causes 0-byte output
RESUME_FLAG=""
if [ -n "${{RESUME_SESSION:-}}" ]; then
  RESUME_FLAG="--continue ${{RESUME_SESSION}}"
fi
claude -p "Read the file {prompt} and follow every instruction in it exactly." \
  --dangerously-skip-permissions --model "{model}" $RESUME_FLAG \
  < /dev/null > "{output}" 2>&1
CC_EXIT=$?

python3 "{cleanup}" "{current}" "{task_dir}" "{task_id}" "$CC_EXIT" "{notify}"
"""
with open(runsh, "w") as f:
    f.write(script)
os.chmod(runsh, os.stat(runsh).st_mode | stat.S_IEXEC)
PYBLOCK

# Verify .run.sh was created by PYBLOCK
if [ ! -f "$RUNSH" ]; then
  echo "ERROR: .run.sh not created by PYBLOCK" >&2
  bash "$NOTIFY" "❌ Claude Code spawn失敗: .run.sh未生成 $TASK_ID"
  exit 1
fi

# start_new_session=True: proven setsid pattern (PROCESS-DETACH.md)
PID=$(python3 -c "
import subprocess, sys
p = subprocess.Popen(
    ['/bin/bash', sys.argv[1]],
    stdin=subprocess.DEVNULL,
    stdout=open(sys.argv[2], 'w'),
    stderr=subprocess.STDOUT,
    start_new_session=True
)
print(p.pid)
" "$RUNSH" "$TASK_DIR/${TASK_ID}.runner.log")

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
