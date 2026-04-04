#!/bin/bash
# claude-code-status.sh — Check Claude Code task status + output tail
TASK_DIR="/tmp/claude-code-tasks"
CURRENT="$TASK_DIR/current.json"

if [ ! -f "$CURRENT" ]; then
  LATEST_DONE=$(ls -t "$TASK_DIR"/*.done.json 2>/dev/null | head -1)
  if [ -n "$LATEST_DONE" ]; then
    echo "NO_RUNNING_TASK"
    echo "LAST_COMPLETED:"
    python3 -c "
import json
d = json.load(open('$LATEST_DONE'))
print(f'  TASK: {d.get(\"task_id\",\"?\")}'  )
print(f'  STATUS: {d.get(\"status\",\"?\")} (exit={d.get(\"exit_code\",\"?\")})')
print(f'  STARTED: {d.get(\"started_at\",\"?\")}'  )
" 2>/dev/null
  else
    echo "NO_TASK: no Claude Code tasks found"
  fi
  exit 0
fi

python3 << 'PYEOF'
import json, os, subprocess, re
from datetime import datetime

d = json.load(open("/tmp/claude-code-tasks/current.json"))
pid = d.get("pid", 0)
alive = False
try:
    os.kill(pid, 0)
    alive = True
except:
    pass

status = "RUNNING" if alive else "FINISHED"
elapsed = ""
started = d.get("started_at", "?")
try:
    start = datetime.fromisoformat(started)
    delta = datetime.now() - start
    mins = int(delta.total_seconds() // 60)
    secs = int(delta.total_seconds() % 60)
    elapsed = f" ({mins}m{secs}s)"
except:
    pass

print(f"STATUS: {status}{elapsed}")
print(f"TASK_ID: {d.get('task_id','?')}")
print(f"PID: {pid}")
print(f"MODEL: {d.get('model','?')}")
print(f"CWD: {d.get('cwd','?')}")
print(f"STARTED: {started}")

log = d.get("output_log", "")
if log and os.path.exists(log):
    size = os.path.getsize(log)
    print(f"LOG_SIZE: {size:,} bytes")
    result = subprocess.run(["tail", "-20", log], capture_output=True, text=True)
    out = result.stdout.strip()
    if out:
        out = re.sub(r'[^\x20-\x7E\n\r\t]', ' ', out)
        print(f"OUTPUT_TAIL:\n{out[:2000]}")
    else:
        print("OUTPUT_TAIL: (empty - still starting up)")
else:
    print("LOG: not found")
PYEOF
