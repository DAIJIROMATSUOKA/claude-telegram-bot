#!/bin/bash
# Croppy Exec Bridge via bash_tool (multi-machine)
# Usage:
#   bash exec.sh "command" [cwd] [timeout]              # sync to M3 (default)
#   bash exec.sh --target m1 "command" [cwd] [timeout]  # sync to M1
#   bash exec.sh --fire "command" [cwd] [timeout]       # async (return task_id)
#   bash exec.sh --check task_id                        # check result
#   bash exec.sh --notify "command"                     # sync + Telegram notify

GATEWAY="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
PROXY_OPT="--proxy-insecure -x $HTTPS_PROXY"

# --- Mode: --check ---
if [ "$1" = "--check" ]; then
  TASK_ID="$2"
  if [ -z "$TASK_ID" ]; then
    echo "ERROR: usage: exec.sh --check <task_id>"
    exit 1
  fi
  RESULT=$(curl -s $PROXY_OPT "$GATEWAY/v1/exec/result/$TASK_ID" 2>&1)
  echo "$RESULT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
if not d.get("ok"):
    print("ERROR:", d.get("error","unknown"))
    sys.exit(1)
t=d["task"]
s=t.get("status","unknown")
if s=="done":
    print("EXIT:", t.get("result_exit_code","?"))
    print("STDOUT:", t.get("result_stdout",""))
    if t.get("result_stderr","").strip():
        print("STDERR:", t.get("result_stderr",""))
elif s=="processing":
    print("STATUS: still running...")
elif s=="pending":
    print("STATUS: waiting in queue...")
else:
    print("STATUS:", s)
'
  exit 0
fi


# --- Mode: --claude-code ---
if [ "$1" = "--claude-code" ]; then
  shift
  CC_PROMPT="$1"
  CC_CWD="${2:-}"
  CC_MODEL="${3:-sonnet}"
  if [ -z "$CC_PROMPT" ]; then
    echo "ERROR: usage: exec.sh --claude-code \"prompt\" [cwd] [model]"
    exit 1
  fi
  CC_B64=$(echo "$CC_PROMPT" | python3 -c "import base64,sys; print(base64.b64encode(sys.stdin.buffer.read()).decode())")
  CC_CWD_RESOLVED="${CC_CWD:-}"
  if [ -n "$CC_CWD_RESOLVED" ]; then
    CC_CMD="bash scripts/claude-code-spawn.sh '$CC_B64' '$CC_CWD_RESOLVED' '$CC_MODEL'"
  else
    CC_CMD="bash scripts/claude-code-spawn.sh '$CC_B64' \$HOME/claude-telegram-bot '$CC_MODEL'"
  fi
  exec bash "$0" --fire "$CC_CMD"
fi

# --- Mode: --claude-code-status ---
if [ "$1" = "--claude-code-status" ]; then
  exec bash "$0" "bash scripts/claude-code-status.sh"
fi

# --- Parse flags ---
FIRE=0
NOTIFY=0
TARGET="m1"
while [ $# -gt 0 ]; do
  case "$1" in
    --fire) FIRE=1; shift ;;
    --notify) NOTIFY=1; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    *) break ;;
  esac
done

CMD="$1"
# Set home dir based on target
if [ "$TARGET" = "m3" ]; then
  _HOME="/Users/daijiromatsuoka"
else
  _HOME="/Users/daijiromatsuokam1"
fi
CWD="${2:-$_HOME/claude-telegram-bot}"
# Fix container ~ (/root) → target home
CWD=$(echo "$CWD" | sed "s|^/root|$_HOME|;s|^~|$_HOME|")
TIMEOUT="${3:-300}"

if [ -z "$CMD" ]; then
  echo "ERROR: usage: exec.sh [--fire] [--notify] [--target m1|m3] \"command\" [cwd] [timeout]"
  exit 1
fi

# Wrap command with Telegram notification if --notify
if [ "$NOTIFY" = "1" ]; then
  CMD="$CMD"'
_CROPPY_EXIT=$?
source ~/claude-telegram-bot/.env 2>/dev/null
if [ $_CROPPY_EXIT -eq 0 ]; then
  _MSG="Croppy DONE"
else
  _MSG="Croppy FAIL (exit=$_CROPPY_EXIT)"
fi
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$_MSG" > /dev/null 2>&1
exit $_CROPPY_EXIT'
fi

# --fire: wrap command with fork+setsid to survive poller SIGTERM
# Root cause: poller kills entire process group on cleanup.
# nohup only blocks SIGHUP, not SIGTERM. setsid creates new session+group.
# Pattern: fork (parent exits → poller sees "done"), child setsid+exec (survives).
if [ "$FIRE" = "1" ]; then
  CMD_B64=$(echo "$CMD" | python3 -c "import base64,sys; print(base64.b64encode(sys.stdin.buffer.read()).decode())")
  CMD="python3 -c \"
import os,sys,base64
if os.fork()>0: sys.exit(0)
os.setsid()
cmd=base64.b64decode('$CMD_B64').decode()
os.execvp('bash',['bash','-c',cmd])
\""
fi

# Build JSON body via python3 (avoids escaping nightmares)
export CWD TIMEOUT TARGET
JSON_BODY=$(echo "$CMD" | python3 -c "
import json,sys,os
cmd=sys.stdin.read().strip()
body={'command':cmd,'cwd':os.environ.get('CWD','~'),'timeout_seconds':int(os.environ.get('TIMEOUT','300'))}
t=os.environ.get('TARGET','')
if t: body['target']=t
print(json.dumps(body))
")

# Submit
SUBMIT=$(curl -s $PROXY_OPT -X POST "$GATEWAY/v1/exec/submit" \
  -H 'Content-Type: application/json' \
  -d "$JSON_BODY" 2>&1)

TASK_ID=$(echo "$SUBMIT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task_id",""))')

if [ -z "$TASK_ID" ]; then
  echo "ERROR: submit failed: $SUBMIT"
  exit 1
fi

# Fire-and-forget: return task_id and exit
if [ "$FIRE" = "1" ]; then
  echo "TASK_ID: $TASK_ID"
  exit 0
fi

# Sync: poll for result
echo "TASK: $TASK_ID" >&2
for i in $(seq 1 60); do
  sleep 3
  RESULT=$(curl -s $PROXY_OPT "$GATEWAY/v1/exec/result/$TASK_ID" 2>&1)
  STATUS=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task",{}).get("status",""))' 2>/dev/null)
  
  if [ "$STATUS" = "done" ]; then
    echo "$RESULT" | python3 -c '
import json,sys
d=json.load(sys.stdin)["task"]
print("EXIT:", d.get("result_exit_code","?"))
print("STDOUT:", d.get("result_stdout",""))
if d.get("result_stderr","").strip():
    print("STDERR:", d.get("result_stderr",""))
'
    exit 0
  fi
done

echo "TASK_ID: $TASK_ID"
echo "ERROR: timeout waiting (task still running, use --check to poll later)"
exit 1
