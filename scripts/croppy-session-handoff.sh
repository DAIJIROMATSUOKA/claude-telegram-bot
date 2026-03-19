#!/bin/bash
# croppy-session-handoff.sh — Croppyセッション自動引き継ぎ
#
# 使い方（exec bridge経由）:
#   bash scripts/croppy-session-handoff.sh "bootstrap prompt内容"
#
# フロー:
#   1. bootstrap promptをファイル保存
#   2. croppy-tab-managerでプロジェクト内新チャット作成
#   3. bootstrap promptをinject（初期メッセージ）
#   4. Telegram通知 + 緊急リマインダー
#   5. 新チャットURLを返す
#
# Croppyが自分のセッション限界前に呼ぶ。

set -uo pipefail

TAB_MANAGER="$HOME/claude-telegram-bot/scripts/croppy-tab-manager.sh"
HANDOFF_DIR="$HOME/claude-telegram-bot/autonomous/state/handoffs"
PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
DATE=$(date '+%Y-%m-%d_%H%M')

mkdir -p "$HANDOFF_DIR"

# Parse flags
AUTO=0
FORCE_TITLE=""
while [ $# -gt 1 ]; do
  case "$1" in
    --auto) AUTO=1; shift ;;
    --title) FORCE_TITLE="$2"; shift 2 ;;
    *) break ;;
  esac
done

BOOTSTRAP="$1"
if [ -z "$BOOTSTRAP" ]; then
  echo "ERROR: usage: croppy-session-handoff.sh [--auto] \"bootstrap prompt\""
  exit 1
fi

# Validate required sections (skip in auto mode)
if [ "$AUTO" = "0" ]; then
  MISSING=""
  echo "$BOOTSTRAP" | grep -qi 'Direction' || MISSING="${MISSING} Direction"
  echo "$BOOTSTRAP" | grep -qi 'Decisions' || MISSING="${MISSING} Decisions"
  echo "$BOOTSTRAP" | grep -qi 'State' || MISSING="${MISSING} State"
  if [ -n "$MISSING" ]; then
    echo "ERROR: bootstrap missing required sections:${MISSING}"
    echo "State must describe CURRENT design state, not just commit list."
    exit 1
  fi
fi

# --- 1. Save bootstrap to file ---
BOOTSTRAP_FILE="$HANDOFF_DIR/croppy-${DATE}.md"
# Auto-prepend timestamp
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S JST')" > "$BOOTSTRAP_FILE"
echo "" >> "$BOOTSTRAP_FILE"
echo "$BOOTSTRAP" >> "$BOOTSTRAP_FILE"
echo "[1/4] Bootstrap saved: $BOOTSTRAP_FILE"

# Also save as latest (next session reads this)
cp "$BOOTSTRAP_FILE" "$HANDOFF_DIR/croppy-latest.md"

# Save current active tab WT (source chat) before opening new tab
SOURCE_WT=$(bash "$TAB_MANAGER" list-all 2>/dev/null | head -1 | awk -F' \| ' '{print $1}' | tr -d ' ')

# --- 2. Create new chat ---
# Use inject-file instead of new-chat's inject-raw (handles long content better)
# Open new tab at project URL
BEFORE_INFO=$(osascript 2>/dev/null -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))')
WIDX=$(echo "$BEFORE_INFO" | awk '{print $1}')
TBEFORE=$(echo "$BEFORE_INFO" | awk '{print $2}')

if [ -z "$WIDX" ] || [ -z "$TBEFORE" ]; then
  echo "ERROR: Chrome not responding"
  exit 1
fi

osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  tell window $WIDX
    set newTab to make new tab
    set URL of newTab to \"$PROJECT_URL\"
  end tell
end tell"

TIDX=$((TBEFORE + 1))
NEW_WT="${WIDX}:${TIDX}"
echo "[2/4] New tab: $NEW_WT (waiting for load...)"

sleep 8

# Wait for stable READY (3 consecutive checks)
READY_COUNT=0
for i in $(seq 1 30); do
  STATUS=$(bash "$TAB_MANAGER" check-status "$NEW_WT" 2>/dev/null)
  if [ "$STATUS" = "READY" ]; then
    READY_COUNT=$((READY_COUNT + 1))
    [ "$READY_COUNT" -ge 3 ] && break
  else
    READY_COUNT=0
  fi
  sleep 2
done

if [ "$READY_COUNT" -lt 3 ]; then
  echo "ERROR: New chat not READY after 60s (status=$STATUS)"
  exit 1
fi

# --- 3. Inject bootstrap ---
bash "$TAB_MANAGER" inject-file "$NEW_WT" "$BOOTSTRAP_FILE" 2>/dev/null
echo "[3/4] Bootstrap injected into $NEW_WT"

# Get conversation URL
sleep 3
CONV_URL=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" || echo "")
echo "[4/5] New chat URL: $CONV_URL"

# --- 4a. Wait for Claude response before rename ---
if [ -n "$FORCE_TITLE" ]; then
  # Wait for Claude to finish responding (and auto-naming)
  for i in $(seq 1 20); do
    STATUS=$(bash "$TAB_MANAGER" check-status "$NEW_WT" 2>/dev/null)
    [ "$STATUS" = "READY" ] && break
    sleep 3
  done
  sleep 2
  RENAME_RESULT=$(bash "$TAB_MANAGER" rename-conversation "$NEW_WT" "$FORCE_TITLE" 2>/dev/null)
  echo "[4a/5] Renamed to: $FORCE_TITLE ($RENAME_RESULT)"
fi

# --- 4b. Notify DJ ---
# Get current chat title (strip date prefix + " - Claude" suffix)
_NOTIFY_TITLE=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return title of tab $TIDX of window $WIDX" || echo "")
_NOTIFY_TITLE=$(echo "$_NOTIFY_TITLE" | sed 's/^\[J-WORKER-[0-9]*\] *//; s/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}_[0-9]\{4\}_//; s/ *- *Claude *$//')
[ -z "$_NOTIFY_TITLE" ] && _NOTIFY_TITLE="Croppyセッション"

# Extract Direction from bootstrap for summary
_NOTIFY_SUMMARY=$(echo "$BOOTSTRAP" | grep -o 'Direction:[^,]*' | head -1 | sed 's/^Direction: *//')
[ -z "$_NOTIFY_SUMMARY" ] && _NOTIFY_SUMMARY="セッション引き継ぎ完了"

# Telegram (HTML format with hyperlink)
source "$HOME/claude-telegram-bot/.env" 2>/dev/null
MSG="🦞 <b>${_NOTIFY_TITLE}</b>
${_NOTIFY_SUMMARY}
<a href=\"${CONV_URL}\">チャットを開く</a>"
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_ALLOWED_USERS" \
  -d "text=$MSG" \
  -d "parse_mode=HTML" \
  -d "disable_web_page_preview=true" > /dev/null 2>&1

# 緊急リマインダー: 無効化（Telegram通知で十分、溜まると一斉発火するため）
# NOW_REMIND=$(date -v+1M '+%Y-%m-%d %H:%M')
# printf '%s\n%s' "$NOW_REMIND" "🦞 新チャットに移動" | shortcuts run '緊急リマインダー' 2>/dev/null || true


# --- 4.5b. Inherit source title (manual handoff only) ---
if [ -n "$SOURCE_WT" ]; then
  SOURCE_TITLE=$(bash "$TAB_MANAGER" get-title "$SOURCE_WT" 2>/dev/null)
  if [ -n "$SOURCE_TITLE" ]; then
    CLEAN_TITLE=$(echo "$SOURCE_TITLE" | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}_[0-9]\{4\}_//; s/ - Claude$//')
    NEW_TITLE="${DATE}_${CLEAN_TITLE}"
    RENAME_RESULT=$(bash "$TAB_MANAGER" rename-conversation "$NEW_WT" "$NEW_TITLE" 2>/dev/null)
    echo "[4.5/4] Renamed: $NEW_TITLE ($RENAME_RESULT)"
  fi
fi

echo "HANDOFF_COMPLETE"
echo "URL: $CONV_URL"
echo "WT: $NEW_WT"
echo "FILE: $BOOTSTRAP_FILE"
