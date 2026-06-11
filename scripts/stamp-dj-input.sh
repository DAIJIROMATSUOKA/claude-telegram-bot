#!/bin/bash
# stamp-dj-input.sh — UserPromptSubmit hook.
# Records DJ's last *real* input time (epoch) for inbox-watch idle-gating.
# Timer/tick wakes carry the INBOX-WATCH-TICK sentinel and are ignored, so idle
# is measured from genuine DJ activity only. Always exit 0 (never block input).
input=$(cat 2>/dev/null)
prompt=$(printf '%s' "$input" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('prompt',''))
except Exception:
    print('')" 2>/dev/null)
STAMP="$HOME/claude-telegram-bot/workspace/.last-dj-ts"
case "$prompt" in
  *INBOX-WATCH-TICK*) ;;                          # timer wake → do not stamp
  *) date +%s > "$STAMP" 2>/dev/null ;;           # real DJ input → stamp
esac
exit 0
