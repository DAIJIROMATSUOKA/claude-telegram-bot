#!/bin/bash
# croppy-tab-manager.sh - Manage claude.ai worker tabs for Jarvis->Croppy Bridge
# Location: ~/claude-telegram-bot/scripts/croppy-tab-manager.sh
#
# Usage:
#   ./croppy-tab-manager.sh list                    # List all [J-WORKER] tabs
#   ./croppy-tab-manager.sh list-all                # List ALL claude.ai tabs
#   ./croppy-tab-manager.sh health                  # Check READY/BUSY/DEAD for workers
#   ./croppy-tab-manager.sh mark <W:T> <N>          # Mark tab as [J-WORKER-N]
#   ./croppy-tab-manager.sh unmark <W:T>            # Remove [J-WORKER] mark
#   ./croppy-tab-manager.sh inject <W:T> "message"  # Send message to tab
#   ./croppy-tab-manager.sh inject-worker <N> "msg" # Send to [J-WORKER-N] by name
#   ./croppy-tab-manager.sh open <URL>              # Open new tab
#   ./croppy-tab-manager.sh recover                 # Restore dead worker tabs
#   ./croppy-tab-manager.sh ready                   # Return first READY worker W:T

WORKER_TAG="[J-WORKER"
LOG="/tmp/croppy-tab-manager.log"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

case "$1" in

# ============================================================
# LIST: Show all [J-WORKER] tagged tabs
# ============================================================
list)
  osascript 2>/dev/null << 'AS'
tell application "Google Chrome"
  set output to ""
  repeat with w in windows
    set wIdx to index of w
    repeat with i from 1 to (count of tabs of w)
      set t to tab i of w
      set tTitle to title of t
      if tTitle contains "[J-WORKER" then
        set tUrl to URL of t
        set output to output & wIdx & ":" & i & " | " & tTitle & " | " & tUrl & linefeed
      end if
    end repeat
  end repeat
  return output
end tell
AS
  ;;

# ============================================================
# LIST-ALL: Show all claude.ai tabs
# ============================================================
list-all)
  osascript 2>/dev/null << 'AS'
tell application "Google Chrome"
  set output to ""
  repeat with w in windows
    set wIdx to index of w
    repeat with i from 1 to (count of tabs of w)
      set t to tab i of w
      set tUrl to URL of t
      if tUrl contains "claude.ai" then
        set tTitle to title of t
        set output to output & wIdx & ":" & i & " | " & tTitle & " | " & tUrl & linefeed
      end if
    end repeat
  end repeat
  return output
end tell
AS
  ;;

# ============================================================
# HEALTH: Check each [J-WORKER] tab status
# Output: W:T | [J-WORKER-N] | READY/BUSY/NO_EDITOR/ERROR
# ============================================================
health)
  osascript 2>/dev/null << 'AS'
tell application "Google Chrome"
  if not running then
    return "CHROME_NOT_RUNNING"
  end if
  set output to ""
  repeat with w in windows
    set wIdx to index of w
    repeat with i from 1 to (count of tabs of w)
      set t to tab i of w
      set tTitle to title of t
      if tTitle contains "[J-WORKER" then
        try
          set checkJs to "(() => { const e = document.querySelector('.ProseMirror'); if (!e) return 'NO_EDITOR'; const retry = document.querySelector('button[aria-label=\"Retry\"]') || document.querySelector('button[aria-label=\"再試行\"]'); if (retry) return 'READY'; const stopBtn = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]'); if (stopBtn && stopBtn.getBoundingClientRect().width > 0) return 'BUSY'; return 'READY'; })()"
          set status to execute t javascript checkJs
        on error
          set status to "ERROR"
        end try
        set output to output & wIdx & ":" & i & " | " & tTitle & " | " & status & linefeed
      end if
    end repeat
  end repeat
  if output is "" then
    return "NO_WORKERS"
  end if
  return output
end tell
AS
  ;;

# ============================================================
# READY: Return first READY worker tab as W:T
# ============================================================
ready)
  HEALTH=$("$0" health)
  echo "$HEALTH" | grep "READY" | head -1 | cut -d'|' -f1 | tr -d ' '
  ;;

# ============================================================
# MARK: Add [J-WORKER-N] to tab title
# Usage: mark 1:3 1
# ============================================================
mark)
  WT="$2"
  NUM="$3"
  if [ -z "$WT" ] || [ -z "$NUM" ]; then
    echo "Usage: $0 mark <W:T> <N>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  
  RESULT=$(osascript 2>&1 << APPLESCRIPT
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set markJs to "(() => { const clean = document.title.replace(/\\\\[J-WORKER-\\\\d+\\\\]\\\\s*/g, ''); document.title = '[J-WORKER-$NUM] ' + clean; return document.title; })()"
  set newTitle to execute t javascript markJs
  return newTitle
end tell
APPLESCRIPT
  )
  log "MARK $WT as [J-WORKER-$NUM]: $RESULT"
  echo "$RESULT"
  ;;

# ============================================================
# UNMARK: Remove [J-WORKER-N] from tab title
# ============================================================
unmark)
  WT="$2"
  if [ -z "$WT" ]; then
    echo "Usage: $0 unmark <W:T>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  
  ASFILE="/tmp/croppy-unmark-$$.as"
  cat > "$ASFILE" << UNMARKEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set unmarkJs to "(() => { document.title = document.title.replace(/\\[J-WORKER-\\d+\\]\\s*/g, ''); return document.title; })()"
  set newTitle to execute t javascript unmarkJs
  return newTitle
end tell
UNMARKEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  log "UNMARK $WT: $RESULT"
  echo "$RESULT"
  ;;

# ============================================================
# INJECT: Send message to specific tab by W:T
# Usage: inject 1:3 "Hello from Jarvis"
# ============================================================
inject)
  WT="$2"
  MSG="$3"
  if [ -z "$WT" ] || [ -z "$MSG" ]; then
    echo "Usage: $0 inject <W:T> \"message\""
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  
  # Step 1: Check if tab is a WORKER and READY
  CHECKFILE="/tmp/croppy-inject-check-$$.as"
  cat > "$CHECKFILE" << CHECKEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set tTitle to title of t
  if tTitle does not contain "[J-WORKER" then
    return "NOT_WORKER"
  end if
  set checkJs to "(() => { const e = document.querySelector('.ProseMirror'); if (!e) return 'NO_EDITOR'; const retry = document.querySelector('button[aria-label=\"Retry\"]') || document.querySelector('button[aria-label=\"再試行\"]'); if (retry) return 'READY'; const stopBtn = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]'); if (stopBtn && stopBtn.getBoundingClientRect().width > 0) return 'BUSY'; return 'READY'; })()"
  return execute t javascript checkJs
end tell
CHECKEOF
  STATUS=$(osascript "$CHECKFILE" 2>&1)
  rm -f "$CHECKFILE"
  
  if [ "$STATUS" != "READY" ]; then
    log "INJECT BLOCKED: $WT status=$STATUS"
    echo "BLOCKED:$STATUS"
    exit 1
  fi
  
  # Step 2: Base64 encode the message to avoid ALL escaping issues
  B64MSG=$(printf '%s' "$MSG" | base64 | tr -d '\n')
  
  # Step 3: Build AppleScript that decodes base64 in JS
  ASFILE="/tmp/croppy-inject-$$.as"
  cat > "$ASFILE" << INJECTEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set insertJs to "(() => { const b = Uint8Array.from(atob('$B64MSG'), c => c.charCodeAt(0)); const msg = new TextDecoder().decode(b); const e = document.querySelector('.ProseMirror'); e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); document.execCommand('insertText', false, msg); return 'INSERTED'; })()"
  set r1 to execute t javascript insertJs
  delay 0.5
  set sendJs to "(() => { const e = document.querySelector('.ProseMirror'); const ev = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true}); e.dispatchEvent(ev); return 'SENT'; })()"
  set r2 to execute t javascript sendJs
  return r1 & ":" & r2
end tell
INJECTEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  
  log "INJECT $WT: $RESULT (msg=${MSG:0:60}...)"
  echo "$RESULT"
  ;;

# ============================================================
# INJECT-WORKER: Send message to [J-WORKER-N] by worker number
# Usage: inject-worker 1 "Hello from Jarvis"
# ============================================================
inject-worker)
  NUM="$2"
  MSG="$3"
  if [ -z "$NUM" ] || [ -z "$MSG" ]; then
    echo "Usage: $0 inject-worker <N> \"message\""
    exit 1
  fi
  
  # Find tab with matching worker number
  WT=$("$0" list | grep "\[J-WORKER-${NUM}\]" | head -1 | cut -d'|' -f1 | tr -d ' ')
  
  if [ -z "$WT" ]; then
    echo "ERROR: [J-WORKER-$NUM] not found"
    exit 1
  fi
  
  "$0" inject "$WT" "$MSG"
  ;;

# ============================================================
# OPEN: Open a new claude.ai tab
# Usage: open https://claude.ai/project/xxx
# ============================================================
open)
  URL="$2"
  if [ -z "$URL" ]; then
    echo "Usage: $0 open <URL>"
    exit 1
  fi
  osascript -e "
tell application \"Google Chrome\"
  tell window 1
    set newTab to make new tab with properties {URL:\"$URL\"}
  end tell
end tell
" 2>&1
  log "OPEN: $URL"
  echo "OPENED: $URL"
  ;;

# ============================================================
# RECOVER: Check for missing workers and restore them
# Reads config from /tmp/croppy-workers.json
# ============================================================
recover)
  CONFIG="/tmp/croppy-workers.json"
  if [ ! -f "$CONFIG" ]; then
    echo "No worker config at $CONFIG"
    echo "Create with: echo '{\"workers\":[{\"num\":1,\"url\":\"https://claude.ai/project/xxx\"}]}' > $CONFIG"
    exit 1
  fi
  
  CURRENT=$("$0" list)
  
  python3 -c "
import json, subprocess, sys

with open('$CONFIG') as f:
    config = json.load(f)

current = '''$CURRENT'''

for w in config.get('workers', []):
    tag = f'[J-WORKER-{w[\"num\"]}]'
    if tag not in current:
        print(f'RECOVERING {tag}: {w[\"url\"]}')
        subprocess.run(['$0', 'open', w['url']])
        # Wait for tab to load, then mark it
        import time
        time.sleep(5)
        # Find the new tab (last claude.ai tab)
        result = subprocess.run(['$0', 'list-all'], capture_output=True, text=True)
        lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]
        if lines:
            last_wt = lines[-1].split('|')[0].strip()
            subprocess.run(['$0', 'mark', last_wt, str(w['num'])])
            print(f'RESTORED {tag} at {last_wt}')
    else:
        print(f'OK {tag}: already present')
" 2>&1
  ;;

# ============================================================
# READ-RESPONSE: Read the last assistant response from DOM
# Usage: read-response 1:5
# Returns: text content of last assistant message
# ============================================================
read-response)
  WT="$2"
  if [ -z "$WT" ]; then
    echo "Usage: $0 read-response <W:T>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  
  ASFILE="/tmp/croppy-read-resp-$$.as"
  cat > "$ASFILE" << READEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set readJs to "(() => { var r = document.querySelectorAll('.font-claude-response'); if (r.length === 0) return 'NO_RESPONSE'; var longest = r[0]; for (var i = 1; i < r.length; i++) { if (r[i].innerText.length > longest.innerText.length) longest = r[i]; } var txt = longest.innerText; return txt.substring(txt.length > 4000 ? txt.length - 4000 : 0); })()"
  return execute t javascript readJs
end tell
READEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
  ;;


# ============================================================
# CHECK-STATUS: Check tab status by position (no title check)
# Usage: check-status 1:5
# Returns: READY/BUSY/NO_EDITOR/ERROR
# ============================================================
check-status)
  WT="$2"
  if [ -z "$WT" ]; then
    echo "Usage: $0 check-status <W:T>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  
  # Use base64-encoded JS to avoid all escaping issues
  JS_B64=$(printf '%s' '(() => { var e = document.querySelector(".ProseMirror"); if (!e) return "NO_EDITOR"; var btns = document.querySelectorAll("button"); var hasRetry = false; var hasStop = false; for (var i = 0; i < btns.length; i++) { var al = btns[i].getAttribute("aria-label") || ""; if (al === "Retry" || al.indexOf("\u518d") >= 0) hasRetry = true; if ((al === "Stop Response" || al.indexOf("\u505c\u6b62") >= 0) && btns[i].getBoundingClientRect().width > 0) hasStop = true; } if (hasRetry) return "READY"; if (hasStop) return "BUSY"; return "READY"; })()' | base64 | tr -d '\n')
  
  ASFILE="/tmp/croppy-check-status-$$.as"
  cat > "$ASFILE" << CSEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set b64Js to "$JS_B64"
  set decodedJs to do shell script "echo " & quoted form of b64Js & " | base64 -d"
  return execute t javascript decodedJs
end tell
CSEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
  ;;


# ============================================================
*)
  echo "croppy-tab-manager.sh - Manage claude.ai worker tabs"
  echo ""
  echo "Commands:"
  echo "  list                     List [J-WORKER] tabs"
  echo "  list-all                 List ALL claude.ai tabs"
  echo "  health                   Check READY/BUSY/DEAD status"
  echo "  ready                    Return first READY worker W:T"
  echo "  mark <W:T> <N>           Mark tab as [J-WORKER-N]"
  echo "  unmark <W:T>             Remove worker mark"
  echo "  inject <W:T> \"msg\"       Send message to tab"
  echo "  inject-worker <N> \"msg\"  Send to worker N by name"
  echo "  open <URL>               Open new tab"
  echo "  recover                  Restore missing workers"
  ;;
esac
