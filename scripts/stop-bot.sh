#!/bin/bash

# ============================================
# Telegram Bot Stop Script
# ============================================

PROJECT_DIR="$HOME/claude-telegram-bot"
PID_FILE="$PROJECT_DIR/.bot.pid"

echo "🛑 Botを停止中..."

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
fi
