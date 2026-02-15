#!/bin/bash
# auto-kick-watchdog.sh - Production watchdog for claude.ai auto-resume
# Location: ~/claude-telegram-bot/scripts/auto-kick-watchdog.sh
#
# ARM:    touch /tmp/autokick-armed    (Croppy does this before long work)
# DISARM: rm /tmp/autokick-armed       (DJ or Croppy disarms)
# STOP:   touch /tmp/autokick-stop     (kills watchdog loop)

LOG="/tmp/autokick-watchdog.log"
ARMED_FLAG="/tmp/autokick-armed"
STOP_FLAG="/tmp/autokick-stop"
CHECK_INTERVAL=20
STOPPED_THRESHOLD=2

stopped_count=0

echo "[$(date '+%H:%M:%S')] Watchdog started (PID $$)" >> "$LOG"

while true; do
  if [ -f "$STOP_FLAG" ]; then
    echo "[$(date '+%H:%M:%S')] Stop flag detected. Exiting." >> "$LOG"
    exit 0
  fi

  if [ ! -f "$ARMED_FLAG" ]; then
    stopped_count=0
    sleep "$CHECK_INTERVAL"
    continue
  fi

  RESULT=$(osascript << 'APPLESCRIPT' 2>/dev/null
tell application "Google Chrome"
  if not running then return "NO_CHROME"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      if URL of t contains "claude.ai/chat" then
        set checkJs to "(() => { const stopBtn = document.querySelector('button[aria-label=\"応答を停止\"]') || document.querySelector('button[aria-label=\"Stop Response\"]'); if (stopBtn) { const rect = stopBtn.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) return 'RUNNING'; } return 'STOPPED'; })()"
        set status to execute t javascript checkJs
        return status
      end if
    end repeat
  end repeat
  return "NO_TAB"
end tell
APPLESCRIPT
  )

  if [ "$RESULT" = "RUNNING" ]; then
    stopped_count=0
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ "$RESULT" = "STOPPED" ]; then
    stopped_count=$((stopped_count + 1))
    echo "[$(date '+%H:%M:%S')] STOPPED detected ($stopped_count/$STOPPED_THRESHOLD)" >> "$LOG"

    if [ "$stopped_count" -ge "$STOPPED_THRESHOLD" ]; then
      echo "[$(date '+%H:%M:%S')] KICKING" >> "$LOG"

      KICK_RESULT=$(osascript << 'APPLESCRIPT' 2>/dev/null
tell application "Google Chrome"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      if URL of t contains "claude.ai/chat" then
        set active tab index of w to i
        set js1 to "(() => { const e = document.querySelector('.ProseMirror'); if (!e) return 'NO_EDITOR'; e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); document.execCommand('insertText', false, 'auto-kick: session timeout detected, continue working'); return 'INSERTED'; })()"
        execute t javascript js1
        delay 1
        set js2 to "(() => { const e = document.querySelector('.ProseMirror'); const ev = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true}); e.dispatchEvent(ev); return 'SENT'; })()"
        execute t javascript js2
        return "KICK_SENT"
      end if
    end repeat
  end repeat
  return "NO_TAB"
end tell
APPLESCRIPT
      )

      echo "[$(date '+%H:%M:%S')] Kick result: $KICK_RESULT" >> "$LOG"
      stopped_count=0

      source ~/claude-telegram-bot/.env 2>/dev/null
      if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
          -d "chat_id=$TELEGRAM_ALLOWED_USERS" -d "text=🦞 Auto-kick fired. Claude resumed." > /dev/null 2>&1
      fi
    fi
  else
    stopped_count=0
  fi

  sleep "$CHECK_INTERVAL"
done
