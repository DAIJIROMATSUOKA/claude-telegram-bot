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
RESPONSE_TIMEOUT=600

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# --- Parse args ---
DOMAIN=""
URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --timeout) RESPONSE_TIMEOUT="$2"; shift 2 ;;
    --wt-file) RELAY_WT_FILE="$2"; shift 2 ;;
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
  if [ "$STATUS" = "TOOL_LIMIT" ]; then
    log "TOOL_LIMIT before inject, auto-clicking Continue..."
    bash "$TAB_MANAGER" auto-continue "$WT" 2>/dev/null || true
    READY_COUNT=0
    sleep 5
  elif [ "$STATUS" = "READY" ]; then
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

# --- 5. Inject (with handoff summary prepend) ---
SUMMARY_FILE="/tmp/handoff-summary-${DOMAIN}.md"
if [ -f "$SUMMARY_FILE" ]; then
  PREPEND=$(cat "$SUMMARY_FILE")
  MESSAGE="${PREPEND}

---
${MESSAGE}"
  rm -f "$SUMMARY_FILE"
  log "Prepended handoff summary (${#PREPEND} chars)"
fi
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

# --- 6. Wait response (response-length stability method) ---
# Strategy: read response, wait 8s, read again. If same length -> streaming done.
# This is the only truly reliable method - READY/BUSY state alone is insufficient
# for multi-tool responses where BUSY->READY->BUSY cycles occur between tool calls.
sleep 5
SAW_BUSY=0
ELAPSED=0
PREV_LEN=-1
STABLE_COUNT=0
while [ "$ELAPSED" -lt "$RESPONSE_TIMEOUT" ]; do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null)
  if [ "$STATUS" = "TOOL_LIMIT" ]; then
    log "TOOL_LIMIT detected, auto-clicking Continue..."
    bash "$TAB_MANAGER" auto-continue "$WT" 2>/dev/null || true
    SAW_BUSY=1
    PREV_LEN=-1
    STABLE_COUNT=0
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    continue
  elif [ "$STATUS" = "BUSY" ]; then
    SAW_BUSY=1
    PREV_LEN=-1
    STABLE_COUNT=0
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    continue
  fi
  # STATUS = READY: check response length stability
  if [ "$SAW_BUSY" -eq 1 ] || [ "$ELAPSED" -gt 15 ]; then
    CURR_RESP=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null)
    CURR_LEN=${#CURR_RESP}
    if [ "$CURR_LEN" -gt 30 ] && [ "$CURR_LEN" -eq "$PREV_LEN" ]; then
      STABLE_COUNT=$((STABLE_COUNT + 1))
      if [ "$STABLE_COUNT" -ge 2 ]; then
        log "Response stable: ${CURR_LEN} chars x${STABLE_COUNT}, done"
        break
      fi
    else
      STABLE_COUNT=0
    fi
    PREV_LEN=$CURR_LEN
  fi
  sleep 8
  ELAPSED=$((ELAPSED + 8))
done

# --- 7. Read response (reuse CURR_RESP from stability loop if available) ---
if [ -n "$CURR_RESP" ] && [ "${#CURR_RESP}" -gt 10 ]; then
  RESPONSE="$CURR_RESP"
  log "Reusing stable response from loop (${#RESPONSE} chars)"
else
  RESPONSE=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null)
fi

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
  log "No response"
  echo "ERROR: no response"
  exit 3
fi

log "Response (${#RESPONSE} chars)"
printf "RESPONSE: %s\n" "$RESPONSE"

# --- 8. Token usage check (async handoff trigger) ---
EXCLUDE_FILE="$(dirname "$0")/../autonomous/state/auto-handoff-exclude.txt"
if ! grep -qx "$DOMAIN" "$EXCLUDE_FILE" 2>/dev/null; then
  TOKEN_RAW=$(bash "$TAB_MANAGER" token-estimate "$WT" 2>/dev/null)
  TOKEN_PCT=$(echo "$TOKEN_RAW" | grep -o '"pct":[0-9]*' | grep -o '[0-9]*' 2>/dev/null)
  HANDOFF_LOCK="/tmp/domain-lock-${DOMAIN}.json"
  HANDOFF_COOLDOWN="/tmp/domain-handoff-cooldown-${DOMAIN}"
  if [ "${TOKEN_PCT:-0}" -ge 70 ] && [ ! -f "$HANDOFF_LOCK" ]; then
    # Cooldown: skip if handoff failed recently (1 hour)
    if [ -f "$HANDOFF_COOLDOWN" ]; then
      COOLDOWN_AGE=$(( $(date +%s) - $(stat -f %m "$HANDOFF_COOLDOWN" 2>/dev/null || echo 0) ))
      if [ "$COOLDOWN_AGE" -lt 3600 ]; then
        log "Handoff cooldown active for $DOMAIN (${COOLDOWN_AGE}s < 3600s), skipping"
      else
        rm -f "$HANDOFF_COOLDOWN"
      fi
    fi
    if [ ! -f "$HANDOFF_COOLDOWN" ]; then
      log "Token warning: ${TOKEN_PCT}% -> triggering handoff for $DOMAIN"
      echo "TOKEN_WARNING: ${TOKEN_PCT}%"
      # Fire-and-forget handoff (don't block relay response)
      nohup bash "$SCRIPTS_DIR/domain-handoff.sh" --activate "$DOMAIN" > /tmp/domain-handoff-$DOMAIN.log 2>&1 &
    fi
  fi
fi

exit 0
