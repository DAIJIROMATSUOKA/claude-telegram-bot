#!/bin/bash
# Agent Bridge - calls Agent SDK (localhost:3847) via base64-encoded prompt
# Usage: agent-bridge.sh <base64-encoded-prompt> [maxTurns] [timeout_seconds]
# Returns: Agent SDK result text

if [ -z "$1" ]; then
  echo "ERROR: usage: agent-bridge.sh <base64-prompt> [maxTurns] [timeout]"
  exit 1
fi

PROMPT=$(echo "$1" | base64 -d 2>/dev/null)
MAX_TURNS="${2:-5}"
TIMEOUT="${3:-120}"

if [ -z "$PROMPT" ]; then
  echo "ERROR: failed to decode base64 prompt"
  exit 1
fi

echo "$PROMPT" | python3 -c "
import json,sys,urllib.request
prompt=sys.stdin.read().strip()
max_turns=int(sys.argv[1]) if len(sys.argv)>1 else 5
timeout=int(sys.argv[2]) if len(sys.argv)>2 else 120

# Force read-only guard for low maxTurns
if max_turns <= 5:
    prompt = 'IMPORTANT: READ ONLY mode. Do NOT run tests, modify files, build, or execute anything. Only read files and return text.\n\n' + prompt

payload=json.dumps({'prompt':prompt,'maxTurns':max_turns}).encode()
req=urllib.request.Request('http://localhost:3847/agent-task',
    data=payload,
    headers={'Content-Type':'application/json'},
    method='POST')
try:
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d=json.loads(r.read())
        if d.get('ok'):
            status='OK' if d.get('success') else 'WARN'
            turns=d.get('turns',0)
            cost=d.get('cost',0)
            dur=d.get('durationMs',0)
            print(f'[{status}] turns={turns} cost=\${cost:.3f} time={dur//1000}s')
            print(d.get('result','(no result)'))
        else:
            print('ERROR:',d.get('error','unknown'))
            sys.exit(1)
except Exception as e:
    print('ERROR:',str(e))
    sys.exit(1)
" "$MAX_TURNS" "$TIMEOUT"
