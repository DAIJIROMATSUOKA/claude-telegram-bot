#!/bin/bash
# domain-relay.sh — Domain-routed message relay (single-tab navigate method)
# 場所: ~/claude-telegram-bot/scripts/domain-relay.sh
#
# 設計: 専用リレータブ1本を使い回す。新タブは絶対に開かない。
# URLナビゲートで切り替え→inject→応答取得→次回また同じタブを再利用。
#
# Usage:
#   ./domain-relay.sh "メッセージテキスト"              # 自動ルーティング
#   ./domain-relay.sh --domain fa "PLCの質問"           # ドメイン指定
#   ./domain-relay.sh --url URL "メッセージ"            # URL直接指定

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
CHAT_ROUTER="$SCRIPTS_DIR/chat-router.py"
LOG="/tmp/domain-relay.log"
RELAY_WT_FILE="/tmp/domain-relay-wt"
RESPONSE_TIMEOUT=120

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

# --- 2. Get relay tab (reuse single tab, never open new) ---
get_relay_wt() {
  if [ -f "$RELAY_WT_FILE" ]; then
    local saved_wt
    saved_wt=$(cat "$RELAY_WT_FILE")
    local status
    status=$(bash "$TAB_MANAGER" check-status "$saved_wt" 2>/dev/null)
    if [ -n "$status" ] && [ "$status" != "NO_EDITOR" ] && ! echo "$status" | grep -q "ERROR\|error"; then
      echo "$saved_wt"
      return 0
    fi
  fi
  # Find first claude.ai tab
  local first_tab
  first_tab=$(bash "$TAB_MANAGER" list-all 2>/dev/null | head -1 | awk -F' \\| ' '{print $1}' | tr -d ' ')
  if [ -n "$first_tab" ]; then
    echo "$first_tab" > "$RELAY_WT_FILE"
    echo "$first_tab"
    return 0
  fi
  echo ""
  return 1
}

WT=$(get_relay_wt)
if [ -z "$WT" ]; then
  log "No relay tab"
  echo "ERROR: no Chrome tab available"
  exit 2
fi

# --- 3. Navigate to target URL (skip if already there) ---
WIDX=$(echo "$WT" | cut -d: -f1)
TIDX=$(echo "$WT" | cut -d: -f2)

CURRENT_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" 2>/dev/null)
CHAT_ID=$(echo "$URL" | sed 's|.*/chat/||')

if echo "$CURRENT_URL" | grep -q "$CHAT_ID"; then
  log "Already on target"
else
  log "Navigate $WT -> $URL"
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$URL\"" 2>/dev/null
  sleep 6
fi

echo "WT: $WT"

# --- 4. Wait READY ---
READY_COUNT=0
for i in $(seq 1 30); do
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
  log "Not READY ($STATUS)"
  echo "ERROR: tab not READY"
  exit 2
fi

# --- 5. Inject ---
MSG_FILE="/tmp/domain-relay-msg-$$.txt"
printf '%s' "$MESSAGE" > "$MSG_FILE"
INJECT_OUT=$(bash "$TAB_MANAGER" inject-file "$WT" "$MSG_FILE" 2>/dev/null)
rm -f "$MSG_FILE"

if ! echo "$INJECT_OUT" | grep -q "INSERTED"; then
  log "Inject fail: $INJECT_OUT"
  echo "ERROR: inject failed"
  exit 2
fi
log "Injected (${#MESSAGE} chars)"

# --- 6. Wait response ---
sleep 5
SAW_BUSY=0
ELAPSED=0
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

# --- 7. Read response ---
RESPONSE=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null)

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
  log "No response"
  echo "ERROR: no response"
  exit 3
fi

log "Response (${#RESPONSE} chars)"
echo "RESPONSE: $RESPONSE"
exit 0
