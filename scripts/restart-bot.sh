#!/bin/bash
# Jarvis Bot safe restart - 重複インスタンス防止
# Usage: bash scripts/restart-bot.sh

echo '[restart] Stopping existing bot processes...'

# 1. 全bun index.tsプロセスをkill
pkill -f 'bun.*index.ts' 2>/dev/null

# 2. 死ぬまで待つ（最大10秒）
for i in $(seq 1 10); do
  if ! pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
    echo '[restart] All bot processes stopped'
    break
  fi
  echo "[restart] Waiting... (${i}s)"
  sleep 1
done

# 3. まだ生きてたらSIGKILL
if pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
  echo '[restart] Force killing...'
  pkill -9 -f 'bun.*index.ts' 2>/dev/null
  sleep 1
fi

# 4. launchctl kickstart
echo '[restart] Starting bot...'
launchctl kickstart gui/$(id -u)/com.jarvis.telegram-bot 2>/dev/null

# 5. 起動確認（最大5秒）
for i in $(seq 1 5); do
  sleep 1
  if pgrep -f 'bun.*index.ts' > /dev/null 2>&1; then
    PID=$(pgrep -f 'bun.*index.ts')
    COUNT=$(pgrep -f 'bun.*index.ts' | wc -l | tr -d ' ')
    if [ "$COUNT" = "1" ]; then
      echo "[restart] ✅ Bot running (PID: $PID, instances: 1)"
      exit 0
    else
      echo "[restart] ⚠️ Multiple instances ($COUNT), killing all and retrying..."
      pkill -9 -f 'bun.*index.ts' 2>/dev/null
      sleep 2
      launchctl kickstart gui/$(id -u)/com.jarvis.telegram-bot 2>/dev/null
      sleep 2
      PID=$(pgrep -f 'bun.*index.ts')
      echo "[restart] ✅ Bot restarted (PID: $PID)"
      exit 0
    fi
  fi
done

echo '[restart] ❌ Bot failed to start'
exit 1
