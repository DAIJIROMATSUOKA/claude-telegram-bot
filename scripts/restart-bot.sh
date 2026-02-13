#!/bin/bash
# Jarvis Bot safe restart - 重複インスタンス防止 + Telegram polling reset
# Usage: bash scripts/restart-bot.sh

echo '[restart] Stopping existing bot processes...'

# 1. SIGTERM送信
pkill -f 'bun.*index.ts' 2>/dev/null

# 2. 死ぬまで待つ（最大10秒）
for i in $(seq 1 10); do
  if ! pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
    echo '[restart] All bot processes stopped'
    break
  fi
  echo "[restart] Waiting for process to die... (${i}s)"
  sleep 1
done

# 3. まだ生きてたらSIGKILL
if pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
  echo '[restart] Force killing...'
  pkill -9 -f 'bun.*index.ts' 2>/dev/null
  sleep 1
fi

# 4. Telegram long pollingクリア
#    前プロセスのgetUpdates(timeout=30)がTelegram側に残っている
#    getUpdates(timeout=0)を呼んで強制終了させる
echo '[restart] Clearing stale Telegram long polling...'
source ~/claude-telegram-bot/.env 2>/dev/null
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  for i in $(seq 1 12); do
    RESULT=$(curl -s --max-time 5 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=0&offset=-1" 2>/dev/null)
    IS_OK=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if d.get("ok") else "no")' 2>/dev/null)
    if [ "$IS_OK" = "yes" ]; then
      echo '[restart] Telegram polling cleared'
      break
    fi
    echo "[restart] Telegram still has stale connection, retrying... (${i}/12)"
    sleep 3
  done
else
  echo '[restart] WARNING: TELEGRAM_BOT_TOKEN not found, skipping polling clear'
fi

# 5. 起動
echo '[restart] Starting bot...'
launchctl kickstart -k gui/$(id -u)/com.jarvis.telegram-bot 2>/dev/null

# 6. 起動確認（最大8秒）
for i in $(seq 1 8); do
  sleep 1
  if pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
    PID=$(pgrep -f 'bun.*index.ts')
    COUNT=$(pgrep -f 'bun.*index.ts' | wc -l | tr -d ' ')
    if [ "$COUNT" = "1" ]; then
      echo "[restart] Bot running (PID: $PID, instances: 1)"
      exit 0
    else
      echo "[restart] Multiple instances ($COUNT), killing all and retrying..."
      pkill -9 -f 'bun.*index.ts' 2>/dev/null
      sleep 3
      launchctl kickstart gui/$(id -u)/com.jarvis.telegram-bot 2>/dev/null
      sleep 2
      PID=$(pgrep -f 'bun.*index.ts')
      echo "[restart] Bot restarted (PID: $PID)"
      exit 0
    fi
  fi
done

echo '[restart] Bot failed to start'
exit 1
