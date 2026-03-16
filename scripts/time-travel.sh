#!/bin/bash
# time-travel.sh — Query any past claude.ai chat by chat_id
# Uses 1-tab navigate method (same relay tab as domain-relay.sh)
#
# Usage:
#   ./time-travel.sh <chat_id> "質問テキスト"
#   ./time-travel.sh --search "キーワード" "質問テキスト"  # search-chatlogs→chat_id→query
#
# Flow: save current URL → navigate to past chat → inject → read-response → navigate back

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
SEARCH_CHATLOGS="$HOME/scripts/search-chatlogs.py"
RELAY_WT_FILE="/tmp/domain-relay-wt"
LOG="/tmp/time-travel.log"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# --- Parse args ---
CHAT_ID=""
QUESTION=""
SEARCH_MODE=0

if [ "${1:-}" = "--search" ]; then
  SEARCH_MODE=1
  KEYWORD="$2"
  QUESTION="$3"
  # Search for chat_id
  SEARCH_OUT=$(python3 "$SEARCH_CHATLOGS" "$KEYWORD" --list 2>/dev/null | head -5)
  # Extract chat_id from frontmatter (first result)
  CHAT_ID=$(echo "$SEARCH_OUT" | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | head -1)
  if [ -z "$CHAT_ID" ]; then
    echo "ERROR: no chat found for keyword '$KEYWORD'"
    echo "SEARCH_OUTPUT: $SEARCH_OUT"
    exit 1
  fi
  echo "FOUND: $CHAT_ID"
else
  CHAT_ID="$1"
  QUESTION="$2"
fi

if [ -z "$CHAT_ID" ] || [ -z "$QUESTION" ]; then
  echo "ERROR: usage: time-travel.sh <chat_id> \"question\""
  echo "       time-travel.sh --search \"keyword\" \"question\""
  exit 1
fi

TARGET_URL="https://claude.ai/chat/$CHAT_ID"
log "Time travel: $CHAT_ID | Q: ${QUESTION:0:60}..."

# --- Get relay tab ---
WT=""
if [ -f "$RELAY_WT_FILE" ]; then
  WT=$(cat "$RELAY_WT_FILE")
fi
if [ -z "$WT" ]; then
  WT=$(bash "$TAB_MANAGER" list-all 2>/dev/null | head -1 | awk -F' \| ' '{print $1}' | tr -d ' ')
fi
if [ -z "$WT" ]; then
  echo "ERROR: no Chrome tab available"
  exit 2
fi

WIDX=$(echo "$WT" | cut -d: -f1)
TIDX=$(echo "$WT" | cut -d: -f2)

# --- Save current URL (to return later) ---
ORIGINAL_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" 2>/dev/null)
log "Original: $ORIGINAL_URL"

# --- Navigate to past chat ---
osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$TARGET_URL\"" 2>/dev/null
sleep 6

# --- Wait READY ---
READY_COUNT=0
for i in $(seq 1 20); do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
  if [ "$STATUS" = "READY" ]; then
    READY_COUNT=$((READY_COUNT + 1))
    [ "$READY_COUNT" -ge 2 ] && break
  else
    READY_COUNT=0
  fi
  sleep 2
done

if [ "$READY_COUNT" -lt 2 ]; then
  log "Past chat not READY ($STATUS)"
  # Navigate back
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$ORIGINAL_URL\"" 2>/dev/null
  echo "ERROR: past chat not READY"
  exit 2
fi

# --- Inject question ---
MSG_FILE="/tmp/time-travel-q-$$.txt"
printf '%s' "$QUESTION" > "$MSG_FILE"
INJECT_OUT=$(bash "$TAB_MANAGER" inject-file "$WT" "$MSG_FILE" 2>/dev/null)
rm -f "$MSG_FILE"

if ! echo "$INJECT_OUT" | grep -q "INSERTED"; then
  log "Inject fail: $INJECT_OUT"
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$ORIGINAL_URL\"" 2>/dev/null
  echo "ERROR: inject failed"
  exit 2
fi
log "Injected"

# --- Wait for response ---
sleep 5
SAW_BUSY=0
ELAPSED=0
RESPONSE_TIMEOUT=120
while [ "$ELAPSED" -lt "$RESPONSE_TIMEOUT" ]; do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
  if [ "$STATUS" = "BUSY" ]; then
    SAW_BUSY=1
  elif [ "$STATUS" = "READY" ] && [ "$SAW_BUSY" -eq 1 ]; then
    sleep 2
    STATUS2=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
    [ "$STATUS2" = "READY" ] && break
  elif [ "$STATUS" = "READY" ] && [ "$ELAPSED" -gt 20 ]; then
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

# --- Read response ---
RESPONSE=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null)
log "Response: ${#RESPONSE} chars"

# --- Navigate back to original ---
if [ -n "$ORIGINAL_URL" ]; then
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$ORIGINAL_URL\"" 2>/dev/null
  log "Returned to: $ORIGINAL_URL"
fi

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
  echo "ERROR: no response from past chat"
  exit 3
fi

echo "CHAT_ID: $CHAT_ID"
echo "RESPONSE: $RESPONSE"
exit 0
