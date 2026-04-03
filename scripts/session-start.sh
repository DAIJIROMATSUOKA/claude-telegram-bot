#!/bin/bash
# Session Start - mechanized startup for claude.ai croppy sessions
# Usage: bash scripts/session-start.sh
# Called from exec bridge: exec.sh "bash scripts/session-start.sh" "" 120

cd ~/claude-telegram-bot || exit 1

HANDOFF_FILE="autonomous/state/handoffs/croppy-latest.md"
HAS_HANDOFF=0

if [ -f "$HANDOFF_FILE" ]; then
  HAS_HANDOFF=1
  PROMPT="Read these files and return a concise briefing (max 30 lines):
1. autonomous/state/handoffs/croppy-latest.md - FULL content (session handoff, critical context)
2. autonomous/state/M1.md - STATUS and NEXT_ACTION only
3. autonomous/state/WIP.md - active items only
Focus: handoff STATE, DECISIONS, REMAINING, next actions."
else
  PROMPT="Read these files and return a concise status briefing (max 20 lines):
1. autonomous/state/M1.md - STATUS, NEXT_ACTION, SESSION SUMMARY
2. autonomous/state/WIP.md - active items only
3. /Users/daijiromatsuokam1/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md - last 2-3 sections only
Focus: current STATUS, decisions, stuck items, next actions. Skip missing files."
fi

B64=$(echo -n "$PROMPT" | base64)
RESULT=$(bash scripts/agent-bridge.sh "$B64" read 120 2>&1)

if [ "$HAS_HANDOFF" = "1" ]; then
  echo "HANDOFF LOADED"
else
  echo "NO HANDOFF (fresh start)"
fi
echo "$RESULT"

if [ "$HAS_HANDOFF" = "1" ]; then
  rm -f "$HANDOFF_FILE"
  echo "---"
  echo "handoff file deleted"
fi
