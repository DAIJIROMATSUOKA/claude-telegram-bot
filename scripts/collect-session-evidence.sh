#!/bin/bash
# collect-session-evidence.sh — Gather session artifacts for handoff validation
# Usage: collect-session-evidence.sh <domain> <summary-file>
# Output: /tmp/handoff-commits-<domain>.txt, /tmp/handoff-decisions-<domain>.txt

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CHAT_ROUTER="python3 $SCRIPTS_DIR/chat-router.py"
CHATLOG_BASE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/ChatLogs"

DOMAIN="${1:?Usage: collect-session-evidence.sh <domain> <summary-file>}"
SUMMARY_FILE="${2:?Usage: collect-session-evidence.sh <domain> <summary-file>}"

COMMITS_OUT="/tmp/handoff-commits-${DOMAIN}.txt"
DECISIONS_OUT="/tmp/handoff-decisions-${DOMAIN}.txt"

# --- 1. Git commits since last handoff ---
KNOWLEDGE_BASE="$HOME/machinelab-knowledge"
HISTORY_FILE="$KNOWLEDGE_BASE/${DOMAIN}/history.compressed.md"

LAST_DATE=""
if [ -f "$HISTORY_FILE" ]; then
  LAST_DATE=$(grep -oE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' "$HISTORY_FILE" | tail -1 | sed 's/## //')
fi

if [ -z "$LAST_DATE" ]; then
  SINCE="24 hours ago"
else
  SINCE="${LAST_DATE}T00:00:00"
fi

cd "$HOME/claude-telegram-bot" 2>/dev/null || cd "$HOME"
git log --oneline --since="$SINCE" --no-merges 2>/dev/null > "$COMMITS_OUT"

# --- 2. 【決定】marks from current chatlog ---
DOMAIN_URL=$($CHAT_ROUTER url "$DOMAIN" 2>/dev/null)
CHAT_ID=""
if [ -n "$DOMAIN_URL" ]; then
  CHAT_ID=$(echo "$DOMAIN_URL" | grep -oE '[0-9a-f-]{36}$')
fi

> "$DECISIONS_OUT"

if [ -n "$CHAT_ID" ]; then
  DOMAIN_TITLE=$($CHAT_ROUTER title "$DOMAIN" 2>/dev/null || echo "")

  FOUND_LOG=""
  if [ -d "$CHATLOG_BASE" ]; then
    FOUND_LOG=$(find "$CHATLOG_BASE" -name "*.md" -mtime -7 -exec grep -l "$CHAT_ID" {} \; 2>/dev/null | head -1)

    if [ -z "$FOUND_LOG" ] && [ -n "$DOMAIN_TITLE" ]; then
      TITLE_KEY=$(echo "$DOMAIN_TITLE" | sed 's/^[0-9]*_//' | cut -d'_' -f1)
      if [ -n "$TITLE_KEY" ]; then
        FOUND_LOG=$(find "$CHATLOG_BASE" -name "*.md" -mtime -7 -not -name "*_archived*" | \
          xargs grep -l "$TITLE_KEY" 2>/dev/null | sort | tail -1)
      fi
    fi
  fi

  if [ -n "$FOUND_LOG" ]; then
    python3 - "$FOUND_LOG" "$DECISIONS_OUT" << 'PYEOF'
import sys
infile, outfile = sys.argv[1], sys.argv[2]
lines = open(infile, encoding='utf-8', errors='replace').readlines()
out = []
for i, line in enumerate(lines):
    s = line.strip()
    if not (s.startswith('#') or s.startswith('**') or s.startswith('【決定】')):
        continue
    if '【決定】' not in s:
        continue
    out.append(s)
    for j in range(i+1, min(i+6, len(lines))):
        sl = lines[j].strip()
        if sl and not sl.startswith('#'):
            out.append(sl)
        elif sl.startswith('#'):
            break
with open(outfile, 'w') as f:
    f.write('\n'.join(out) + '\n' if out else '')
PYEOF
  fi
fi

echo "COMMITS=$COMMITS_OUT"
echo "DECISIONS=$DECISIONS_OUT"
echo "COMMIT_COUNT=$(wc -l < "$COMMITS_OUT" | tr -d ' ')"
echo "DECISION_COUNT=$(wc -l < "$DECISIONS_OUT" | tr -d ' ')"
