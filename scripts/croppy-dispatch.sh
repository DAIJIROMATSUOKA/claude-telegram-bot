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

todoist_token() {
  python3 -c "import json; print(json.load(open('$HOME/.claude/jarvis_config.json'))['rules']['todoist']['api_token'])"
}

# === /alarm — iPhoneアラーム設定 ===
cmd_alarm() {
  local input="$1"
  input=$(echo "$input" | perl -Mutf8 -CS -pe 's/([０-９])/chr(ord($1)-0xFEE0)/ge; s/：/:/g')

  local time="" label=""

  if [[ "$input" =~ ^([0-9]{1,2})時([0-9]{1,2})分[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:%02d" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
    label="${BASH_REMATCH[3]:-アラーム}"
  elif [[ "$input" =~ ^([0-9]{1,2})時半[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:30" "${BASH_REMATCH[1]}")
    label="${BASH_REMATCH[2]:-アラーム}"
  elif [[ "$input" =~ ^([0-9]{1,2}):([0-9]{2})[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:%s" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
    label="${BASH_REMATCH[3]:-アラーム}"
  elif [[ "$input" =~ ^([0-9]{1,2})時[[:space:]]*(.*) ]]; then
    time=$(printf "%02d:00" "${BASH_REMATCH[1]}")
    label="${BASH_REMATCH[2]:-アラーム}"
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

# === /gpt — ChatGPTに質問 ===
cmd_gpt() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    echo "使い方: /gpt 質問内容"
    return 1
  fi
  echo "$prompt" > /tmp/gpt-prompt.txt
  local result
  result=$(shortcuts run 'Ask ChatGPT' < /tmp/gpt-prompt.txt 2>&1) || true
  rm -f /tmp/gpt-prompt.txt
  if [ -n "$result" ]; then
    echo "💬 ChatGPT:"
    echo "$result"
  else
    echo "❌ ChatGPT: 応答なし（レート制限の可能性）"
  fi
}

# === /gem — Geminiに質問 ===
cmd_gem() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    echo "使い方: /gem 質問内容"
    return 1
  fi
  local result
  result=$(echo "$prompt" | gemini 2>/dev/null) || true
  if [ -n "$result" ]; then
    echo "🔮 Gemini:"
    echo "$result"
  else
    echo "❌ Gemini: 応答なし"
  fi
}

# === /debate — 3AI評議会 ===
cmd_debate() {
  local topic="$1"
  if [ -z "$topic" ]; then
    echo "使い方: /debate 議題"
    return 1
  fi

  echo "⚖️ 3AI評議会開始: $topic"
  echo "---"

  # Round 1: 各AIの初期意見
  echo "🔮 Gemini:"
  local gem1
  gem1=$(echo "以下の議題について簡潔に意見を述べろ（3-5文）: $topic" | gemini 2>/dev/null) || true
  echo "$gem1"
  echo "---"

  echo "💬 ChatGPT:"
  echo "以下の議題について簡潔に意見を述べろ（3-5文）: $topic" > /tmp/gpt-prompt.txt
  local gpt1
  gpt1=$(shortcuts run 'Ask ChatGPT' < /tmp/gpt-prompt.txt 2>&1) || true
  echo "$gpt1"
  echo "---"

  # Round 2: 相互レビュー
  echo "🔮 Gemini (反論):"
  local gem2
  gem2=$(echo "議題: $topic
ChatGPTの意見: $gpt1
上記に対して反論または補足を簡潔に（3-5文）" | gemini 2>/dev/null) || true
  echo "$gem2"
  echo "---"

  echo "💬 ChatGPT (反論):"
  echo "議題: $topic
Geminiの意見: $gem1
上記に対して反論または補足を簡潔に（3-5文）" > /tmp/gpt-prompt.txt
  local gpt2
  gpt2=$(shortcuts run 'Ask ChatGPT' < /tmp/gpt-prompt.txt 2>&1) || true
  echo "$gpt2"
  echo "---"

  # Synthesis
  echo "📋 統合（Gemini）:"
  local synthesis
  synthesis=$(echo "議題: $topic
Gemini初期: $gem1
ChatGPT初期: $gpt1
Gemini反論: $gem2
ChatGPT反論: $gpt2
上記の議論を統合し、結論を簡潔にまとめろ（5-8文）" | gemini 2>/dev/null) || true
  echo "$synthesis"

  rm -f /tmp/gpt-prompt.txt
}

# === /todoist — タスク管理 ===
cmd_todoist() {
  local subcmd=$(echo "$1" | awk '{print $1}')
  local rest=$(echo "$1" | sed "s|^$subcmd *||")
  local token
  token=$(todoist_token 2>/dev/null) || { echo "❌ Todoistトークンが見つからない"; return 1; }

  case "$subcmd" in
    add)
      if [ -z "$rest" ]; then
        echo "使い方: /todoist add タスク内容"
        return 1
      fi
      local result
      result=$(curl -s -X POST "https://api.todoist.com/api/v1/tasks" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"content\":\"$rest\"}")
      local task_id=$(echo "$result" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
      if [ -n "$task_id" ]; then
        echo "✅ タスク追加: $rest"
      else
        echo "❌ 追加失敗: $result"
      fi
      ;;
    done)
      if [ -z "$rest" ]; then
        echo "使い方: /todoist done タスクID"
        return 1
      fi
      curl -s -X POST "https://api.todoist.com/api/v1/tasks/$rest/close" \
        -H "Authorization: Bearer $token" > /dev/null
      echo "✅ タスク完了: $rest"
      ;;
    ""|list)
      curl -s 'https://api.todoist.com/api/v1/tasks?filter=today%7Coverdue' \
        -H "Authorization: Bearer $token" > /tmp/todoist-resp.json
      python3 "$SCRIPT_DIR/todoist-parse.py" 2>/dev/null || echo 'Todoist取得失敗'
      ;;
    reschedule)
      local target_date="$rest"
      if [ -z "$target_date" ]; then
        target_date=$(date -j -v+7d '+%Y-%m-%d')
      fi
      python3 "$SCRIPT_DIR/todoist-reschedule.py" "$target_date"
      ;;
    *)
      echo "使い方: /todoist [list|add|done|reschedule [YYYY-MM-DD]]"
      ;;
  esac
}

# === Dispatch ===
case "$CMD" in
  /alarm)   cmd_alarm "$ARGS" ;;
  /timer)   cmd_timer "$ARGS" ;;
  /status)  cmd_status ;;
  /git)     cmd_git "$ARGS" ;;
  /restart) cmd_restart ;;
  /gpt)     cmd_gpt "$ARGS" ;;
  /gem)     cmd_gem "$ARGS" ;;
  /debate)  cmd_debate "$ARGS" ;;
  /todoist) cmd_todoist "$ARGS" ;;
  /help)
    echo "=== Croppy Commands ==="
    echo "/alarm   6時半 エサ        — iPhoneアラーム"
    echo "/timer   start タスク名    — 時間計測開始/終了"
    echo "/status                    — システム状態"
    echo "/git     status|log|push   — Git操作"
    echo "/restart                   — Bot再起動"
    echo "/gpt     質問              — ChatGPTに質問"
    echo "/gem     質問              — Geminiに質問"
    echo "/debate  議題              — 3AI評議会"
    echo "/todoist [list|add|done|reschedule]   — Todoist管理"
    ;;
  *)
    echo "❌ Unknown command: $CMD"
    echo "使い方: /help でコマンド一覧"
    exit 1
    ;;
esac
