#!/bin/bash

# ============================================
# Telegram Bot Stop Script
# ============================================
# watchdogが動いている場合、先にwatchdogも停止する。
# そうしないとwatchdogが即座にBotを再起動してしまう。
# ============================================

PROJECT_DIR="$HOME/claude-telegram-bot"
PID_FILE="$PROJECT_DIR/.bot.pid"
WATCHDOG_LOCK="/tmp/croppy-watchdog.lock"

echo "🛑 Botを停止中..."

# 0. watchdogを先に停止（再起動を防ぐ）
if [ -f "$WATCHDOG_LOCK" ]; then
  WATCHDOG_PID=$(cat "$WATCHDOG_LOCK" 2>/dev/null)
  if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    echo "🐕 Watchdog (PID $WATCHDOG_PID) を停止中..."
    kill "$WATCHDOG_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$WATCHDOG_LOCK"
fi
# watchdog LaunchAgentも停止
launchctl bootout "gui/$(id -u)/com.croppy.watchdog" 2>/dev/null || true

# 1. PIDファイルから停止
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "📋 PID $PID を停止中..."
    kill -9 "$PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# 2. パターンマッチで全プロセスを停止
echo "🔨 全bun index.tsプロセスを停止中..."
pkill -9 -f "bun.*index.ts" 2>/dev/null || true

# 3. 確認
sleep 2
if pgrep -f "bun.*index.ts" > /dev/null; then
  echo "⚠️  一部のプロセスが残っています："
  pgrep -f "bun.*index.ts" -l
  exit 1
else
  echo "✅ Botを完全に停止しました"
  echo ""
  echo "💡 watchdog付きで再起動するには:"
  echo "   ./scripts/setup-watchdog.sh"
fi
