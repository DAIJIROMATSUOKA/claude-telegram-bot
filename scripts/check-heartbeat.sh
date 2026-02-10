#!/bin/bash
# ============================================
# Jarvis Heartbeat Checker
# ============================================
# cronで5分ごとに実行。
# /tmp/jarvis-heartbeat のタイムスタンプが5分以上古い場合、
# Botプロセスをkillする（LaunchAgentが自動再起動する）。
# ============================================

HEARTBEAT_FILE="/tmp/jarvis-heartbeat"
MAX_AGE=180  # 3分（秒）— Botは30秒ごとにheartbeat書込み、5分ごとにログ出力
LOG_FILE="$HOME/claude-telegram-bot/logs/heartbeat-check.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# heartbeatファイルが存在しない場合
if [ ! -f "$HEARTBEAT_FILE" ]; then
    # Botプロセスが動いているか確認
    if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
        log "WARNING: heartbeatファイルが存在しないがBotは稼働中。様子見。"
    fi
    exit 0
fi

# heartbeatのタイムスタンプを読む
LAST_HEARTBEAT=$(cat "$HEARTBEAT_FILE" 2>/dev/null)
if [ -z "$LAST_HEARTBEAT" ]; then
    log "WARNING: heartbeatファイルが空"
    exit 0
fi

NOW=$(date +%s)
AGE=$(( NOW - LAST_HEARTBEAT ))

if [ "$AGE" -ge "$MAX_AGE" ]; then
    log "ALERT: heartbeatが${AGE}秒前で停止。Botをkillする（LaunchAgentが再起動する）"

    # Telegram通知（Botが死ぬ前に送る）
    ENV_FILE="$HOME/claude-telegram-bot/.env"
    TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
    CHAT_ID=$(grep '^TELEGRAM_ALLOWED_USERS=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | cut -d',' -f1)
    if [ -n "$TOKEN" ] && [ -n "$CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            -d chat_id="$CHAT_ID" \
            -d text="⚠️ ハング検知: heartbeatが${AGE}秒停止。自動再起動します..." \
            --max-time 5 > /dev/null 2>&1 || true
    fi

    # Graceful shutdown first (SIGTERM), then SIGKILL if needed
    pkill -15 -f "bun.*index.ts" 2>/dev/null
    sleep 3
    if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
        pkill -9 -f "bun.*index.ts" 2>/dev/null
        log "Forced kill (SIGKILL) after graceful timeout"
    fi

    # heartbeatファイルをリセット（再起動後に新しいタイムスタンプが書かれる）
    rm -f "$HEARTBEAT_FILE"

    log "Bot stopped. LaunchAgentによる自動再起動を待機。"
fi
