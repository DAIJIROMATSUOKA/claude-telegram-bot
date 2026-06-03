#!/bin/bash
# inbox-next.sh — 承認待ち inbox を取得し、会話内ワンタップ承認用の【番号メニュー】を描画。
# Phase 0 / H2 試作: AskUserQuestion(チップ)が使える時はそれ、RC未接続/モバイルバグ時は
# この「番号返信運用」でフォールバック(外部バグ非依存ゴール)。
#
#   inbox-next.sh            # 承認待ち(status=triaged の escalate)を最大5件、番号付きで
#   inbox-next.sh --count N  # 件数
#
# 実行(承認)は croppy が Gmail MCP / gateway action で行う(本スクリプトは取得・描画のみ=非破壊)。
set -uo pipefail
GW="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
N=5; [ "${1:-}" = "--count" ] && N="${2:-5}"
q(){ curl -s --max-time 20 -X POST "$GW/v1/db/query" -H 'Content-Type: application/json' -d "$1"; }

q "{\"sql\":\"SELECT id,source,sender_name,subject,substr(body,1,160) body,triage_action,triage_confidence FROM inbox_triage_queue WHERE status='triaged' AND triage_action='escalate' ORDER BY created_at DESC LIMIT $N\"}" | python3 -c "
import json,sys
rs=json.load(sys.stdin).get('results',[])
ic={'gmail':'📧','line':'💬','slack':'💼'}
if not rs:
    print('承認待ち(escalate)なし'); sys.exit(0)
print(f'📥 承認待ち {len(rs)}件 — 番号で操作を返信(例: 1a=archive / 2d=draft / 3s=show / 4x=delete)')
for i,r in enumerate(rs,1):
    em=ic.get(r.get('source'),'•')
    print(f\"\n{i}. {em} {(r.get('sender_name') or '')[:32]}\")
    print(f\"   件名: {(r.get('subject') or '(なし)')[:56]}\")
    body=(r.get('body') or '').replace(chr(10),' ').strip()[:90]
    print(f\"   本文: {body}\")
    print(f\"   id={r.get('id')}\")
    print(f\"   → [a]rchive  [d]raft返信  [s]how全文  [x]削除\")
print('\n返信形式: <番号><操作> 例 \"1a 3s\"(複数可)。croppyがGmail MCPで実行。')
"
