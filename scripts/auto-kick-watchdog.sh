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
TARGET_URL_FILE="/tmp/autokick-target-url"

stopped_count=0
kick_count=0
MAX_KICKS=3

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

  # Determine target URL (use specific tab if set, else first claude.ai tab)
  TARGET_URL=""
  if [ -f "$TARGET_URL_FILE" ]; then
    TARGET_URL=$(cat "$TARGET_URL_FILE")
  fi

  RESULT=$(osascript 2>/dev/null <<APPLESCRIPT
set targetUrl to (do shell script "cat /tmp/autokick-target-url 2>/dev/null || echo ''")
tell application "Google Chrome"
  if not running then return "NO_CHROME"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      set tabUrl to URL of t
      set matched to false
      if targetUrl is not "" then
        if tabUrl contains targetUrl then set matched to true
      else
        if tabUrl contains "claude.ai/chat" then set matched to true
      end if
      if matched then
        set checkJs to "(() => { const s = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"\u5fdc\u7b54\u3092\u505c\u6b62\"]'); if (s) { const r = s.getBoundingClientRect(); if (r.width > 0) return 'RUNNING'; } return 'STOPPED'; })()"
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
    kick_count=0
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ "$RESULT" = "STOPPED" ]; then
    # First check for tool usage limit "続ける" button
    CONTINUE_RESULT=$(osascript 2>/dev/null <<CONTSCRIPT
set targetUrl to (do shell script "cat /tmp/autokick-target-url 2>/dev/null || echo ''")
tell application "Google Chrome"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      set tabUrl to URL of t
      set matched to false
      if targetUrl is not "" then
        if tabUrl contains targetUrl then set matched to true
      else
        if tabUrl contains "claude.ai/chat" then set matched to true
      end if
      if matched then
        set clickJs to "(() => { var btns = document.querySelectorAll('button'); for (var j = 0; j < btns.length; j++) { var txt = (btns[j].textContent || '').trim(); if (txt === '続ける' || txt === 'Continue') { btns[j].click(); return 'CLICKED'; } } return 'NO_BUTTON'; })()"
        return execute t javascript clickJs
      end if
    end repeat
  end repeat
  return "NO_TAB"
end tell
CONTSCRIPT
    )
    if [ "$CONTINUE_RESULT" = "CLICKED" ]; then
      echo "[$(date '+%H:%M:%S')] Tool limit '続ける' clicked" >> "$LOG"
      stopped_count=0
      sleep "$CHECK_INTERVAL"
      continue
    fi

    stopped_count=$((stopped_count + 1))
    echo "[$(date '+%H:%M:%S')] STOPPED detected ($stopped_count/$STOPPED_THRESHOLD)" >> "$LOG"

    if [ "$stopped_count" -ge "$STOPPED_THRESHOLD" ]; then
      # --- M1_STATUS_CHECK: skip kick if task is DONE/IDLE ---
      M1_STATE_FILE="/Users/daijiromatsuokam1/claude-telegram-bot/autonomous/state/M1.md"
      if [ -f "$M1_STATE_FILE" ]; then
        M1_STATUS=$(head -1 "$M1_STATE_FILE" | grep -oE '(DONE|IDLE)')
        if [ -n "$M1_STATUS" ]; then
          echo "[$(date '+%H:%M:%S')] M1 STATUS= - auto-disarming (no work to do)" >> "$LOG"
          rm -f "$ARMED_FLAG"
          stopped_count=0
          sleep "$CHECK_INTERVAL"
          continue
        fi
      fi
      # --- END M1_STATUS_CHECK ---
      echo "[$(date '+%H:%M:%S')] KICKING" >> "$LOG"

      KICK_RESULT=$(osascript 2>/dev/null <<APPLESCRIPT
set targetUrl to (do shell script "cat /tmp/autokick-target-url 2>/dev/null || echo ''")
tell application "Google Chrome"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      set tabUrl to URL of t
      set matched to false
      if targetUrl is not "" then
        if tabUrl contains targetUrl then set matched to true
      else
        if tabUrl contains "claude.ai/chat" then set matched to true
      end if
      if matched then
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
      kick_count=$((kick_count + 1))

      if [ "$kick_count" -ge "$MAX_KICKS" ]; then
        echo "[$(date '+%H:%M:%S')] STALE TAB: $MAX_KICKS kicks with no RUNNING response. Auto-disarming." >> "$LOG"
        rm -f "$ARMED_FLAG"
        kick_count=0
        # Notify DJ
        source ~/claude-telegram-bot/.env 2>/dev/null
        bash ~/claude-telegram-bot/scripts/notify-dj.sh "Auto-kick disarmed: stale tab detected (${MAX_KICKS} kicks, no response)"
      fi

    fi
  elif [ "$RESULT" = "NO_TAB" ] || [ "$RESULT" = "NO_CHROME" ]; then
    stopped_count=0
    kick_count=$((kick_count + 1))
    if [ "$kick_count" -ge "$MAX_KICKS" ]; then
      echo "[$(date '+%H:%M:%S')] NO_TAB/NO_CHROME ${MAX_KICKS}x. Auto-disarming." >> "$LOG"
      rm -f "$ARMED_FLAG"
      kick_count=0
    fi
  else
    stopped_count=0
  fi

  sleep "$CHECK_INTERVAL"
done
