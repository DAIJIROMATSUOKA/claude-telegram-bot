#!/bin/bash
# Agent Bridge - calls Agent SDK (localhost:3847) via base64-encoded prompt
# Usage: agent-bridge.sh <base64-encoded-prompt> [mode:read|execute] [timeout_seconds]

if [ -z "$1" ]; then
  echo "ERROR: usage: agent-bridge.sh <base64-prompt> [read|execute] [timeout]"
  exit 1
fi

PROMPT=$(echo "$1" | base64 -d 2>/dev/null)
MODE="${2:-read}"
TIMEOUT="${3:-180}"

if [ -z "$PROMPT" ]; then
  echo "ERROR: failed to decode base64 prompt"
  exit 1
fi

echo "$PROMPT" | python3 -c "
import json,sys,urllib.request
prompt=sys.stdin.read().strip()
mode=sys.argv[1] if len(sys.argv)>1 else 'read'
timeout=int(sys.argv[2]) if len(sys.argv)>2 else 180

payload=json.dumps({'prompt':prompt,'mode':mode}).encode()
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
" "$MODE" "$TIMEOUT"
