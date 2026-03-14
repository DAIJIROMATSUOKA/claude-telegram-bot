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
# Query Access DB via Parallels PowerShell
# ============================================================
read_access_db() {
  local PID="$1"
  local DB_SOURCE="$HOME/Machinelab Dropbox/Matsuoka Daijiro/MLDatabase.accdb"
  local DB_DESKTOP="$HOME/Desktop/MLDatabase.accdb"

  # Check Parallels
  if ! prlctl list --all 2>/dev/null | grep -q "running"; then
    return
  fi

  # Copy DB to Desktop if source exists
  if [ -f "$DB_SOURCE" ]; then
    cp "$DB_SOURCE" "$DB_DESKTOP" 2>/dev/null
  fi
  if [ ! -f "$DB_DESKTOP" ]; then
    return
  fi

  # Build WHERE clause
  local WHERE
  if echo "$PID" | grep -q '^M'; then
    local MNUM="${PID#M}"
    WHERE="[プロジェクト名] LIKE '*M${MNUM}*' OR [プロジェクト名] LIKE '*${PID}*'"
  else
    WHERE="[プロジェクトNo] = '${PID}'"
  fi

  # PowerShell script
  local PS1_PATH="$HOME/Desktop/access-context-query.ps1"
  printf '\xef\xbb\xbf' > "$PS1_PATH"
  cat >> "$PS1_PATH" << 'PSEOF'
$ErrorActionPreference = "Stop"
$dbPath = "\\Mac\Home\Desktop\MLDatabase.accdb"
try {
    $access = New-Object -ComObject Access.Application
    $access.OpenCurrentDatabase($dbPath)
PSEOF

  cat >> "$PS1_PATH" << PSEOF2
    \$sql = "SELECT TOP 1 [プロジェクトNo], [プロジェクト名], [開始日], [販売先ID], [納品先ID] FROM [プロジェクトデータ] WHERE ${WHERE}"
PSEOF2

  cat >> "$PS1_PATH" << 'PSEOF3'
    $rs = $access.CurrentDb().OpenRecordset($sql)
    if (-not $rs.EOF) {
        $prNo = $rs.Fields("プロジェクトNo").Value
        $prName = $rs.Fields("プロジェクト名").Value
        $startDate = $rs.Fields("開始日").Value
        $custId = $rs.Fields("販売先ID").Value
        $destId = $rs.Fields("納品先ID").Value
        $custName = ""
        if ($custId) {
            $rs2 = $access.CurrentDb().OpenRecordset("SELECT [販売先] FROM [販売先] WHERE [販売先ID] = $custId")
            if (-not $rs2.EOF) { $custName = $rs2.Fields("販売先").Value }
            $rs2.Close()
        }
        $destName = ""
        if ($destId) {
            $rs3 = $access.CurrentDb().OpenRecordset("SELECT [納品先] FROM [納品先] WHERE [納品先ID] = $destId")
            if (-not $rs3.EOF) { $destName = $rs3.Fields("納品先").Value }
            $rs3.Close()
        }
        $quoteInfo = ""
        try {
            $qSql = "SELECT TOP 1 [見積書No], [件名], [見積日] FROM [見積書] WHERE [プロジェクトID] = " + $rs.Fields("プロジェクトID").Value + " ORDER BY [見積日] DESC"
            $rs4 = $access.CurrentDb().OpenRecordset($qSql)
            if (-not $rs4.EOF) {
                $quoteInfo = "No." + $rs4.Fields("見積書No").Value + " " + $rs4.Fields("件名").Value + " (" + $rs4.Fields("見積日").Value + ")"
            }
            $rs4.Close()
        } catch {}
        Write-Host "NAME=$prName"
        Write-Host "CUSTOMER=$custName"
        Write-Host "DEST=$destName"
        Write-Host "START=$startDate"
        Write-Host "QUOTE=$quoteInfo"
    } else {
        Write-Host "NOTFOUND"
    }
    $rs.Close()
    $access.CloseCurrentDatabase()
    $access.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($access) | Out-Null
} catch {
    Write-Host "ERROR=$($_.Exception.Message)"
}
PSEOF3

  # Execute
  local OUTPUT
  OUTPUT=$(prlctl exec "DJ's Windows 11" powershell.exe -ExecutionPolicy Bypass -File '\\Mac\Home\Desktop\access-context-query.ps1' 2>/dev/null)

  if echo "$OUTPUT" | grep -q "NOTFOUND\|ERROR="; then
    return
  fi

  # Parse output
  local NAME="" CUSTOMER="" DEST="" START="" QUOTE=""
  while IFS='=' read -r key val; do
    case "$key" in
      NAME) NAME="$val" ;;
      CUSTOMER) CUSTOMER="$val" ;;
      DEST) DEST="$val" ;;
      START) START="$val" ;;
      QUOTE) QUOTE="$val" ;;
    esac
  done <<< "$OUTPUT"

  if [ -n "$NAME" ] || [ -n "$CUSTOMER" ]; then
    echo "## ACCESS DB情報"
    [ -n "$NAME" ] && echo "案件名: $NAME"
    [ -n "$CUSTOMER" ] && echo "販売先: $CUSTOMER"
    [ -n "$DEST" ] && echo "納品先: $DEST"
    [ -n "$START" ] && echo "開始日: $START"
    [ -n "$QUOTE" ] && echo "最新見積: $QUOTE"
  fi
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

  # Access DB section (optional, requires Parallels)
  local ACCESS=$(read_access_db "$PID")
  if [ -n "$ACCESS" ]; then
    echo "$ACCESS"
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
