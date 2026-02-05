#!/bin/bash

# AI_MEMORY自動整理スクリプト（Claude CLI版）
# 毎日深夜2時にcronで実行される

set -e

# 環境変数
export GOOGLE_CREDENTIALS_PATH="/Users/daijiromatsuokam1/jarvis-docs-credentials.json"
export AI_MEMORY_DOC_ID="172siSUWPADVWBV-IpcnxfjLP_pV5G_gUSmQiGTDbTCc"
export PATH="/Users/daijiromatsuokam1/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 未設定チェック
if [ -z "$AI_MEMORY_DOC_ID" ]; then
  echo "❌ AI_MEMORY_DOC_ID is not set"
  exit 1
fi

# ログディレクトリ
LOG_DIR="/Users/daijiromatsuokam1/.jarvis-logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/memory-organizer.log"

# ログに記録
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
echo "🧹 Memory Organization: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"

# スクリプトのディレクトリに移動
cd /Users/daijiromatsuokam1/claude-telegram-bot

# Bun で実行（CLI版）
bun run src/handlers/memory-organizer-cli.ts >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"

# ログを最新1000行に制限
tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp"
mv "$LOG_FILE.tmp" "$LOG_FILE"
