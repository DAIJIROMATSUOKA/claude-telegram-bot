#!/bin/bash
# Session Start - fast, no LLM, direct file read with line limits
# Usage: exec.sh "bash scripts/session-start.sh"

cd ~/claude-telegram-bot || exit 1

HANDOFF_FILE="autonomous/state/handoffs/croppy-latest.md"

echo '=== SESSION START ==='
date '+%Y-%m-%d %H:%M JST'

# 1. Handoff (full content if exists, then delete)
if [ -f "$HANDOFF_FILE" ]; then
  echo ''
  echo '=== HANDOFF: YES ==='
  cat "$HANDOFF_FILE"
  rm -f "$HANDOFF_FILE"
  echo ''
  echo '[handoff file consumed and deleted]'
else
  echo ''
  echo '=== HANDOFF: NO ==='
fi

# 2. M1.md (first 10 lines - STATUS/NEXT_ACTION)
echo ''
echo '=== M1 STATE ==='
head -10 autonomous/state/M1.md 2>/dev/null || echo 'NOT FOUND'

# 3. WIP.md (first 20 lines if non-empty)
if [ -s autonomous/state/WIP.md ]; then
  echo ''
  echo '=== WIP ==='
  head -20 autonomous/state/WIP.md 2>/dev/null
else
  echo ''
  echo '=== WIP: EMPTY ==='
fi

# 4. croppy-notes (last 40 lines)
NOTES="/Users/daijiromatsuokam1/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md"
if [ -f "$NOTES" ]; then
  echo ''
  echo '=== CROPPY-NOTES (recent) ==='
  tail -40 "$NOTES"
fi

# 5. Compressed history health check
KNOWLEDGE_BASE="$HOME/machinelab-knowledge"
HISTORY_WARNINGS=""
for hf in "$KNOWLEDGE_BASE"/*/history.compressed.md; do
  [ -f "$hf" ] || continue
  LINES=$(wc -l < "$hf" | tr -d ' ')
  DNAME=$(basename "$(dirname "$hf")")
  if [ "$LINES" -gt 80 ]; then
    HISTORY_WARNINGS="${HISTORY_WARNINGS}⚠️ ${DNAME}: ${LINES}行(閾値80) — 古いエントリのローテーション推奨\n"
  fi
done
TODAY_HANDOFFS=$(grep -c "^## $(date '+%Y-%m-%d')" "$KNOWLEDGE_BASE"/*/history.compressed.md 2>/dev/null | awk -F: '{s+=$NF}END{print s}')
if [ "${TODAY_HANDOFFS:-0}" -gt 3 ]; then
  HISTORY_WARNINGS="${HISTORY_WARNINGS}⚠️ 本日handoff ${TODAY_HANDOFFS}回 — セッション寿命に問題あり\n"
fi
if [ -n "$HISTORY_WARNINGS" ]; then
  echo ''
  echo '=== HEALTH CHECK ==='
  printf "$HISTORY_WARNINGS"
fi

echo ''
echo '=== END ==='
