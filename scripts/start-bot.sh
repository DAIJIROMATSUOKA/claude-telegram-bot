#!/bin/bash

# ============================================
# Telegram Bot Starter Script (LaunchAgent版)
# ============================================
# LaunchAgent (com.jarvis.telegram-bot) 経由でBotを起動する。
# KeepAlive=true により、プロセス死亡時は自動再起動される。
#
# 使い方:
#   ./scripts/start-bot.sh          # 通常起動（LaunchAgent経由）
#   RESTART_REASON="理由" ./scripts/start-bot.sh  # 理由付き再起動
# ============================================

set -e

PROJECT_DIR="$HOME/claude-telegram-bot"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="$PROJECT_DIR/logs"
PLIST_SRC="$PROJECT_DIR/launchagent/com.jarvis.telegram-bot.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.jarvis.telegram-bot.plist"
LABEL="com.jarvis.telegram-bot"
OLD_LABEL="com.claude-telegram-bot"

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

# ============================================
# Telegram通知関数
# ============================================

notify_telegram() {
    local message="$1"
    local token chat_id
    token=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
    chat_id=$(grep '^TELEGRAM_ALLOWED_USERS=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | cut -d',' -f1)

    if [ -n "$token" ] && [ -n "$chat_id" ]; then
        curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
            -d chat_id="$chat_id" \
            -d text="$message" \
            -d parse_mode="HTML" \
            --max-time 5 > /dev/null 2>&1 || true
    fi
}

# ============================================
# STEP 0: 再起動前の通知
# ============================================

if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
    RESTART_REASON="${RESTART_REASON:-手動再起動}"
    RESTART_MSG="🔄 <b>Bot再起動</b>
理由: ${RESTART_REASON}
数秒後に復帰します..."
    echo "📨 再起動前の通知を送信中..."
    notify_telegram "$RESTART_MSG"
    sleep 1
fi

# ============================================
# STEP 1: 既存プロセス・LaunchAgentを停止
# ============================================

echo "🔍 既存のbotプロセスをチェック中..."

# 旧LaunchAgent (com.claude-telegram-bot) を停止・削除
launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/${OLD_LABEL}.plist" 2>/dev/null || true

# 新LaunchAgentを停止
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1

# 旧watchdog (com.croppy.watchdog) を念のため停止（廃止済み）
launchctl bootout "gui/$(id -u)/com.croppy.watchdog" 2>/dev/null || true

# 残存プロセスをGraceful停止
if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
    echo "🔨 残存プロセスを停止..."
    pkill -15 -f "bun.*index.ts" 2>/dev/null || true
    sleep 3
    if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
        pkill -9 -f "bun.*index.ts" 2>/dev/null || true
    fi
fi

# 完全停止を確認（最大10秒待機）
echo "⏳ プロセスの停止を確認中..."
for i in {1..10}; do
    if ! pgrep -f "bun.*index.ts" > /dev/null; then
        echo "✅ 既存プロセス停止完了"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ ERROR: プロセスを停止できませんでした"
        exit 1
    fi
    sleep 1
done

# ============================================
# STEP 2: plistをインストール・起動
# ============================================

# plistをコピー
cp "$PLIST_SRC" "$PLIST_DST"
echo "📋 plistインストール: $PLIST_DST"

# LaunchAgentを登録・起動
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true

# launchctl kickstartで確実に起動
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo "🚀 LaunchAgent起動中..."

# ============================================
# STEP 3: 起動確認
# ============================================

sleep 5

if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
    NEW_PID=$(pgrep -f "bun.*index.ts" | head -1)
    echo ""
    echo "✅ Bot起動成功！ (LaunchAgent管理)"
    echo "   PID: $NEW_PID"
    echo "   Label: $LABEL"
    echo "   Log: $LOG_DIR/bot-launchd.log"
    echo ""
    echo "📊 状態確認: launchctl list $LABEL"
    echo "🛑 停止: launchctl bootout gui/$(id -u)/$LABEL"
    echo "🔄 再起動: launchctl kickstart -k gui/$(id -u)/$LABEL"

    notify_telegram "✅ <b>Bot起動完了</b> (LaunchAgent)
PID: ${NEW_PID}"
else
    echo "❌ ERROR: Botが起動に失敗"
    echo "ログ確認: tail -50 $LOG_DIR/bot-launchd.log"
    tail -20 "$LOG_DIR/bot-launchd.log" 2>/dev/null || true
    tail -20 "$LOG_DIR/bot-launchd.err" 2>/dev/null || true
    exit 1
fi
