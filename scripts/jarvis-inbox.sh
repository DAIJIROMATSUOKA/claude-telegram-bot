#!/bin/bash
# jarvis-inbox.sh - Obsidian Inbox → JARVIS自動実行
# 00_Inbox/jarvis.md の @jarvis 行を検知して実行
# LaunchAgent (5分間隔) から呼び出される
#
# CRITICAL: < /dev/null for headless mode
# CRITICAL: Idempotent - processed lines are tracked by hash

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
OBSIDIAN_CLI="/Applications/Obsidian.app/Contents/MacOS/Obsidian"
NOTIFY="python3 $PROJECT_DIR/scripts/telegram-notify.py"
VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian"
INBOX_FILE="$VAULT/00_Inbox/jarvis.md"
STATE_FILE="$HOME/.jarvis/inbox-processed.txt"
LOG_DIR="/tmp/jarvis-inbox"
TASK_TIMEOUT=300  # 5min max per task
STOP_FILE="/tmp/jarvis-inbox-stop"

# === Setup ===
mkdir -p "$LOG_DIR" "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/inbox-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

# === Stop file check ===
if [ -f "$STOP_FILE" ]; then
  exit 0
fi

# === Lock file (prevent concurrent execution) ===
LOCK_FILE="/tmp/jarvis-inbox.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(head -1 "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0  # Another instance running
  fi
  rm -f "$LOCK_FILE"  # Stale lock
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# === Pre-checks ===
if [ ! -f "$INBOX_FILE" ]; then
  # No inbox file yet — create template
  mkdir -p "$(dirname "$INBOX_FILE")"
  cat > "$INBOX_FILE" << 'TEMPLATE'
# JARVIS Inbox
<!-- @jarvis に続けて指示を書くと、JARVISが自動実行します -->
<!-- 例: @jarvis M1308の図面番号体系を確認して -->
<!-- 破壊操作は CONFIRM: をつけてください -->
<!-- 例: @jarvis CONFIRM: 古いログファイルを削除 -->
TEMPLATE
  log "Created inbox template: $INBOX_FILE"
  exit 0
fi

# Obsidian process not required for inbox file read (removed gate)

# === Read inbox ===
INBOX_CONTENT=$(cat "$INBOX_FILE" 2>/dev/null)
if [ -z "$INBOX_CONTENT" ]; then
  exit 0
fi

# === Process each @jarvis line ===
PROCESSED=0
SKIPPED=0

while IFS= read -r line; do
  # Skip non-command lines
  echo "$line" | grep -qi '^@jarvis ' || continue

  # Extract command (remove @jarvis prefix)
  CMD=$(echo "$line" | sed 's/^@[jJ][aA][rR][vV][iI][sS] *//')

  # Skip empty commands
  [ -z "$CMD" ] && continue

  # Generate line hash for idempotency
  LINE_HASH=$(echo "$line" | shasum -a 256 | cut -c1-16)

  # Check if already processed
  if grep -q "$LINE_HASH" "$STATE_FILE" 2>/dev/null; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log "=== New command: $CMD (hash=$LINE_HASH) ==="

  # === Safety: check for destructive ops without CONFIRM ===
  DESTRUCTIVE_WORDS="削除|delete|remove|rm |drop|destroy|format|reset|wipe|clean"
  if echo "$CMD" | grep -qiE "$DESTRUCTIVE_WORDS"; then
    if ! echo "$CMD" | grep -qi "CONFIRM:"; then
      RESULT="⚠️ 破壊操作検出: CONFIRM: タグなし。実行拒否。\n元の指示: $CMD\n→ 「@jarvis CONFIRM: $CMD」で再投稿してください。"
      log "REJECTED: destructive without CONFIRM"

      # Notify rejection
      echo -e "$RESULT" > "$LOG_DIR/inbox-result-$$.txt"
      $NOTIFY --file "$LOG_DIR/inbox-result-$$.txt" 2>>"$LOGFILE"

      # Append to daily note
      "$OBSIDIAN_CLI" daily:append "content=## 📥 Inbox (拒否)\n$RESULT" 2>>"$LOGFILE"

      # Mark as processed (so we don't keep rejecting)
      echo "$LINE_HASH $(date '+%Y-%m-%d %H:%M') REJECTED: $CMD" >> "$STATE_FILE"
      PROCESSED=$((PROCESSED + 1))
      continue
    fi
    # Strip CONFIRM: prefix for execution
    CMD=$(echo "$CMD" | sed 's/CONFIRM: *//')
  fi

  # === Execute via Claude CLI ===
  PROMPT_FILE="$LOG_DIR/inbox-prompt-$$.txt"
  cat > "$PROMPT_FILE" << PROMPTEOF
You are JARVIS, DJ's AI assistant. Execute the following task from DJ's Obsidian inbox.

TASK: $CMD

RULES:
- Execute the task directly. No clarification needed.
- Be concise in your response.
- If the task requires file operations, use the project at ~/claude-telegram-bot
- All output in Japanese.
- If you need web search, use it.
- If the task is ambiguous, make your best judgment and note assumptions.
PROMPTEOF

  log "Executing via Claude CLI..."
  RESULT=$(cd "$PROJECT_DIR" && timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" -p --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" --max-turns 25 < /dev/null 2>>"$LOGFILE")
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ] || [ -z "$RESULT" ]; then
    RESULT="❌ 実行失敗 (exit=$EXIT_CODE)\nタスク: $CMD"
    log "FAILED: exit=$EXIT_CODE"
  else
    log "OK: ${#RESULT} chars"
  fi

  # === Record result ===
  RESULT_FILE="$LOG_DIR/inbox-result-$$.txt"
  echo "$RESULT" > "$RESULT_FILE"

  # Telegram notification
  NOTIFY_MSG="📥 Inbox実行完了\n📋 $CMD\n\n$RESULT"
  echo -e "$NOTIFY_MSG" > "$LOG_DIR/inbox-notify-$$.txt"
  $NOTIFY --file "$LOG_DIR/inbox-notify-$$.txt" 2>>"$LOGFILE"

  # Append to Obsidian daily note
  # Escape for CLI (truncate long results)
  TRUNCATED=$(echo "$RESULT" | head -30)
  if pgrep -xq "Obsidian"; then
    "$OBSIDIAN_CLI" daily:append "content=## 📥 Inbox: $CMD
$TRUNCATED" 2>>"$LOGFILE"
  else
    log "Obsidian not running, skipping daily note append"
  fi

  # Mark as processed
  echo "$LINE_HASH $(date '+%Y-%m-%d %H:%M') OK: $CMD" >> "$STATE_FILE"
  PROCESSED=$((PROCESSED + 1))

  log "Recorded to daily note + Telegram"

  # Clean temp files
  rm -f "$PROMPT_FILE" "$RESULT_FILE" "$LOG_DIR/inbox-notify-$$.txt"

done <<< "$INBOX_CONTENT"

# === Clean up inbox (remove processed lines) ===
if [ $PROCESSED -gt 0 ]; then
  log "Processed $PROCESSED commands, $SKIPPED skipped"

  # Rewrite inbox: keep header + unprocessed lines only
  TEMP_INBOX="$LOG_DIR/inbox-clean-$$.md"
  while IFS= read -r line; do
    if echo "$line" | grep -qi '^@jarvis '; then
      LINE_HASH=$(echo "$line" | shasum -a 256 | cut -c1-16)
      if grep -q "$LINE_HASH" "$STATE_FILE" 2>/dev/null; then
        continue  # Remove processed line
      fi
    fi
    echo "$line"
  done < "$INBOX_FILE" > "$TEMP_INBOX"

  cp "$TEMP_INBOX" "$INBOX_FILE"
  rm -f "$TEMP_INBOX"
  log "Inbox cleaned"
fi

exit 0
