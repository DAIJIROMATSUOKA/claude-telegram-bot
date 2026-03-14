#!/bin/bash
# project-context-builder.sh - Gather project context from Dropbox/Obsidian/Access DB
# Port of F3 (project-context-builder.ts) for Chrome Worker Tab method
#
# Usage:
#   ./project-context-builder.sh context <M1317>       # Full context prompt
#   ./project-context-builder.sh folder-name <M1317>   # Dropbox folder name only
#   ./project-context-builder.sh chat-name <M1317>     # Chat title (folder name or ID)

DROPBOX_DIR="$HOME/Machinelab Dropbox/machinelab/プロジェクト"
OBSIDIAN_WORK="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/40_Work"
LOG="/tmp/project-context-builder.log"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# ============================================================
# Find Dropbox folder name for project ID
# ============================================================
find_folder() {
  local PID="$1"
  if [ ! -d "$DROPBOX_DIR" ]; then
    return 1
  fi

  if echo "$PID" | grep -q '^M'; then
    # M-number: direct match in root
    ls "$DROPBOX_DIR" 2>/dev/null | grep "^$PID" | head -1
  else
    # PrNo: year folder (first 2 digits)
    local YEAR="${PID:0:2}"
    local YEARDIR="$DROPBOX_DIR/$YEAR"
    if [ -d "$YEARDIR" ]; then
      local MATCH=$(ls "$YEARDIR" 2>/dev/null | grep "^$PID" | head -1)
      if [ -n "$MATCH" ]; then
        echo "$YEAR/$MATCH"
      fi
    fi
  fi
}

# ============================================================
# Scan Dropbox folder contents
# ============================================================
scan_folder() {
  local FOLDER_NAME="$1"
  local FULL_PATH
  if echo "$FOLDER_NAME" | grep -q '/'; then
    FULL_PATH="$DROPBOX_DIR/$FOLDER_NAME"
  else
    FULL_PATH="$DROPBOX_DIR/$FOLDER_NAME"
  fi

  if [ ! -d "$FULL_PATH" ]; then
    echo "(フォルダ未検出)"
    return
  fi

  local SUBDIRS=""
  local FILES=""
  local FILE_COUNT=0

  while IFS= read -r entry; do
    if [ -d "$FULL_PATH/$entry" ]; then
      SUBDIRS="${SUBDIRS}${SUBDIRS:+, }$entry"
    else
      FILE_COUNT=$((FILE_COUNT + 1))
      if [ "$FILE_COUNT" -le 15 ]; then
        FILES="${FILES}${FILES:+, }$entry"
      fi
    fi
  done < <(ls "$FULL_PATH" 2>/dev/null)

  if [ -n "$SUBDIRS" ]; then
    echo "サブフォルダ: $SUBDIRS"
  fi
  if [ -n "$FILES" ]; then
    echo "ファイル (${FILE_COUNT}件): $FILES"
    if [ "$FILE_COUNT" -gt 15 ]; then
      echo "  (他 $((FILE_COUNT - 15)) 件)"
    fi
  fi
}

# ============================================================
# Read Obsidian project note
# ============================================================
read_obsidian() {
  local PID="$1"
  if [ ! -d "$OBSIDIAN_WORK" ]; then
    return
  fi

  local NOTE=$(ls "$OBSIDIAN_WORK" 2>/dev/null | grep "^$PID" | grep '\.md$' | head -1)
  if [ -z "$NOTE" ]; then
    return
  fi

  local PATH="$OBSIDIAN_WORK/$NOTE"
  # Extract frontmatter
  python3 -c "
import sys
content = open('$PATH', encoding='utf-8').read()
# Frontmatter
if content.startswith('---'):
    end = content.find('---', 3)
    if end > 0:
        fm = content[3:end].strip()
        for line in fm.split('\n'):
            if ':' in line:
                print(line.strip())

# Log section (last 1000 chars)
import re
log_match = re.search(r'## ログ\n([\s\S]*?)(?=\n## |$)', content)
if log_match and len(log_match.group(1)) < 1000:
    print()
    print('### 直近のログ')
    print(log_match.group(1).strip())
" 2>/dev/null
}

# ============================================================
# Build full context prompt
# ============================================================
build_context() {
  local PID="$1"
  local FOLDER=$(find_folder "$PID")

  # Header
  echo "これは案件 ${PID} の専用チャットです。以下の情報を記憶してください。"
  echo ""

  # Dropbox section
  if [ -n "$FOLDER" ]; then
    echo "## Dropboxフォルダ: $FOLDER"
    scan_folder "$FOLDER"
    echo ""
  fi

  # Obsidian section
  local OBS=$(read_obsidian "$PID")
  if [ -n "$OBS" ]; then
    echo "## Obsidianノート"
    echo "$OBS"
    echo ""
  fi

  # Instructions
  echo "## 役割"
  echo "- この案件に関する全情報を蓄積する"
  echo "- Gmail/LINE/iMessage等からの自動転送メッセージを受け取る"
  echo "- DJからの質問に案件の全文脈を踏まえて回答する"
  echo ""
  echo "以上の情報を記憶してください。今後このチャットに案件の情報が随時追加されます。「了解」とだけ返答してください。"
}

# ============================================================
# COMMANDS
# ============================================================
case "$1" in

context)
  PID="$2"
  if [ -z "$PID" ]; then
    echo "Usage: $0 context <M1317>"
    exit 1
  fi
  build_context "$PID"
  ;;

folder-name)
  PID="$2"
  if [ -z "$PID" ]; then
    echo "Usage: $0 folder-name <M1317>"
    exit 1
  fi
  FOLDER=$(find_folder "$PID")
  if [ -n "$FOLDER" ]; then
    echo "$FOLDER"
  else
    echo "$PID"
  fi
  ;;

chat-name)
  PID="$2"
  if [ -z "$PID" ]; then
    echo "Usage: $0 chat-name <M1317>"
    exit 1
  fi
  FOLDER=$(find_folder "$PID")
  if [ -n "$FOLDER" ]; then
    # Strip year prefix for display
    echo "$FOLDER" | sed 's|^[0-9]*/||'
  else
    echo "$PID"
  fi
  ;;

*)
  echo "project-context-builder.sh - Gather project context"
  echo ""
  echo "Commands:"
  echo "  context <M1317>       Full context prompt for chat injection"
  echo "  folder-name <M1317>   Dropbox folder name"
  echo "  chat-name <M1317>     Chat title (folder name or ID)"
  ;;

esac
