#!/bin/bash
# cal-briefing.sh - 毎朝7:00 カレンダー+Todoistブリーフィング送信
PROJECT_DIR="$HOME/claude-telegram-bot"
NOTIFY="python3 $PROJECT_DIR/scripts/telegram-notify.py"
OUT_FILE="/tmp/cal-briefing-out.txt"

python3 $PROJECT_DIR/scripts/gcal-todoist.py briefing > "$OUT_FILE" 2>&1
EXIT=$?

if [ $EXIT -eq 0 ] && [ -s "$OUT_FILE" ]; then
  $NOTIFY --file "$OUT_FILE"
else
  $NOTIFY "📅 Cal Briefing 失敗 (exit=$EXIT)"
fi
