#!/bin/bash
# aerox-watch.sh — SteelSeries Aerox 9 Wireless の後継機種が発表されたらTelegram通知。
# 既存 competitor-watch.sh パターン流用（claude CLI web検索 + キャッシュdedup + notify-dj.sh）。
# 従量課金APIは使わない（全てCLI経由）。
# Usage: bash scripts/aerox-watch.sh [--notify]
#   --notify 無し: 標準出力に結果のみ（テスト用）
#   --notify 有り: 後継が新たに確認できた時だけ Telegram 通知
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="$PROJECT_DIR/data/aerox-watch-cache.json"
NOTIFY_FLAG=false
[ "${1:-}" = "--notify" ] && NOTIFY_FLAG=true

mkdir -p "$PROJECT_DIR/data"
[ -f "$CACHE_FILE" ] || echo '{"last_check":"","status":"NONE","detail":""}' > "$CACHE_FILE"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PROMPT='web_searchで「SteelSeries Aerox 9 Wireless successor 後継機種 next generation」を検索し、最新情報を確認して。
SteelSeriesが Aerox 9 Wireless の「後継機種」を公式に発表したかを判定する。
噂・リーク・憶測は除外し、公式発表/正式発売のみを「発表あり」とみなすこと。
出力は厳密に次の2形式のいずれか1行目で始めること:
STATUS: ANNOUNCED — <機種名> | <主な仕様2-3点> | <発表日/出典>
STATUS: NONE
（後継が未発表なら必ず STATUS: NONE のみ。余計な説明は書かない）'

RESULT=$(claude -p "$PROMPT" --dangerously-skip-permissions < /dev/null 2>/dev/null | head -5 || echo "STATUS: ERROR")

# 1行目のSTATUSを抽出
STATUS_LINE=$(echo "$RESULT" | grep -m1 '^STATUS:' || echo "STATUS: ERROR")
STATUS=$(echo "$STATUS_LINE" | sed -E 's/^STATUS:[[:space:]]*([A-Z]+).*/\1/')

PREV_STATUS=$(python3 -c "import json;print(json.load(open('$CACHE_FILE')).get('status','NONE'))" 2>/dev/null || echo "NONE")
PREV_DETAIL=$(python3 -c "import json;print(json.load(open('$CACHE_FILE')).get('detail',''))" 2>/dev/null || echo "")

echo "[$NOW] status=$STATUS (prev=$PREV_STATUS)"
echo "$STATUS_LINE"

# 検索失敗時はキャッシュを汚さず終了（誤通知防止）
if [ "$STATUS" = "ERROR" ]; then
  echo "search failed — cache untouched"; exit 0
fi

# キャッシュ更新（ANNOUNCED詳細も保存）
python3 -c "
import json
c={'last_check':'$NOW','status':'$STATUS','detail':$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$STATUS_LINE")}
json.dump(c, open('$CACHE_FILE','w'), ensure_ascii=False, indent=2)
"

# 通知判定: 新たにANNOUNCED（前回NONE→今回ANNOUNCED、or 内容変化）
if [ "$STATUS" = "ANNOUNCED" ] && { [ "$PREV_STATUS" != "ANNOUNCED" ] || [ "$STATUS_LINE" != "$PREV_DETAIL" ]; }; then
  MSG="🖱️ AEROX 9 後継機 発表検知！\n\n${STATUS_LINE#STATUS: }\n\n(自動ウォッチ / $NOW)"
  echo -e "=== NEW ANNOUNCEMENT ===\n$MSG"
  if [ "$NOTIFY_FLAG" = true ]; then
    bash "$SCRIPT_DIR/notify-dj.sh" "$(echo -e "$MSG")" 2>/dev/null && echo "Telegram通知 送信" || echo "通知失敗"
  fi
else
  echo "変化なし（通知なし）"
fi
