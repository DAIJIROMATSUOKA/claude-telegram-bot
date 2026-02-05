#!/bin/bash

# ============================================
# Telegram Bot Status Check
# ============================================

PROJECT_DIR="$HOME/claude-telegram-bot"
PID_FILE="$PROJECT_DIR/.bot.pid"
LOG_FILE="$PROJECT_DIR/logs/bot.log"

echo "📊 Bot Status Check"
echo "===================="
echo ""

# PIDファイルチェック
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  echo "📋 PID File: $PID"

  if kill -0 "$PID" 2>/dev/null; then
    echo "✅ Process Status: Running"
  else
    echo "❌ Process Status: Dead (stale PID file)"
  fi
else
  echo "⚠️  PID File: Not found"
fi

echo ""

# 実際のプロセスチェック
PROCESSES=$(pgrep -f "bun.*index.ts" || true)
if [ -n "$PROCESSES" ]; then
  echo "🟢 Running Processes:"
  pgrep -f "bun.*index.ts" -l
else
  echo "🔴 No running processes found"
fi

echo ""

# 最新ログ
if [ -f "$LOG_FILE" ]; then
  echo "📋 Latest Log (last 10 lines):"
  echo "─────────────────────────────"
  tail -10 "$LOG_FILE"
else
  echo "⚠️  Log file not found"
fi

echo ""
echo "===================="
