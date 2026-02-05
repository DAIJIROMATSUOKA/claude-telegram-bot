#!/bin/bash

# ============================================
# Telegram Bot Starter Script (Enhanced)
# 完全なプロセス管理で409エラーを防止
# ============================================

set -e  # Exit on error

PROJECT_DIR="$HOME/claude-telegram-bot"
PID_FILE="$PROJECT_DIR/.bot.pid"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/bot.log"

cd "$PROJECT_DIR"

# ============================================
# STEP 1: 既存プロセスを完全停止
# ============================================

echo "🔍 既存のbotプロセスをチェック中..."

# 0. LaunchAgentを停止・無効化（最優先）
echo "🛑 LaunchAgentを停止中..."
launchctl unload ~/Library/LaunchAgents/com.claude-telegram-bot.plist 2>/dev/null || true
launchctl disable user/$(id -u)/com.claude-telegram-bot 2>/dev/null || true
sleep 1

# 1. PIDファイルからプロセスを停止
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "📋 PIDファイルから停止: $OLD_PID"
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# 2. パターンマッチで全プロセスを停止
echo "🔨 bun index.ts プロセスを全停止..."
pkill -9 -f "bun.*index.ts" 2>/dev/null || true
pkill -9 -f "claude-telegram-bot" 2>/dev/null || true

# 3. 完全停止を確認（最大10秒待機）
echo "⏳ プロセスの停止を確認中..."
for i in {1..10}; do
  if ! pgrep -f "bun.*index.ts" > /dev/null; then
    echo "✅ 既存プロセス停止完了"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "❌ ERROR: プロセスを停止できませんでした"
    echo "手動確認: ps aux | grep 'bun.*index.ts'"
    exit 1
  fi
  echo "   待機中... ($i/10)"
  sleep 1
done

# ============================================
# STEP 2: ログディレクトリ準備
# ============================================

mkdir -p "$LOG_DIR"

# 古いログをローテーション
if [ -f "$LOG_FILE" ]; then
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  mv "$LOG_FILE" "$LOG_DIR/bot_${TIMESTAMP}.log"
  echo "📦 古いログを保存: bot_${TIMESTAMP}.log"
fi

# ============================================
# STEP 3: DBマイグレーション適用
# ============================================

echo "🗄️  DBマイグレーション確認中..."
if [ -f "migrations/apply-0008.sh" ]; then
  echo "   マイグレーション0008を適用..."
  bash migrations/apply-0008.sh 2>/dev/null || echo "   (スキップ: Memory Gateway未起動)"
fi

# ============================================
# STEP 4: Botを起動
# ============================================

echo "🚀 Botを起動中..."
nohup bun --env-file=.env run src/index.ts > "$LOG_FILE" 2>&1 &
NEW_PID=$!

echo "$NEW_PID" > "$PID_FILE"
echo "📝 PIDファイル作成: $NEW_PID"

# ============================================
# STEP 5: 起動確認（エラー検出付き）
# ============================================

echo "⏳ 起動確認中..."
sleep 3

# プロセスが生きているか確認
if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "❌ ERROR: Botが起動に失敗しました"
  echo ""
  echo "📋 最新のログ:"
  tail -20 "$LOG_FILE"
  exit 1
fi

# 409エラーチェック
if grep -q "409.*Conflict" "$LOG_FILE" 2>/dev/null; then
  echo "⚠️  WARNING: 409エラーを検出しました"
  echo "別のbotインスタンスが起動している可能性があります"
  echo ""
  echo "📋 最新のログ:"
  tail -20 "$LOG_FILE"
  exit 1
fi

# その他の重大エラーチェック
if grep -qi "error\|failed\|crash" "$LOG_FILE" 2>/dev/null; then
  echo "⚠️  WARNING: エラーを検出しました"
  echo ""
  echo "📋 最新のログ:"
  tail -20 "$LOG_FILE"
  # 警告のみで続行
fi

# ============================================
# STEP 6: 成功報告
# ============================================

echo ""
echo "✅ Bot起動成功！"
echo "   PID: $NEW_PID"
echo "   Log: $LOG_FILE"
echo ""
echo "📊 状態確認: ./scripts/status-bot.sh"
echo "🛑 停止: ./scripts/stop-bot.sh"
