#!/bin/bash

# ============================================
# Telegram Bot Stop Script
# ============================================
# LaunchAgentを停止し、Botプロセスを終了する。
# ============================================

LABEL="com.jarvis.telegram-bot"
PID_LOCK="/tmp/jarvis-bot.pid"

echo "🛑 Botを停止中..."

# 1. LaunchAgentを停止（KeepAliveを無効にして再起動を防ぐ）
echo "📋 LaunchAgent ($LABEL) を停止中..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1

# 2. 残存プロセスをGraceful停止
if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
    echo "🔨 残存プロセスをSIGTERM..."
    pkill -15 -f "bun.*index.ts" 2>/dev/null || true
    sleep 3
    if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
        echo "⚠️ SIGTERM効かず。SIGKILL..."
        pkill -9 -f "bun.*index.ts" 2>/dev/null || true
        sleep 1
    fi
fi

# 3. PID lockファイル削除
rm -f "$PID_LOCK"

# 4. 確認
if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
    echo "❌ 一部のプロセスが残っています："
    pgrep -f "bun.*index.ts" -l
    exit 1
else
    echo "✅ Botを完全に停止しました"
    echo ""
    echo "💡 再起動するには:"
    echo "   ./scripts/start-bot.sh"
fi
