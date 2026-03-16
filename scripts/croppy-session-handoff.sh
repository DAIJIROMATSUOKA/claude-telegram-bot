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

BOOTSTRAP="$1"
if [ -z "$BOOTSTRAP" ]; then
  echo "ERROR: usage: croppy-session-handoff.sh \"bootstrap prompt\""
  exit 1
fi

# --- 1. Save bootstrap to file ---
BOOTSTRAP_FILE="$HANDOFF_DIR/croppy-${DATE}.md"
echo "$BOOTSTRAP" > "$BOOTSTRAP_FILE"
echo "[1/4] Bootstrap saved: $BOOTSTRAP_FILE"

# Also save as latest (next session reads this)
cp "$BOOTSTRAP_FILE" "$HANDOFF_DIR/croppy-latest.md"

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

# Check if ready
STATUS=$(bash "$TAB_MANAGER" check-status "$NEW_WT" 2>/dev/null)
if [ "$STATUS" != "READY" ]; then
  sleep 5
  STATUS=$(bash "$TAB_MANAGER" check-status "$NEW_WT" 2>/dev/null)
fi

if [ "$STATUS" != "READY" ]; then
  echo "ERROR: New chat not READY (status=$STATUS)"
  exit 1
fi

# --- 3. Inject bootstrap ---
bash "$TAB_MANAGER" inject-file "$NEW_WT" "$BOOTSTRAP_FILE" 2>/dev/null
echo "[3/4] Bootstrap injected into $NEW_WT"

# Get conversation URL
sleep 3
CONV_URL=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" || echo "")
echo "[4/4] New chat URL: $CONV_URL"

# --- 4. Notify DJ ---
# Telegram
source "$HOME/claude-telegram-bot/.env" 2>/dev/null
MSG="🦞 Croppyセッション引き継ぎ完了
新チャット: $CONV_URL
引き継ぎファイル: $BOOTSTRAP_FILE"
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_ALLOWED_USERS" \
  -d "text=$MSG" > /dev/null 2>&1

# 緊急リマインダー
NOW_REMIND=$(date -v+1M '+%Y-%m-%d %H:%M')
printf '%s\n%s' "$NOW_REMIND" "🦞 新チャットに移動" | shortcuts run '緊急リマインダー' 2>/dev/null || true

echo "HANDOFF_COMPLETE"
echo "URL: $CONV_URL"
echo "WT: $NEW_WT"
echo "FILE: $BOOTSTRAP_FILE"
