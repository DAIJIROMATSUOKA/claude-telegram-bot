#!/bin/bash
# JARVIS Daily Journal Generator (Enhanced)
# Runs via launchd nightly at 23:55, saves to Dropbox for Croppy to read
# Also merges croppy-notes.md if present

set -euo pipefail

DATE="${1:-$(date +%Y-%m-%d)}"
BOT_DIR="$HOME/claude-telegram-bot"
JOURNAL_DIR="/Users/daijiromatsuokam1/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal"
OUTPUT="$JOURNAL_DIR/$DATE.md"
CROPPY_NOTES="$JOURNAL_DIR/croppy-notes.md"
BOT_LOG="$BOT_DIR/logs/bot-launchd.log"

mkdir -p "$JOURNAL_DIR"
cd "$BOT_DIR"

{
echo "# JARVIS Journal: $DATE"
echo ""

# === Croppy Notes (most important for handoff) ===
echo "## Croppy Notes"
echo ""
if [ -f "$CROPPY_NOTES" ]; then
  cat "$CROPPY_NOTES"
  echo ""
else
  echo "(No croppy notes for today)"
  echo ""
fi

# === Git Activity ===
echo "## Git Activity"
echo ""
NEXT_DATE=$(date -v+1d -j -f '%Y-%m-%d' "$DATE" '+%Y-%m-%d' 2>/dev/null || echo "")
COMMITS=$(git log --since="$DATE 00:00:00" --until="$NEXT_DATE 00:00:00" --oneline --no-merges 2>/dev/null || echo "")
if [ -z "$COMMITS" ]; then
  echo "No commits today"
else
  echo "$COMMITS"
fi
echo ""
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "Branch: $BRANCH | Ahead: $AHEAD | Dirty: $DIRTY"
echo ""

# === Telegram Activity ===
echo "## Telegram Activity"
echo ""
if [ -f "$BOT_LOG" ]; then
  echo "imagine=$(grep -c 'handleImagine' "$BOT_LOG" 2>/dev/null || echo 0) edit=$(grep -c 'handleEdit' "$BOT_LOG" 2>/dev/null || echo 0) debate=$(grep -c 'handleDebate' "$BOT_LOG" 2>/dev/null || echo 0) ai=$(grep -c 'handleAiSession' "$BOT_LOG" 2>/dev/null || echo 0)"
fi
echo ""

# === Errors ===
echo "## Errors (last 5)"
echo ""
if [ -f "$BOT_LOG" ]; then
  grep -i "error\|SIGTERM\|crash\|fatal" "$BOT_LOG" 2>/dev/null | tail -5 || echo "none"
else
  echo "no log"
fi
echo ""

# === Process Status ===
echo "## Processes"
echo ""
echo "Jarvis: $(pgrep -f 'bun run src/index.ts' 2>/dev/null | head -1 || echo 'OFF')"
echo "Poller: $(pgrep -f 'task-poller' 2>/dev/null | head -1 || echo 'OFF')"
echo "ComfyUI: $(pgrep -f 'comfyui\|ComfyUI' 2>/dev/null | head -1 || echo 'OFF')"
echo ""

# === Session State ===
echo "## Session State"
echo ""
if [ -f "$BOT_DIR/CLAUDE.md" ]; then
  sed -n '/SESSION_STATE_START/,/SESSION_STATE_END/p' "$BOT_DIR/CLAUDE.md" 2>/dev/null | head -30 || echo "none"
fi
echo ""

# === System ===
echo "## System"
echo ""
echo "Disk free: $(df -h / 2>/dev/null | tail -1 | awk '{print $4}')"
echo "AI Models: $(du -sh $HOME/ai-models 2>/dev/null | cut -f1 || echo 'N/A')"
echo ""

echo "---"
echo "*Generated $(date '+%Y-%m-%d %H:%M:%S')*"
} > "$OUTPUT"

echo "OK: $OUTPUT"
