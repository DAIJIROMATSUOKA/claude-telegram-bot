#!/bin/bash
# backfill-history.sh — Fill missing compressed history for all domains
#
# Reads chatlog files via Agent SDK (read mode) and generates compressed history.
# Run: nohup bash scripts/backfill-history.sh &> /tmp/backfill-history.log &
#
# Options:
#   --domain <name>   Process single domain only
#   --dry-run         Show what would be processed, don't execute
#   --force           Regenerate even if history exists

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPTS_DIR")"
KNOWLEDGE_BASE="$HOME/machinelab-knowledge"
ROUTING_YAML="$PROJECT_DIR/autonomous/state/chat-routing.yaml"
CHATLOG_STATE="$HOME/.claude-chatlog-state.json"
LOG="/tmp/backfill-history.log"

# Parse args
TARGET_DOMAIN=""
DRY_RUN=0
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) TARGET_DOMAIN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

log "=== Backfill History Start ==="

# Get all domains and their chat histories
python3 << 'PYEOF' > /tmp/backfill-tasks.jsonl
import yaml, json, os

cfg = yaml.safe_load(open(os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")))
state = json.load(open(os.path.expanduser("~/.claude-chatlog-state.json")))

for domain, d in cfg.get("domains", {}).items():
    history = d.get("chat_history", [])
    # Also include current active chat
    current_url = d.get("url", "")
    current_id = current_url.split("/chat/")[-1] if "/chat/" in current_url else ""

    all_chats = []
    for h in history:
        cid = h.get("id", "")
        entry = state.get(cid)
        if entry and os.path.exists(entry.get("filepath", "")):
            all_chats.append({
                "id": cid,
                "created": h.get("created", ""),
                "title": h.get("title", ""),
                "filepath": entry["filepath"],
            })

    # Add current active chat if it has a chatlog
    if current_id and current_id not in [c["id"] for c in all_chats]:
        entry = state.get(current_id)
        if entry and os.path.exists(entry.get("filepath", "")):
            all_chats.append({
                "id": current_id,
                "created": entry.get("updated", "")[:10],
                "title": entry.get("name", ""),
                "filepath": entry["filepath"],
            })

    # Sort by created date
    all_chats.sort(key=lambda x: x.get("created", ""))

    print(json.dumps({
        "domain": domain,
        "chats": all_chats,
        "title_template": d.get("title_template", domain),
    }))
PYEOF

TOTAL=0
PROCESSED=0
SKIPPED=0
ERRORS=0

while IFS= read -r line; do
  DOMAIN=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['domain'])")
  CHATS_JSON=$(echo "$line" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['chats']))")
  CHAT_COUNT=$(echo "$CHATS_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")

  # Filter by target domain if specified
  if [ -n "$TARGET_DOMAIN" ] && [ "$DOMAIN" != "$TARGET_DOMAIN" ]; then
    continue
  fi

  DOMAIN_DIR="$KNOWLEDGE_BASE/$DOMAIN"
  HISTORY_FILE="$DOMAIN_DIR/history.compressed.md"

  # Create directory if missing
  mkdir -p "$DOMAIN_DIR"

  # Skip if history exists and not --force
  if [ -f "$HISTORY_FILE" ] && [ "$FORCE" != "1" ]; then
    log "SKIP $DOMAIN (history exists, use --force to regenerate)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$CHAT_COUNT" = "0" ]; then
    # No chatlogs, create empty history file
    if [ ! -f "$HISTORY_FILE" ]; then
      echo "# Compressed History: $DOMAIN" > "$HISTORY_FILE"
      echo "" >> "$HISTORY_FILE"
      log "CREATED $DOMAIN (empty - no chatlogs available)"
    else
      log "SKIP $DOMAIN (no chatlogs, history file exists)"
    fi
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "WOULD PROCESS $DOMAIN ($CHAT_COUNT chats)"
    TOTAL=$((TOTAL + CHAT_COUNT))
    continue
  fi

  log "PROCESSING $DOMAIN ($CHAT_COUNT chats)"

  # Initialize history file
  if [ "$FORCE" = "1" ] || [ ! -f "$HISTORY_FILE" ]; then
    echo "# Compressed History: $DOMAIN" > "$HISTORY_FILE"
    echo "" >> "$HISTORY_FILE"
  fi

  # Process each chat (JSONL file + python3 per-line to avoid pipe encoding issues)
  CHAT_TASKS="/tmp/backfill-chats-$$.jsonl"
  echo "$CHATS_JSON" | python3 -c "
import json, sys
for c in json.load(sys.stdin):
    print(json.dumps(c, ensure_ascii=False))
" > "$CHAT_TASKS"

  while IFS= read -r CHAT_LINE; do
    CHAT_ID=$(echo "$CHAT_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
    CHAT_DATE=$(echo "$CHAT_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['created'])")
    CHAT_TITLE=$(echo "$CHAT_LINE" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")

    log "  Chat: $CHAT_DATE $CHAT_TITLE"

    # Check if this date already in history (avoid duplicates)
    if grep -q "## $CHAT_DATE" "$HISTORY_FILE" 2>/dev/null && [ "$FORCE" != "1" ]; then
      log "  SKIP (date $CHAT_DATE already in history)"
      continue
    fi

    # Copy chatlog to /tmp with safe ASCII name (avoids Japanese path issues in LaunchAgent)
    CHATLOG_TAIL="/tmp/backfill-chatlog-$$.md"
    echo "$CHAT_LINE" | python3 -c "
import json, sys, shutil
fp = json.load(sys.stdin)['filepath']
try:
    with open(fp, 'r') as f:
        lines = f.readlines()
    with open('/tmp/backfill-chatlog-src.md', 'w') as f:
        f.writelines(lines[-400:])
except Exception as e:
    print(f'COPY_ERROR: {e}', file=sys.stderr)
"
    cp /tmp/backfill-chatlog-src.md "$CHATLOG_TAIL" 2>/dev/null

    if [ ! -s "$CHATLOG_TAIL" ]; then
      log "  SKIP (empty chatlog)"
      rm -f "$CHATLOG_TAIL"
      continue
    fi

    # Agent SDK read: compress chatlog to history format
    COMPRESS_PROMPT="Read this chatlog and create a COMPRESSED history entry. Output ONLY the compressed lines, nothing else.
Format - one line per item, prefix with legend:
D:=decided Q:=open F:=fixed W:=done E:=error

Example output:
W: Implemented triage auto-approve 30min
D: LINE group messages buffered, urgent keywords bypass
F: GAS JSON parse safe handling
E: chatlog-handoff-monitor caused runaway loop, removed
Q: LINE Digest untested

Keep it to 5-15 lines max. Focus on decisions, completed work, errors, and open questions.
File: $CHATLOG_TAIL"

    PROMPT_B64=$(echo -n "$COMPRESS_PROMPT" | base64)
    RESULT=$(bash "$SCRIPTS_DIR/agent-bridge.sh" "$PROMPT_B64" "read" "90" 2>/dev/null)

    if echo "$RESULT" | head -1 | grep -q "\[OK\]"; then
      COMPRESSED=$(echo "$RESULT" | tail -n +2)
      {
        echo ""
        echo "## $CHAT_DATE gen:${CHAT_ID:0:8} ($DOMAIN)"
        echo '```'
        echo "$COMPRESSED"
        echo '```'
      } >> "$HISTORY_FILE"
      log "  OK: appended to history"
      PROCESSED=$((PROCESSED + 1))
    else
      log "  ERROR: Agent SDK failed: $(echo "$RESULT" | head -1)"
      {
        echo ""
        echo "## $CHAT_DATE gen:${CHAT_ID:0:8} ($DOMAIN)"
        echo '```'
        echo "W: (Agent SDK compression failed - chat_id=$CHAT_ID)"
        echo '```'
      } >> "$HISTORY_FILE"
      ERRORS=$((ERRORS + 1))
    fi

    rm -f "$CHATLOG_TAIL"

    # Rate limit: wait between calls to avoid overloading Agent SDK
    sleep 5
  done < "$CHAT_TASKS"
  rm -f "$CHAT_TASKS" /tmp/backfill-chatlog-src.md

  TOTAL=$((TOTAL + CHAT_COUNT))

done < /tmp/backfill-tasks.jsonl

log "=== Backfill Complete: total=$TOTAL processed=$PROCESSED skipped=$SKIPPED errors=$ERRORS ==="
rm -f /tmp/backfill-tasks.jsonl

# Notify DJ
bash "$SCRIPTS_DIR/notify-dj.sh" "📚 History backfill: processed=$PROCESSED skipped=$SKIPPED errors=$ERRORS" 2>/dev/null
