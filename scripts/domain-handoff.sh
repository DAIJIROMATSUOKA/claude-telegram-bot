#!/bin/bash
# domain-handoff.sh — Auto-handoff for specialized domain chats
# When CONV_LIMIT approaches, create new generation + preserve old in chat_history
#
# Usage:
#   ./domain-handoff.sh <domain>              # full handoff (create + switch)
#   ./domain-handoff.sh --warm <domain>        # warm standby (create only, no switch)
#   ./domain-handoff.sh --activate <domain>    # activate standby (switch only, 0.5s)
#
# Flow:
#   1. token-estimate on current domain chat
#   2. If >=70%: create new chat, bootstrap, update URL, save old to chat_history
#   3. Rename new chat with title_template

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
CHAT_ROUTER="$SCRIPTS_DIR/chat-router.py"
RELAY_WT_FILE="/tmp/domain-relay-wt"
PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
LOG="/tmp/domain-handoff.log"
DATE=$(date '+%Y-%m-%d_%H%M')

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# --- Mode parsing ---
MODE="full"
if [ "${1:-}" = "--warm" ]; then
  MODE="warm"
  shift
elif [ "${1:-}" = "--activate" ]; then
  MODE="activate"
  shift
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "ERROR: usage: domain-handoff.sh [--warm|--activate] <domain>"
  exit 1
fi

STANDBY_FILE="/tmp/domain-warm-standby-${DOMAIN}.json"

# --- Mode: --activate (fast path, no Chrome needed) ---
if [ "$MODE" = "activate" ]; then
  if [ ! -f "$STANDBY_FILE" ]; then
    log "No standby for $DOMAIN — falling back to full handoff"
    MODE="full"
  else
    NEW_URL=$(python3 -c "import json; print(json.load(open('$STANDBY_FILE')).get('url',''))" 2>/dev/null)
    NEW_CHAT_ID=$(echo "$NEW_URL" | sed 's|.*/chat/||')
    CURRENT_URL=$(python3 "$CHAT_ROUTER" url "$DOMAIN" 2>/dev/null)
    CURRENT_CHAT_ID=$(echo "$CURRENT_URL" | sed 's|.*/chat/||')

    if [ -z "$NEW_URL" ]; then
      log "Standby file corrupt for $DOMAIN — falling back to full handoff"
      rm -f "$STANDBY_FILE"
      MODE="full"
    else
      # Archive old + set new URL
      python3 "$CHAT_ROUTER" archive-url "$DOMAIN" 2>/dev/null
      python3 "$CHAT_ROUTER" set-url "$DOMAIN" "$NEW_URL" 2>/dev/null
      log "ACTIVATED: $DOMAIN → $NEW_URL"

      # Navigate relay tab
      WT=""
      if [ -f "$RELAY_WT_FILE" ]; then WT=$(cat "$RELAY_WT_FILE"); fi
      if [ -n "$WT" ]; then
        WIDX=$(echo "$WT" | cut -d: -f1)
        TIDX=$(echo "$WT" | cut -d: -f2)
        osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$NEW_URL\"" 2>/dev/null
      fi

      # Telegram notify
      source "$HOME/claude-telegram-bot/.env" 2>/dev/null
      MSG="⚡ $DOMAIN ウォーム切替 (0.5s)
旧: $CURRENT_CHAT_ID
新: $NEW_CHAT_ID"
      bash "$(dirname "$0")/notify-dj.sh" "$MSG"

      rm -f "$STANDBY_FILE"
      echo "ACTIVATE_COMPLETE"
      echo "NEW_URL: $NEW_URL"
      exit 0
    fi
  fi
fi

# Get current URL and title_template
CURRENT_URL=$(python3 "$CHAT_ROUTER" url "$DOMAIN" 2>/dev/null)
TITLE_TEMPLATE=$(python3 "$CHAT_ROUTER" get-field "$DOMAIN" title_template 2>/dev/null)

if [ -z "$CURRENT_URL" ] || [ "$CURRENT_URL" = "(未作成)" ]; then
  echo "ERROR: domain '$DOMAIN' has no URL"
  exit 1
fi

CURRENT_CHAT_ID=$(echo "$CURRENT_URL" | sed 's|.*/chat/||')
log "Handoff: $DOMAIN ($CURRENT_CHAT_ID)"

# --- Get relay tab ---
WT=""
if [ -f "$RELAY_WT_FILE" ]; then
  WT=$(cat "$RELAY_WT_FILE")
fi
if [ -z "$WT" ]; then
  WT=$(bash "$TAB_MANAGER" list-all 2>/dev/null | head -1 | awk -F' \| ' '{print $1}' | tr -d ' ')
fi

# --- 1. Check token usage ---
# Navigate to current domain chat
WIDX=$(echo "$WT" | cut -d: -f1)
TIDX=$(echo "$WT" | cut -d: -f2)
CURRENT_TAB_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" 2>/dev/null)

if ! echo "$CURRENT_TAB_URL" | grep -q "$CURRENT_CHAT_ID"; then
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$CURRENT_URL\"" 2>/dev/null
  sleep 6
fi

TOKEN_JSON=$(bash "$TAB_MANAGER" token-estimate "$WT" 2>/dev/null)
PCT=$(echo "$TOKEN_JSON" | grep -o '"pct":[0-9]*' | grep -o '[0-9]*')
STATUS=$(echo "$TOKEN_JSON" | grep -o '"recommendation":"[^"]*"' | sed 's/"recommendation":"//;s/"//')

log "Token: $PCT% ($STATUS)"
echo "DOMAIN: $DOMAIN"
echo "USAGE: ${PCT}%"
echo "STATUS: $STATUS"

if [ "${PCT:-0}" -lt 70 ] && [ "$MODE" = "full" ] && [ -n "$PCT" ]; then
  echo "NO_HANDOFF_NEEDED"
  exit 0
fi

# --- 2. Create new chat ---
BEFORE_COUNT=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return (count of tabs of window $WIDX)")
osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  tell window $WIDX
    set newTab to make new tab
    set URL of newTab to \"$PROJECT_URL\"
  end tell
end tell"

NEW_TIDX=$((BEFORE_COUNT + 1))
NEW_WT="${WIDX}:${NEW_TIDX}"
log "New tab: $NEW_WT"
sleep 8

# Wait READY
READY_COUNT=0
for i in $(seq 1 30); do
  S=$(bash "$TAB_MANAGER" check-status "$NEW_WT" 2>/dev/null)
  if [ "$S" = "READY" ]; then
    READY_COUNT=$((READY_COUNT + 1))
    [ "$READY_COUNT" -ge 3 ] && break
  else
    READY_COUNT=0
  fi
  sleep 2
done

if [ "$READY_COUNT" -lt 3 ]; then
  log "New chat not READY"
  echo "ERROR: new chat not READY"
  exit 2
fi

# --- 3. Bootstrap via unified generator ---
BOOTSTRAP_SCRIPT="$HOME/scripts/generate-handoff-bootstrap.py"
BOOT_FILE="/tmp/handoff-bootstrap-${DOMAIN}.txt"

log "Generating bootstrap (compress + summarize)..."
python3 "$BOOTSTRAP_SCRIPT" "$DOMAIN" "$CURRENT_CHAT_ID" 2>/dev/null

if [ -s "$BOOT_FILE" ]; then
  bash "$TAB_MANAGER" inject-file "$NEW_WT" "$BOOT_FILE" 2>/dev/null
  log "Bootstrap injected ($(wc -c < "$BOOT_FILE")B)"
  sleep 5
else
  log "WARN: bootstrap generation failed, injecting domain-only fallback"
  FALLBACK=$(python3 "$CHAT_ROUTER" get-field "$DOMAIN" bootstrap 2>/dev/null)
  if [ -n "$FALLBACK" ]; then
    printf '%s' "$FALLBACK" > "$BOOT_FILE"
    bash "$TAB_MANAGER" inject-file "$NEW_WT" "$BOOT_FILE" 2>/dev/null
    sleep 5
  fi
fi
rm -f "$BOOT_FILE"

# --- 4. Get new chat URL ---
sleep 3
NEW_URL=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return URL of tab $NEW_TIDX of window $WIDX")
NEW_CHAT_ID=$(echo "$NEW_URL" | sed 's|.*/chat/||')
log "New URL: $NEW_URL"

# --- 5. Rename new chat ---
if [ -n "$TITLE_TEMPLATE" ]; then
  NEW_TITLE=$(echo "$TITLE_TEMPLATE" | sed "s/{date}/$DATE/g")
  bash "$TAB_MANAGER" rename-conversation "$NEW_WT" "$NEW_TITLE" 2>/dev/null
  log "Renamed: $NEW_TITLE"
fi

# --- 6. Close new tab ---
osascript 2>/dev/null -e "tell application \"Google Chrome\" to close tab $NEW_TIDX of window $WIDX"
log "Closed new tab"

# --- Warm standby: save and exit (no URL switch) ---
if [ "$MODE" = "warm" ]; then
  python3 -c "
import json
info = {'domain': '$DOMAIN', 'url': '$NEW_URL', 'chat_id': '$NEW_CHAT_ID', 'created_at': '$(date -Iseconds)'}
with open('$STANDBY_FILE', 'w') as f:
    json.dump(info, f)
print('SAVED')
"
  log "WARM STANDBY saved: $DOMAIN → $NEW_URL"

  source "$HOME/claude-telegram-bot/.env" 2>/dev/null
  MSG="🟡 $DOMAIN ウォームスタンバイ作成 (${PCT}%)
新チャット待機中: $NEW_CHAT_ID"
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1

  echo "WARM_STANDBY_SAVED"
  echo "NEW_URL: $NEW_URL"
  exit 0
fi

# --- Full mode: update routing + navigate ---
python3 "$CHAT_ROUTER" archive-url "$DOMAIN" 2>/dev/null
python3 "$CHAT_ROUTER" set-url "$DOMAIN" "$NEW_URL" 2>/dev/null
log "Routing updated: $DOMAIN -> $NEW_URL"

echo "$WT" > "$RELAY_WT_FILE"
osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$NEW_URL\"" 2>/dev/null

source "$HOME/claude-telegram-bot/.env" 2>/dev/null
MSG="🔄 $DOMAIN チャット世代交代 (${PCT}%)
旧: $CURRENT_CHAT_ID
新: $NEW_CHAT_ID"
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$MSG" > /dev/null 2>&1

echo "HANDOFF_COMPLETE"
echo "OLD_ID: $CURRENT_CHAT_ID"
echo "NEW_URL: $NEW_URL"
exit 0
