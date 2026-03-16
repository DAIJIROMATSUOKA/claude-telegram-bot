#!/bin/bash
# domain-relay.sh — Domain-routed message relay to specialized chats
# 場所: ~/claude-telegram-bot/scripts/domain-relay.sh
#
# Usage:
#   ./domain-relay.sh "メッセージテキスト"              # 自動ルーティング
#   ./domain-relay.sh --domain fa "PLCの質問"           # ドメイン指定
#   ./domain-relay.sh --url URL "メッセージ"            # URL直接指定
#
# Output (stdout):
#   DOMAIN: <name>
#   URL: <chat_url>
#   WT: <window:tab>
#   RESPONSE: <Claude応答テキスト>
#
# Exit codes:
#   0 = success, 1 = routing fail, 2 = inject fail, 3 = response timeout

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
CHAT_ROUTER="$SCRIPTS_DIR/chat-router.py"
LOG="/tmp/domain-relay.log"
RESPONSE_TIMEOUT=120  # seconds

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# --- Parse args ---
DOMAIN=""
URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --timeout) RESPONSE_TIMEOUT="$2"; shift 2 ;;
    *) break ;;
  esac
done
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "ERROR: usage: domain-relay.sh [--domain X] [--url URL] \"message\""
  exit 1
fi

# --- 1. Route ---
if [ -n "$URL" ]; then
  DOMAIN="direct"
elif [ -n "$DOMAIN" ]; then
  URL=$(python3 "$CHAT_ROUTER" url "$DOMAIN" 2>/dev/null)
  if [ -z "$URL" ] || [ "$URL" = "(未作成)" ]; then
    echo "ERROR: domain '$DOMAIN' has no URL"
    exit 1
  fi
else
  ROUTE_OUTPUT=$(python3 "$CHAT_ROUTER" route "$MESSAGE" 2>/dev/null)
  DOMAIN=$(echo "$ROUTE_OUTPUT" | grep "^DOMAIN:" | sed 's/DOMAIN: //')
  URL=$(echo "$ROUTE_OUTPUT" | grep "^URL:" | sed 's/URL: //')
  if [ -z "$URL" ] || [ "$URL" = "(未作成)" ]; then
    # Fallback to inbox
    DOMAIN="inbox"
    URL=$(python3 "$CHAT_ROUTER" url inbox 2>/dev/null)
    if [ -z "$URL" ] || [ "$URL" = "(未作成)" ]; then
      echo "ERROR: inbox has no URL"
      exit 1
    fi
  fi
fi

log "Route: $DOMAIN -> $URL"
echo "DOMAIN: $DOMAIN"
echo "URL: $URL"

# --- 2. Find or open tab ---
# Search open tabs for this URL
CHAT_ID=$(echo "$URL" | sed 's|.*/chat/||')
FOUND_WT=""

TAB_LIST=$(bash "$TAB_MANAGER" list-all 2>/dev/null)
if [ -n "$TAB_LIST" ]; then
  FOUND_WT=$(echo "$TAB_LIST" | grep "$CHAT_ID" | head -1 | awk -F' \\| ' '{print $1}' | tr -d ' ')
fi

if [ -n "$FOUND_WT" ]; then
  log "Found existing tab: $FOUND_WT"
  WT="$FOUND_WT"
else
  # Open new tab
  log "Opening new tab for $URL"
  BEFORE_INFO=$(osascript 2>/dev/null -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))')
  WIDX=$(echo "$BEFORE_INFO" | awk '{print $1}')
  TBEFORE=$(echo "$BEFORE_INFO" | awk '{print $2}')

  osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  tell window $WIDX
    set newTab to make new tab
    set URL of newTab to \"$URL\"
  end tell
end tell"

  WT="${WIDX}:$((TBEFORE + 1))"
  sleep 8  # 読み込み待ち
  log "Opened tab: $WT"
fi

echo "WT: $WT"

# --- 3. Wait for READY ---
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
  log "Tab not READY (status=$STATUS)"
  echo "ERROR: tab not READY"
  exit 2
fi

# --- 4. Inject message ---
MSG_FILE="/tmp/domain-relay-msg-$$.txt"
printf '%s' "$MESSAGE" > "$MSG_FILE"

INJECT_OUT=$(bash "$TAB_MANAGER" inject-file "$WT" "$MSG_FILE" 2>/dev/null)
rm -f "$MSG_FILE"

if ! echo "$INJECT_OUT" | grep -q "INSERTED"; then
  log "Inject failed: $INJECT_OUT"
  echo "ERROR: inject failed: $INJECT_OUT"
  exit 2
fi

log "Injected message (${#MESSAGE} chars)"

# --- 5. Wait for response (BUSY→READY) ---
sleep 5  # Initial wait for Claude to start processing
SAW_BUSY=0
ELAPSED=0
while [ "$ELAPSED" -lt "$RESPONSE_TIMEOUT" ]; do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
  if [ "$STATUS" = "BUSY" ]; then
    SAW_BUSY=1
  elif [ "$STATUS" = "READY" ] && [ "$SAW_BUSY" -eq 1 ]; then
    # Double-check READY
    sleep 2
    STATUS2=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
    if [ "$STATUS2" = "READY" ]; then
      break
    fi
  elif [ "$STATUS" = "READY" ] && [ "$ELAPSED" -gt 20 ]; then
    # Never saw BUSY but 20s passed → response already done
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

if [ "$ELAPSED" -ge "$RESPONSE_TIMEOUT" ]; then
  log "Response timeout (${RESPONSE_TIMEOUT}s)"
  echo "ERROR: response timeout"
  exit 3
fi

# --- 6. Read response ---
RESPONSE=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null)

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
  log "No response text"
  echo "ERROR: no response"
  exit 3
fi

log "Response received (${#RESPONSE} chars)"
echo "RESPONSE: $RESPONSE"
exit 0
