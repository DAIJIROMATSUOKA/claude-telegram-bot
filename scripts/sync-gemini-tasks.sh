#!/bin/bash

# Gemini Tasks → AI_MEMORY 同期スクリプト
# cronで定期実行される

set -e

# 環境変数
export GOOGLE_CREDENTIALS_PATH="/Users/daijiromatsuokam1/jarvis-docs-credentials.json"
export AI_MEMORY_DOC_ID="172siSUWPADVWBV-IpcnxfjLP_pV5G_gUSmQiGTDbTCc"
export PATH="/Users/daijiromatsuokam1/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# AI_MEMORY_DOC_IDが未設定の場合はエラー
if [ -z "$AI_MEMORY_DOC_ID" ]; then
  echo "❌ AI_MEMORY_DOC_ID is not set"
  echo "Please set it in your environment:"
  echo "  export AI_MEMORY_DOC_ID='your-document-id'"
  exit 1
fi

# ログディレクトリ
LOG_DIR="/Users/daijiromatsuokam1/.jarvis-logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/gemini-tasks-sync.log"

# ログに記録
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
echo "🔄 Gemini Tasks Sync: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"

# スクリプトのディレクトリに移動
cd /Users/daijiromatsuokam1/claude-telegram-bot

# Bun で実行
bun run src/handlers/gemini-tasks-sync.ts >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"

# ログを最新1000行に制限
tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp"
mv "$LOG_FILE.tmp" "$LOG_FILE"
