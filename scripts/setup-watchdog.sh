#!/bin/bash

# ============================================
# Croppy Watchdog セットアップ
# ============================================
# ワンコマンドでwatchdog LaunchAgentを有効化する。
#
# 使い方:
#   ./scripts/setup-watchdog.sh          # インストール＆有効化
#   ./scripts/setup-watchdog.sh uninstall # 無効化＆削除
# ============================================

set -e

PROJECT_DIR="$HOME/claude-telegram-bot"
PLIST_SRC="$PROJECT_DIR/launchagent/com.croppy.watchdog.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.croppy.watchdog.plist"
OLD_BOT_PLIST="$HOME/Library/LaunchAgents/com.claude-telegram-bot.plist"
LABEL="com.croppy.watchdog"

# --- Uninstall ---
if [ "${1:-}" = "uninstall" ]; then
    echo "Watchdogを無効化中..."
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST_DST"
    rm -f /tmp/croppy-watchdog.lock
    echo "Watchdogを無効化した。Botは手動管理に戻る。"
    exit 0
fi

# --- Install ---
echo "=== Croppy Watchdog セットアップ ==="
echo ""

# 1. 古いBot用LaunchAgentを無効化（watchdogが管理するため不要）
if [ -f "$OLD_BOT_PLIST" ]; then
    echo "1. 古いBot LaunchAgent (com.claude-telegram-bot) を無効化..."
    launchctl bootout "gui/$(id -u)/com.claude-telegram-bot" 2>/dev/null || true
    launchctl unload "$OLD_BOT_PLIST" 2>/dev/null || true
    # 削除はせず無効化だけ（念のためバックアップとして残す）
    echo "   -> 無効化完了（ファイルは残している）"
else
    echo "1. Bot LaunchAgent なし -> スキップ"
fi

# 2. 既存watchdogがあればアンロード
echo "2. 既存watchdogをアンロード中..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f /tmp/croppy-watchdog.lock
sleep 1

# 3. plistをコピー
echo "3. plistをインストール中..."
cp "$PLIST_SRC" "$PLIST_DST"

# 4. ロード
echo "4. watchdogを有効化中..."
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || \
  launchctl load -w "$PLIST_DST" 2>/dev/null || true

# 5. 確認
sleep 2
if launchctl print "gui/$(id -u)/$LABEL" > /dev/null 2>&1; then
    echo ""
    echo "=== セットアップ完了 ==="
    echo ""
    echo "Watchdogが以下を自動管理する:"
    echo "  - 30秒間隔でBotのヘルスチェック"
    echo "  - プロセス死亡 -> 自動再起動"
    echo "  - 409 Conflictエラー -> 自動再起動"
    echo "  - ログ10分無更新 -> 自動再起動"
    echo "  - 1時間あたり最大5回まで再起動（無限ループ防止）"
    echo ""
    echo "ログ確認:"
    echo "  tail -f $PROJECT_DIR/logs/watchdog.log"
    echo ""
    echo "無効化:"
    echo "  ./scripts/setup-watchdog.sh uninstall"
else
    echo "ERROR: watchdogの起動に失敗した"
    exit 1
fi
