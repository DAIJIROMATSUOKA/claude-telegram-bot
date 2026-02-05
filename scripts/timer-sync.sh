#!/bin/bash
# timer-sync.sh - M3 Agentへタイムトラッキング通知を送信

set -euo pipefail

# 引数チェック
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 {START|STOP|PAUSE} [task_name]"
  exit 1
fi

ACTION="$1"
TASK_NAME="${2:-Unknown Task}"

# .envから認証情報読み込み
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE"
  exit 1
fi

# .envからM3_AGENT_URL, M3_AGENT_TOKENを抽出
M3_AGENT_URL=$(grep '^M3_AGENT_URL=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
M3_AGENT_TOKEN=$(grep '^M3_AGENT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")

if [ -z "$M3_AGENT_URL" ] || [ -z "$M3_AGENT_TOKEN" ]; then
  echo "Error: M3_AGENT_URL or M3_AGENT_TOKEN not set in .env"
  exit 1
fi

# タイムスタンプ
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# 通知メッセージ
case "$ACTION" in
  START)
    MESSAGE="⏱ タスク開始: $TASK_NAME"
    ;;
  STOP)
    MESSAGE="⏹ タスク停止: $TASK_NAME"
    ;;
  PAUSE)
    MESSAGE="⏸ タスク一時停止: $TASK_NAME"
    ;;
  *)
    echo "Error: Invalid action '$ACTION'. Use START, STOP, or PAUSE."
    exit 1
    ;;
esac

# M3 Agentへ通知送信
curl -X POST "$M3_AGENT_URL/notify" \
  -H "Authorization: Bearer $M3_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"$MESSAGE\",\"title\":\"⏱ Time Tracking [$TIMESTAMP]\"}" \
  --silent --show-error --fail

echo "✅ Timer sync: $ACTION - $TASK_NAME"
