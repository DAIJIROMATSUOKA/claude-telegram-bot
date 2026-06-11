#!/bin/bash
# inbox-watch-tick.sh [--init]
# Poll the JARVIS Gateway inbox_triage_queue for items newer than the last-seen marker,
# print them in a compact "📥 新着" form for Croppy to relay into the CODE session.
#   --init : set baseline to the latest item (no backlog dump) and print the last 5 as a snapshot.
# State (last-seen created_at) persists in workspace so it survives across wakeups.
set -uo pipefail
[ -f "$HOME/claude-telegram-bot/workspace/.inbox-watch-STOPPED" ] && { echo "watcher停止中（workspace/.inbox-watch-STOPPED が存在）。再開はこのファイルをrm。"; exit 0; }
GW="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
STATE="$HOME/claude-telegram-bot/workspace/.inbox-watch-last"
q(){ curl -s --max-time 20 -X POST "$GW/v1/db/query" -H 'Content-Type: application/json' -d "$1"; }

LAST=""; [ -f "$STATE" ] && LAST=$(cat "$STATE")
MODE=watch
[ "${1:-}" = "--init" ] && MODE=init
[ -z "$LAST" ] && MODE=init

render() { # stdin = gateway json ; prints formatted rows, last line = MAXTS:<ts>
python3 -c "
import json,sys,datetime
rs=json.load(sys.stdin).get('results',[])
ic={'gmail':'📧','line':'💬','slack':'💼','telegram':'✈️','test':'🧪'}
def jt(s):
    try:
        t=datetime.datetime.fromisoformat(s.replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=9)))
        return t.strftime('%m/%d %H:%M')
    except: return (s or '')[:16]
mx=''
for r in rs:
    mx=max(mx, r.get('created_at') or '')
    em=ic.get(r.get('source'),'•')
    act=r.get('triage_action') or '-'; conf=r.get('triage_confidence')
    flag='🔴要対応' if act=='escalate' else (f'🟢{act}' if act and act!='-' else '⚪未判定')
    snd=(r.get('sender_name') or '')[:30]
    sub=(r.get('subject') or '(件名なし)').replace(chr(10),' ')[:54]
    print(f'{em} {jt(r.get(\"created_at\"))}  {snd}')
    print(f'    {sub}')
    print(f'    → {flag} (conf {conf})')
print('MAXTS:'+mx)
"
}

if [ "$MODE" = "init" ]; then
  echo "=== 📥 inbox スナップショット(直近5件) ==="
  OUT=$(q '{"sql":"SELECT created_at,source,sender_name,subject,triage_action,triage_confidence FROM inbox_triage_queue ORDER BY created_at DESC LIMIT 5"}' | render)
  echo "$OUT" | grep -v '^MAXTS:'
  NEW=$(q '{"sql":"SELECT MAX(created_at) m FROM inbox_triage_queue"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['results'][0]['m'] or '')")
  echo "$NEW" > "$STATE"
  echo "--- 基準時刻セット: $NEW (以降の新着を10分毎に出す) ---"
else
  OUT=$(q "{\"sql\":\"SELECT created_at,source,sender_name,subject,triage_action,triage_confidence FROM inbox_triage_queue WHERE created_at > ? ORDER BY created_at ASC LIMIT 40\",\"params\":[\"$LAST\"]}" | render)
  MAX=$(echo "$OUT" | sed -n 's/^MAXTS://p')
  BODY=$(echo "$OUT" | grep -v '^MAXTS:')
  CNT=$(echo "$BODY" | grep -c '→ ' || true)
  if [ -z "$BODY" ] || [ "$CNT" = "0" ]; then
    echo "=== 📥 新着なし（前回 $LAST 以降） ==="
  else
    echo "=== 📥 新着 ${CNT}件（前回 $LAST 以降） ==="
    echo "$BODY"
    [ -n "$MAX" ] && echo "$MAX" > "$STATE"
  fi
fi
