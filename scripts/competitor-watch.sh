#!/bin/bash
# competitor-watch.sh — Monitor competitor activity via web search
# Usage: bash scripts/competitor-watch.sh [--notify]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="$PROJECT_DIR/data/competitor-cache.json"
NOTIFY_FLAG=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notify) NOTIFY_FLAG=true; shift ;;
    *) shift ;;
  esac
done

# Competitors to monitor
COMPETITORS=("VRAIN" "大森機械" "MULTIVAC" "WEBER" "キーエンス")

# Initialize cache if missing
if [ ! -f "$CACHE_FILE" ]; then
  echo '{"last_check":"","results":{}}' > "$CACHE_FILE"
fi

PREV_CACHE=$(cat "$CACHE_FILE")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPORT=""
CHANGES=0

for company in "${COMPETITORS[@]}"; do
  echo "Checking: $company ..."

  # Search for recent news (using claude CLI web search)
  RESULT=$(claude -p "web_searchで「$company 産業機械 最新ニュース」を検索し、直近1ヶ月の主要ニュースを3件以内で箇条書きにまとめて。ニュースがなければ「特になし」と回答。余計な説明不要。" --dangerously-skip-permissions 2>/dev/null | head -20 || echo "検索失敗")

  # Check if result differs from cache
  PREV=$(echo "$PREV_CACHE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('results',{}).get('$company',''))" 2>/dev/null || echo "")

  if [ "$RESULT" != "$PREV" ] && [ "$RESULT" != "検索失敗" ]; then
    CHANGES=$((CHANGES + 1))
    REPORT="${REPORT}【$company】\n$RESULT\n\n"
  fi
done

# Update cache
python3 -c "
import json, sys
cache = json.load(open('$CACHE_FILE'))
cache['last_check'] = '$NOW'
$(for company in "${COMPETITORS[@]}"; do echo "# $company"; done)
json.dump(cache, open('$CACHE_FILE','w'), ensure_ascii=False, indent=2)
"

if [ "$CHANGES" -eq 0 ]; then
  echo "No new competitor activity detected."
  exit 0
fi

echo -e "=== Competitor Watch ($NOW) ===\n"
echo -e "$REPORT"

if [ "$NOTIFY_FLAG" = true ]; then
  bash "$SCRIPT_DIR/notify-dj.sh" "$(echo -e "🔍 Competitor Watch\n$CHANGES社に動きあり\n\n$REPORT")" 2>/dev/null || true
  echo "Notification sent."
fi
