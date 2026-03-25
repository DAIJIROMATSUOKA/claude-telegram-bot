#!/bin/bash
# domain-handoff.sh — Perfect handoff with buffer support
# Usage:
#   ./domain-handoff.sh <domain>           # full handoff (auto-triggered at 70% token)
#   ./domain-handoff.sh --warm <domain>    # warm standby (create only, no switch)
#   ./domain-handoff.sh --flush <domain>   # flush buffer only (after external handoff)
#   ./domain-handoff.sh --lock <domain>    # create handoff lock only
#   ./domain-handoff.sh --unlock <domain>  # remove lock + flush buffer

# set -e removed: use explicit error checks
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
CHAT_ROUTER="python3 $SCRIPTS_DIR/chat-router.py"
RELAY="$SCRIPTS_DIR/domain-relay.sh"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
source "$HOME/claude-telegram-bot/.env" 2>/dev/null || true

LOCK_DIR="/tmp"

# --- Parse args ---
MODE="full"
if [ "${1:-}" = "--warm" ]; then MODE="warm"; shift; fi
if [ "${1:-}" = "--flush" ]; then MODE="flush"; shift; fi
if [ "${1:-}" = "--lock" ]; then MODE="lock"; shift; fi
if [ "${1:-}" = "--unlock" ]; then MODE="unlock"; shift; fi

DOMAIN="${1:?Usage: domain-handoff.sh [--warm|--flush|--lock|--unlock] <domain>}"
LOCK_FILE="$LOCK_DIR/domain-lock-${DOMAIN}.json"
BUFFER_FILE="$LOCK_DIR/domain-buffer-${DOMAIN}.jsonl"
STANDBY_FILE="$LOCK_DIR/domain-warm-standby-${DOMAIN}.json"

log() { echo "[$(date '+%H:%M:%S')] [Handoff/$DOMAIN] $1"; }

# --- Lock/Unlock only ---
if [ "$MODE" = "lock" ]; then
  echo "{\"type\":\"handoff\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"domain\":\"$DOMAIN\"}" > "$LOCK_FILE"
  bash "$NOTIFY" "📌 $DOMAIN HANDOFF中"
  log "Lock created"
  exit 0
fi

if [ "$MODE" = "unlock" ]; then
  rm -f "$LOCK_FILE"
  bash "$NOTIFY" "✅ $DOMAIN HANDOFF完了"
  log "Lock removed"
  # Flush buffer if any
  if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
    log "Flushing buffer after unlock..."
    # Buffer will be flushed by text.ts on next relay call
  fi
  exit 0
fi

if [ "$MODE" = "flush" ]; then
  if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
    COUNT=$(wc -l < "$BUFFER_FILE" | tr -d ' ')
    log "Flushing $COUNT buffered messages"
    # Format buffer as single message
    FLUSH_MSG=$(python3 -c "
import json, sys
entries = []
for line in open('$BUFFER_FILE'):
    try: entries.append(json.loads(line.strip()))
    except: pass
if not entries:
    print('')
    sys.exit(0)
lines = []
for i, e in enumerate(entries):
    ts = e.get('ts','')
    if 'T' in ts:
        ts = ts.split('T')[1][:5]
    lines.append(f'[{i+1}] {ts} — {e[\"text\"]}')
print(f'📨 バッファ済みメッセージ ({len(entries)}件):\n' + '\n'.join(lines) + '\n\n以上を踏まえて対応してください。')
")
    if [ -n "$FLUSH_MSG" ]; then
      bash "$RELAY" --domain "$DOMAIN" "$FLUSH_MSG" 2>&1 | tail -5
    fi
    rm -f "$BUFFER_FILE"
    log "Buffer flushed"
  else
    log "No buffer to flush"
  fi
  exit 0
fi

# --- Full handoff / Warm standby ---

# Get current URL
CURRENT_URL=$($CHAT_ROUTER url "$DOMAIN" 2>/dev/null)
if [ -z "$CURRENT_URL" ] || [[ "$CURRENT_URL" == *"未作成"* ]]; then
  log "ERROR: no URL for domain $DOMAIN"
  exit 1
fi

# Get project URL
PROJ_URL=$($CHAT_ROUTER get-field "$DOMAIN" project_url 2>/dev/null || echo "")
if [ -z "$PROJ_URL" ]; then
  PROJ_URL="https://claude.ai/project/8730cb30-d97e-4764-92e2-a7b41e1a1bfa"
fi

# Get bootstrap
BOOTSTRAP=$($CHAT_ROUTER bootstrap "$DOMAIN" 2>/dev/null || echo "")
# Get compressed history
HISTORY_FILE="$HOME/machinelab-knowledge/${DOMAIN}/history.compressed.md"
HISTORY=""
if [ -f "$HISTORY_FILE" ]; then
  HISTORY=$(cat "$HISTORY_FILE")
fi

# === Step 1: Create handoff lock ===
echo "{\"type\":\"handoff\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"domain\":\"$DOMAIN\"}" > "$LOCK_FILE"
log "Handoff lock created"
bash "$NOTIFY" "📌 $DOMAIN HANDOFF中"

# === Step 2: Ask old chat for summary ===
log "Requesting summary from old chat..."
SUMMARY_PROMPT='セッション引き継ぎのため、完全な要約を出力して。以下の形式で:

## SESSION SUMMARY
**やったこと:** (箇条書き、具体的commit/修正内容を含む)
**決定事項:** (【決定】マーク付き)
**残課題:** (未完了・未確認事項)
**次のアクション:** (新しい🦞が最初にすべきこと)

## Compressed History
(Legend: D:=decided Q:=open F:=fixed E:=error W:=done)
(今世代の全作業を圧縮記法で)

漏れなく書いて。要約ではなく完全な記録。'

WT=$(cat /tmp/domain-relay-wt 2>/dev/null || echo "1:1")
# Navigate to old chat (direct osascript, no tab-manager navigate needed)
_WIDX=$(echo "$WT" | cut -d: -f1)
_TIDX=$(echo "$WT" | cut -d: -f2)
osascript -e "tell application \"Google Chrome\" to set URL of tab $_TIDX of window $_WIDX to \"$CURRENT_URL\"" 2>/dev/null
sleep 6

# Inject summary request
SUMMARY_FILE="/tmp/handoff-summary-request-$$.txt"
echo "$SUMMARY_PROMPT" > "$SUMMARY_FILE"
bash "$TAB_MANAGER" inject-file "$WT" "$SUMMARY_FILE" 2>/dev/null
rm -f "$SUMMARY_FILE"

# Wait for summary response (double-READY like domain-relay.sh)
log "Waiting for summary response..."
sleep 8
READY_COUNT=0
ELAPSED=0
while [ "$ELAPSED" -lt 180 ]; do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null || echo "UNKNOWN")
  if [ "$STATUS" = "READY" ]; then
    READY_COUNT=$((READY_COUNT + 1))
    if [ "$READY_COUNT" -ge 3 ]; then
      break
    fi
  else
    READY_COUNT=0
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done
# Settle delay to let DOM fully render
sleep 3

# Read summary response
SUMMARY=$(bash "$TAB_MANAGER" read-response "$WT" 2>/dev/null || echo "")
if [ -z "$SUMMARY" ]; then
  log "WARNING: Could not get summary from old chat"
  SUMMARY="(旧チャットからの要約取得失敗。conversation_searchで補完してください)"
fi
log "Got summary: ${#SUMMARY} chars"

# === Step 3: Create new chat ===
log "Creating new chat..."
NEW_CHAT_OUT=$(bash "$TAB_MANAGER" new-chat "セッション引継ぎ: bootstrapを待機してください" 2>/dev/null || echo "")
log "new-chat output: $(echo "$NEW_CHAT_OUT" | head -3)"
sleep 8

# Extract new tab WT from new-chat output (e.g. "WT: 1:15")
NEW_WT=$(echo "$NEW_CHAT_OUT" | grep "^WT:" | awk '{print $2}' | tr -d ' ')
if [ -z "$NEW_WT" ]; then
  log "ERROR: Could not parse WT from new-chat output"
  rm -f "$LOCK_FILE"
  bash "$NOTIFY" "â $DOMAIN HANDOFFå¤±æ: æ°ãã£ããWTåå¾ã¨ã©ã¼"
  exit 1
fi
log "New tab: $NEW_WT"

# Read URL from NEW tab (not relay tab)
NEW_WIDX=$(echo "$NEW_WT" | cut -d: -f1)
NEW_TIDX=$(echo "$NEW_WT" | cut -d: -f2)
NEW_URL=""
for _try in 1 2 3; do
  NEW_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $NEW_TIDX of window $NEW_WIDX" 2>/dev/null || echo "")
  if [ -n "$NEW_URL" ] && [[ "$NEW_URL" == *"/chat/"* ]] && [[ "$NEW_URL" != *"project"* ]]; then
    break
  fi
  sleep 5
done

if [ -z "$NEW_URL" ] || [[ "$NEW_URL" != *"/chat/"* ]]; then
  log "ERROR: Failed to get new chat URL from tab $NEW_WT"
  rm -f "$LOCK_FILE"
  bash "$NOTIFY" "â $DOMAIN HANDOFFå¤±æ: æ°ãã£ããURLåå¾ã¨ã©ã¼"
  exit 1
fi
log "New chat: $NEW_URL"

# Navigate relay tab to new chat (so relay tab = new chat)
_WIDX=$(echo "$WT" | cut -d: -f1)
_TIDX=$(echo "$WT" | cut -d: -f2)
osascript -e "tell application \"Google Chrome\" to set URL of tab $_TIDX of window $_WIDX to \"$NEW_URL\"" 2>/dev/null
sleep 6

# Close the extra tab from new-chat (prevent tab inflation)
osascript -e "tell application \"Google Chrome\" to close tab $NEW_TIDX of window $NEW_WIDX" 2>/dev/null
log "Closed extra tab $NEW_WT"

# === Step 4: Inject bootstrap + summary ===
BOOTSTRAP_FULL=""
if [ -n "$BOOTSTRAP" ]; then
  BOOTSTRAP_FULL="$BOOTSTRAP"$'\n\n'
fi
BOOTSTRAP_FULL="${BOOTSTRAP_FULL}## 前チャットの要約
${SUMMARY}"

if [ -n "$HISTORY" ]; then
  BOOTSTRAP_FULL="${BOOTSTRAP_FULL}"$'\n\n'"## Compressed History
${HISTORY}"
fi

BOOTSTRAP_FULL="${BOOTSTRAP_FULL}"$'\n\n'"## 前チャットURL
${CURRENT_URL}"$'\n\n'"## 必須アクション
conversation_searchで前チャットの最新内容を検索し、上記要約で欠落している詳細を補完せよ。
以上の文脈を踏まえて、今後のメッセージに対応してください。"

BOOT_FILE="/tmp/handoff-bootstrap-$$.txt"
echo "$BOOTSTRAP_FULL" > "$BOOT_FILE"
bash "$TAB_MANAGER" inject-file "$WT" "$BOOT_FILE" 2>/dev/null
rm -f "$BOOT_FILE"
log "Bootstrap injected"

# Wait for new chat to process bootstrap
sleep 5
ELAPSED=0
while [ "$ELAPSED" -lt 120 ]; do
  STATUS=$(bash "$TAB_MANAGER" check-status "$WT" 2>/dev/null || echo "UNKNOWN")
  if [ "$STATUS" = "READY" ]; then
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done
log "New chat ready"

# === Step 5: Switch URL in chat-routing.yaml ===
if [ "$MODE" = "warm" ]; then
  # Warm standby: save URL but don't switch
  echo "{\"url\":\"$NEW_URL\",\"created\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$STANDBY_FILE"
  log "Warm standby saved: $NEW_URL"
  rm -f "$LOCK_FILE"
  bash "$NOTIFY" "🟡 $DOMAIN ウォームスタンバイ作成完了"
  exit 0
fi

# Full handoff: switch URL
# Archive BEFORE set-url (archive_url reads current URL from yaml)
$CHAT_ROUTER archive-url "$DOMAIN" 2>/dev/null
$CHAT_ROUTER set-url "$DOMAIN" "$NEW_URL" 2>/dev/null
log "URL switched: $NEW_URL"

# === Step 6: Rename old chat ===
OLD_CHAT_ID=$(echo "$CURRENT_URL" | grep -o '[0-9a-f-]\{36\}$')
if [ -n "$OLD_CHAT_ID" ]; then
  TODAY=$(date '+%Y-%m-%d')
  TITLE_TEMPLATE=$($CHAT_ROUTER get-field "$DOMAIN" title_template 2>/dev/null || echo "")
  if [ -n "$TITLE_TEMPLATE" ]; then
    OLD_TITLE=$(echo "$TITLE_TEMPLATE" | sed "s/{date}/$TODAY/g")_archived
  else
    OLD_TITLE="${TODAY}_${DOMAIN}_archived"
  fi
  bash "$TAB_MANAGER" rename-conversation "$OLD_CHAT_ID" "$OLD_TITLE" 2>/dev/null || true
  log "Old chat renamed: $OLD_TITLE"
fi

# === Step 7: Flush buffer ===
if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
  COUNT=$(wc -l < "$BUFFER_FILE" | tr -d ' ')
  log "Flushing $COUNT buffered messages to new chat"
  FLUSH_MSG=$(python3 -c "
import json, sys
entries = []
for line in open('$BUFFER_FILE'):
    try: entries.append(json.loads(line.strip()))
    except: pass
if not entries:
    print('')
    sys.exit(0)
lines = []
for i, e in enumerate(entries):
    ts = e.get('ts','')
    if 'T' in ts: ts = ts.split('T')[1][:5]
    lines.append(f'[{i+1}] {ts} — {e[\"text\"]}')
print(f'📨 HANDOFF中にDJから届いたメッセージ ({len(entries)}件):\n' + '\n'.join(lines) + '\n\n以上を踏まえて対応してください。')
")
  if [ -n "$FLUSH_MSG" ]; then
    FLUSH_FILE="/tmp/handoff-flush-$$.txt"
    echo "$FLUSH_MSG" > "$FLUSH_FILE"
    bash "$TAB_MANAGER" inject-file "$WT" "$FLUSH_FILE" 2>/dev/null
    rm -f "$FLUSH_FILE"
  fi
  rm -f "$BUFFER_FILE"
  log "Buffer flushed"
fi

# === Step 8: Remove lock + notify ===
rm -f "$LOCK_FILE"
rm -f "$STANDBY_FILE"
log "Handoff complete"
echo "HANDOFF_COMPLETE"
bash "$NOTIFY" "✅ $DOMAIN HANDOFF完了 → 新チャット"
