#!/bin/bash
# notify-dj.sh - Send LINE notification to DJ (migrated from Telegram)
MSG="${1:-🦞 作業完了}"
bash ~/scripts/notify-line.sh "$MSG"
