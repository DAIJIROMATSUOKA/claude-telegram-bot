#!/bin/bash
# claude-code-progress.sh — Forward Notification hook events to Telegram
INPUT=$(cat)
MSG=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('message', ''))
except:
    pass
" 2>/dev/null)
if [ -n "$MSG" ]; then
  SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
  bash "$SCRIPTS_DIR/notify-dj.sh" "🔔 Claude Code: $MSG" 2>/dev/null
fi
