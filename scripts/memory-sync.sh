#!/bin/bash
# Auto Memory -> croppy-notes.md one-way sync
# Runs via cron every 5 minutes
SRC="$HOME/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/MEMORY.md"
DST="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/10_Projects/croppy-notes.md"
if [ ! -f "$SRC" ]; then exit 0; fi
if [ ! -f "$DST" ] || [ "$SRC" -nt "$DST" ]; then
  MEMDIR=$(dirname "$SRC")
  {
    echo "# Croppy Notes (Auto-synced from Claude Code Memory)"
    echo "# Last sync: $(date)"
    echo ""
    cat "$SRC"
    for f in architecture.md lessons.md task-state.md; do
      echo ""
      echo "---"
      cat "$MEMDIR/$f" 2>/dev/null
    done
  } > "$DST"
  echo "[memory-sync] $(date): synced" >> /tmp/memory-sync.log
fi
