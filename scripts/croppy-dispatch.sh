#!/bin/bash
# Croppy Command Dispatcher - claude.ai から /コマンド を処理
# Usage: bash scripts/croppy-dispatch.sh "/alarm 6時半 エサ"
# M1側にコマンド定義を集約。メモリ消費ゼロで無制限拡張可能。

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

# === Parse input ===
INPUT="$*"
CMD=$(echo "$INPUT" | awk '{print $1}')
ARGS=$(echo "$INPUT" | sed "s|^$CMD *||")

# === Helpers ===
send_telegram() {
  source "$BOT_DIR/.env" 2>/dev/null
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=$1" > /dev/null 2>&1
}

# === /alarm — iPhoneアラーム設定 ===
# 対応形式: 6時半 エサ / 7時10分 起床 / 18:30 ミーティング / 30 休憩(=30分後)
cmd_alarm() {
  local input="$1"
  # 全角→半角
  input=$(echo "$input" | sed 's/[０-９]/\x00/g' | perl -pe 's/([０-９])/chr(ord($1)-0xFEE0)/ge; s/：/:/g')
  
  local time="" label=""

  # Pattern: 6時30分 エサ
  if [[ "$input" =~ ^([0-9]{1,2})時([0-9]{1,2})分[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:%02d" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
    label="${BASH_REMATCH[3]:-アラーム}"
  # Pattern: 6時半 エサ
  elif [[ "$input" =~ ^([0-9]{1,2})時半[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:30" "${BASH_REMATCH[1]}")
    label="${BASH_REMATCH[2]:-アラーム}"
  # Pattern: 18:30 ミーティング
  elif [[ "$input" =~ ^([0-9]{1,2}):([0-9]{2})[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:%s" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
    label="${BASH_REMATCH[3]:-アラーム}"
  # Pattern: 6時 エサ
  elif [[ "$input" =~ ^([0-9]{1,2})時[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:00" "${BASH_REMATCH[1]}")
    label="${BASH_REMATCH[2]:-アラーム}"
  # Pattern: 30 休憩 (=30分後)
  elif [[ "$input" =~ ^([0-9]+)[[:space:]]*(.*) ]]; then
    local mins="${BASH_REMATCH[1]}"
    time=$(date -j -v+${mins}M '+%H:%M')
    label="${BASH_REMATCH[2]:-${mins}分タイマー}"
  else
    echo "❌ 形式エラー。例: /alarm 6時半 エサ / /alarm 18:30 会議 / /alarm 30 休憩"
    return 1
  fi

  [ -z "$label" ] && label="アラーム"
  osascript -e "tell application \"Messages\" to send \"${time}|${label}\" to buddy \"+818065560713\""
  echo "⏰ ${time} アラーム（${label}）セット完了"
}

# === /timer — タスク時間計測 ===
# /timer start タスク名 / /timer end タスク名
cmd_timer() {
  local subcmd=$(echo "$1" | awk '{print $1}')
  local taskname=$(echo "$1" | sed "s|^$subcmd *||")

  case "$subcmd" in
    start|開始)
      python3 ~/task-tracker.py start "$taskname" 2>&1
      ;;
    end|stop|終了)
      python3 ~/task-tracker.py end "$taskname" 2>&1
      ;;
    *)
      # /timer タスク名 開始 パターン
      if [[ "$1" =~ (.+)(開始|終了) ]]; then
        local name="${BASH_REMATCH[1]}"
        local action="${BASH_REMATCH[2]}"
        if [ "$action" = "開始" ]; then
          python3 ~/task-tracker.py start "$name" 2>&1
        else
          python3 ~/task-tracker.py end "$name" 2>&1
        fi
      else
        echo "使い方: /timer start タスク名 / /timer end タスク名"
      fi
      ;;
  esac
}

# === /status — システム状態 ===
cmd_status() {
  echo "=== JARVIS ==="
  pgrep -f "src/index.ts" > /dev/null && echo "Bot: ✅ running (PID $(pgrep -f 'src/index.ts'))" || echo "Bot: ❌ down"
  
  echo "=== Task Poller ==="
  if [ -f /tmp/com.jarvis.task-poller.lock ]; then
    local pid=$(head -1 /tmp/com.jarvis.task-poller.lock | cut -d'|' -f1)
    kill -0 "$pid" 2>/dev/null && echo "Poller: ✅ running (PID $pid)" || echo "Poller: ❌ stale lock"
  else
    echo "Poller: ❌ no lock"
  fi
  
  echo "=== Auto-Kick ==="
  [ -f /tmp/autokick-armed ] && echo "Watchdog: 🟢 armed" || echo "Watchdog: ⚪ disarmed"
  
  echo "=== ComfyUI ==="
  pgrep -f "ComfyUI" > /dev/null && echo "ComfyUI: ✅ running" || echo "ComfyUI: ⚪ not running"
  
  echo "=== Git ==="
  cd "$BOT_DIR" && echo "Branch: $(git branch --show-current)" && echo "Unpushed: $(git log origin/main..HEAD --oneline | wc -l | tr -d ' ') commits"
}

# === /git — クイックgit操作 ===
cmd_git() {
  cd "$BOT_DIR"
  case "$1" in
    status|st) git status -s ;;
    log)       git log --oneline -10 ;;
    push)      git push origin main 2>&1 ;;
    diff)      git diff --stat ;;
    *)         echo "使い方: /git status|log|push|diff" ;;
  esac
}

# === /restart — Bot再起動 ===
cmd_restart() {
  bash "$SCRIPT_DIR/restart-bot.sh" 2>&1
}

# === Dispatch ===
case "$CMD" in
  /alarm)   cmd_alarm "$ARGS" ;;
  /timer)   cmd_timer "$ARGS" ;;
  /status)  cmd_status ;;
  /git)     cmd_git "$ARGS" ;;
  /restart) cmd_restart ;;
  /help)
    echo "=== Croppy Commands ==="
    echo "/alarm  6時半 エサ      — iPhoneアラーム"
    echo "/timer  start タスク名  — 時間計測開始"
    echo "/timer  end タスク名    — 時間計測終了"
    echo "/status                 — システム状態"
    echo "/git    status|log|push — Git操作"
    echo "/restart                — Bot再起動"
    ;;
  *)
    echo "❌ Unknown command: $CMD"
    echo "使い方: /help でコマンド一覧"
    exit 1
    ;;
esac
