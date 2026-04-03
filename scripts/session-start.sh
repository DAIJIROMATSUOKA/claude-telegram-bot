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

echo ''
echo '=== END ==='
