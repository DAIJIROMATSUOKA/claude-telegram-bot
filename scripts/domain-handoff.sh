#!/bin/bash
# domain-handoff.sh — Perfect handoff with buffer support
# Usage:
#   ./domain-handoff.sh <domain>           # full handoff (auto-triggered at 70% token)
#   ./domain-handoff.sh --warm <domain>    # warm standby (create only, no switch)
#   ./domain-handoff.sh --flush <domain>   # flush buffer only (after external handoff)
#   ./domain-handoff.sh --lock <domain>    # create handoff lock only
#   ./domain-handoff.sh --unlock <domain>  # remove lock + flush buffer
#   ./domain-handoff.sh --activate <domain> # activate warm standby (summary + switch)
#   ./domain-handoff.sh --stateless <domain> # API-only: create chat + switch URL (no Chrome/summary/sleep)

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
if [ "${1:-}" = "--activate" ]; then MODE="activate"; shift; fi
if [ "${1:-}" = "--stateless" ]; then MODE="stateless"; shift; fi

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

# --- Stateless handoff (API only, no Chrome/summary/sleep) ---
if [ "$MODE" = "stateless" ]; then
  # Step 1: Get project UUID from chat-router.py
  PROJ_URL=$($CHAT_ROUTER get-field "$DOMAIN" project_url 2>/dev/null || echo "")
  PROJ_UUID=$(echo "$PROJ_URL" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$PROJ_UUID" ]; then
    PROJ_UUID="019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"  # fallback
  fi
  log "Creating new chat via API (project=$PROJ_UUID)"

  # Step 2: Create new chat via stateless-handoff.py (calls claude.ai internal API)
  NEW_UUID=$(python3 "$SCRIPTS_DIR/stateless-handoff.py" "$PROJ_UUID" 2>/dev/null)
  if [ -z "$NEW_UUID" ]; then
    log "ERROR: failed to create chat"
    bash "$NOTIFY" "❌ $DOMAIN stateless handoff fail"
    exit 1
  fi
  NEW_URL="https://claude.ai/chat/$NEW_UUID"

  # Step 3: Update chat-router.py with new URL
  $CHAT_ROUTER set-url "$DOMAIN" "$NEW_URL"
  log "URL switched: $NEW_URL"

  # Step 4: Notify DJ
  bash "$NOTIFY" "✅ $DOMAIN stateless handoff OK → $NEW_UUID"
  exit 0
fi

# --- Activate warm standby ---
if [ "$MODE" = "activate" ]; then
  # API-based handoff: Agent SDK summary + API chat creation (Chrome-free)
  CURRENT_URL=$($CHAT_ROUTER url "$DOMAIN" 2>/dev/null)
  BOOTSTRAP=$($CHAT_ROUTER bootstrap "$DOMAIN" 2>/dev/null || echo "")
  HISTORY_FILE="$HOME/machinelab-knowledge/${DOMAIN}/history.compressed.md"
  HISTORY=""
  if [ -f "$HISTORY_FILE" ]; then HISTORY=$(cat "$HISTORY_FILE"); fi
  PROJ_UUID=$($CHAT_ROUTER get-field "$DOMAIN" project_uuid 2>/dev/null)
  if [ -z "$PROJ_UUID" ]; then PROJ_UUID="019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"; fi
  OLD_CHAT_ID=$(echo "$CURRENT_URL" | grep -o '[0-9a-f-]\{36\}$')
  TODAY=$(date '+%Y-%m-%d')

  # Lock (per-domain + global relay tab)
  echo "{\"type\":\"handoff\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"domain\":\"$DOMAIN\"}" > "$LOCK_FILE"
  GLOBAL_RELAY_LOCK="$LOCK_DIR/domain-relay-tab.lock"
  echo "{\"domain\":\"$DOMAIN\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"handoff\"}" > "$GLOBAL_RELAY_LOCK"
  trap 'rm -f "$GLOBAL_RELAY_LOCK"' EXIT
  bash "$NOTIFY" "📌 $DOMAIN HANDOFF中(api)"

  # Step 1: Agent SDK generates summary from chatlog
  log "Generating summary via Agent SDK..."
  CHATLOG_FILE=""
  if [ -n "$OLD_CHAT_ID" ]; then
    CHATLOG_FILE=$(python3 -c "
import json, os
state = json.load(open(os.path.expanduser('~/.claude-chatlog-state.json')))
entry = state.get('$OLD_CHAT_ID')
if entry and os.path.exists(entry['filepath']):
    print(entry['filepath'])
" 2>/dev/null)
  fi

  SUMMARY=""
  SKIP_SUMMARY=0
  if [ -n "$CHATLOG_FILE" ]; then
    # Use full chatlog (up to 400 lines) for complete artifact capture
    CHATLOG_TAIL="/tmp/chatlog-tail-$$.md"
    tail -400 "$CHATLOG_FILE" > "$CHATLOG_TAIL"
    CHATLOG_FILE="$CHATLOG_TAIL"

    SUMMARY_PROMPT="Read this chatlog file and create a complete session handoff. The next Claude session MUST be able to continue without searching for anything.

## STATE（現在地 - 最重要）
- 今どのフェーズか（例: 訪問準備中、実装完了、テスト待ち）
- 直近のアクションの完了/未完了状態
- 次セッション開始時に最初にすべきこと

## ARTIFACTS（作成済み成果物 - 全文必須）
セッション中に作成したメッセージ文・コード・ドキュメント・分析結果は全文ここに貼る。
省略・要約しない。次セッションが検索不要になるよう完全な形で記録する。

## DECISIONS + RATIONALE（決定事項と理由）
【決定】内容: 理由・背景を一緒に記録（理由なしの決定記録は不可）

## OPEN QUESTIONS（未解決・前提未確認事項）
次セッションが追跡すべき未解決事項、相手の返答待ち、未確認の前提条件

## REMAINING（未完了タスク）
具体的に何が残っているか

## COMPRESSED CONTEXT（背景）
Legend: D:=decided Q:=open F:=fixed W:=done E:=error
必要最小限の経緯のみ。上記セクションと重複しない。

重要: ARTIFACTSセクションは省略禁止。メッセージ全文・コード全文を必ず含める。
File: $CHATLOG_FILE"
    PROMPT_B64=$(echo -n "$SUMMARY_PROMPT" | base64)
    RESULT=$(bash "$SCRIPTS_DIR/agent-bridge.sh" "$PROMPT_B64" "read" "120" 2>/dev/null)
    if echo "$RESULT" | head -1 | grep -q "\[OK\]"; then
      SUMMARY=$(echo "$RESULT" | tail -n +2)
      log "Summary generated: ${#SUMMARY} chars"
      rm -f "/tmp/chatlog-tail-$$.md"
    else
      rm -f "/tmp/chatlog-tail-$$.md"
      log "Agent SDK summary failed: $(echo "$RESULT" | head -1)"
      SUMMARY="(Agent SDK要約取得失敗。conversation_searchで補完してください)"
    fi
  else
    rm -f "/tmp/chatlog-tail-$$.md"
    log "No chatlog found for $OLD_CHAT_ID"
    SUMMARY="(ChatLog未検出。conversation_searchで補完してください)"
  fi

  # Step 2: Create new chat via API
  TITLE_TEMPLATE=$($CHAT_ROUTER get-field "$DOMAIN" title_template 2>/dev/null || echo "")
  if [ -n "$TITLE_TEMPLATE" ]; then
    NEW_TITLE=$(echo "$TITLE_TEMPLATE" | sed "s/{date}/$TODAY/g")
  else
    NEW_TITLE="${TODAY}_${DOMAIN}"
  fi

  NEW_UUID=$(python3 "$SCRIPTS_DIR/stateless-handoff.py" "$PROJ_UUID" --name "$NEW_TITLE" 2>/dev/null)
  if [ -z "$NEW_UUID" ]; then
    log "ERROR: failed to create chat via API"
    bash "$NOTIFY" "❌ $DOMAIN API handoff fail: chat creation"
    rm -f "$LOCK_FILE" "$GLOBAL_RELAY_LOCK"
    exit 1
  fi
  NEW_URL="https://claude.ai/chat/$NEW_UUID"
  log "New chat created: $NEW_UUID ($NEW_TITLE)"

  # Step 3: Save summary for next relay prepend
  SUMMARY_OUT="/tmp/handoff-summary-${DOMAIN}.md"
  {
    if [ -n "$BOOTSTRAP" ]; then printf '%s

' "$BOOTSTRAP"; fi
    printf '## 前チャットの要約
%s

' "$SUMMARY"
    if [ -n "$HISTORY" ]; then printf '## Compressed History
%s

' "$HISTORY"; fi
    printf '## 前チャットURL
%s

' "$CURRENT_URL"
    printf '以上の文脈を踏まえて、今後のメッセージに対応してください。
'
  } > "$SUMMARY_OUT"
  log "Summary saved: $SUMMARY_OUT ($(wc -c < "$SUMMARY_OUT") bytes)"

  # Flush buffer into summary file
  if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
    COUNT=$(wc -l < "$BUFFER_FILE" | tr -d ' ')
    FLUSH_MSG=$(python3 -c "
import json, sys
entries = []
for line in open('$BUFFER_FILE'):
    try: entries.append(json.loads(line.strip()))
    except: pass
if not entries: sys.exit(0)
lines = []
for i, e in enumerate(entries):
    ts = e.get('ts','')
    if 'T' in ts: ts = ts.split('T')[1][:5]
    lines.append(f'[{i+1}] {ts} — {e["text"]}')
print(f'\n---\n📨 HANDOFF中にDJから届いたメッセージ ({len(entries)}件):\n' + '\n'.join(lines) + '\n\n以上を踏まえて対応してください。')
")
    if [ -n "$FLUSH_MSG" ]; then
      echo "$FLUSH_MSG" >> "$SUMMARY_OUT"
    fi
    rm -f "$BUFFER_FILE"
    log "Buffer flushed ($COUNT msgs) to summary file"
  fi

  # Step 4: Switch URL + rename old chat
  $CHAT_ROUTER archive-url "$DOMAIN" 2>/dev/null
  $CHAT_ROUTER set-url "$DOMAIN" "$NEW_URL" 2>/dev/null
  log "URL switched: $NEW_URL"

  if [ -n "$OLD_CHAT_ID" ]; then
    if [ -n "$TITLE_TEMPLATE" ]; then
      OLD_TITLE=$(echo "$TITLE_TEMPLATE" | sed "s/{date}/$TODAY/g")_archived
    else
      OLD_TITLE="${TODAY}_${DOMAIN}_archived"
    fi
    python3 "$SCRIPTS_DIR/rename-conversation.py" "$OLD_CHAT_ID" "$OLD_TITLE" 2>/dev/null || true
    log "Old chat renamed: $OLD_TITLE"
  fi

  # Save to handoffs dir for session-start auto-pickup
  HANDOFF_DIR="$SCRIPTS_DIR/../autonomous/state/handoffs"
  mkdir -p "$HANDOFF_DIR"
  HANDOFF_TS=$(date "+%Y-%m-%d_%H%M")
  HANDOFF_FILE="$HANDOFF_DIR/croppy-${HANDOFF_TS}.md"
  cp "$SUMMARY_OUT" "$HANDOFF_FILE"
  ln -sf "$(basename "$HANDOFF_FILE")" "$HANDOFF_DIR/croppy-latest.md"
  log "Handoff saved: $HANDOFF_FILE"

  # Cleanup
  rm -f "$LOCK_FILE"
  rm -f "$STANDBY_FILE" 2>/dev/null
  log "Handoff complete (api)"
  echo "HANDOFF_COMPLETE"
  bash "$NOTIFY" "✅ $DOMAIN HANDOFF完了(api) → $NEW_TITLE"
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
GLOBAL_RELAY_LOCK="$LOCK_DIR/domain-relay-tab.lock"
echo "{\"domain\":\"$DOMAIN\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"handoff\"}" > "$GLOBAL_RELAY_LOCK"
trap 'rm -f "$GLOBAL_RELAY_LOCK"' EXIT
log "Handoff lock created (+ global relay lock)"
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
${CURRENT_URL}"$'\n\n'"以上の文脈を踏まえて、今後のメッセージに対応してください。"

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
