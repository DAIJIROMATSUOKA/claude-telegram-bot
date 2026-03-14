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
# Reads config from ~/.croppy-workers.json (persistent, auto-created if missing)
# ============================================================
recover)
  CONFIG="${HOME}/claude-telegram-bot/.croppy-workers.json"
  if [ ! -f "$CONFIG" ]; then
    echo "No worker config found. Auto-creating default (2 workers)..."
    DEFAULT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
    python3 -c "
import json
workers = [{'num': i, 'url': '${DEFAULT_URL}'} for i in range(1, 3)]
with open('${CONFIG}', 'w') as f:
    json.dump({'workers': workers}, f, indent=2)
print('Created default config: 2 workers')
"
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
  set readJs to "(() => { var r = document.querySelectorAll('.font-claude-response'); if (r.length === 0) return 'NO_RESPONSE'; var last = null; for (var i = r.length - 1; i >= 0; i--) { if (r[i].innerText.length > 20) { last = r[i]; break; } } if (!last) last = r[r.length - 1]; var txt = last.innerText; return txt.substring(txt.length > 4000 ? txt.length - 4000 : 0); })()"
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
# TOKEN-ESTIMATE: Estimate token usage of current chat via DOM
# Usage: token-estimate 1:5
# Returns: estimated tokens, percentage of 200K, recommendation
# ============================================================
token-estimate)
  WT=""
  if [ -z "" ]; then
    echo "Usage: /bin/sh token-estimate <W:T>"
    exit 1
  fi
  WIDX=""
  TIDX=""
  
  JS_B64=KCgpID0+IHsKICAgIHZhciBtc2dzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbChcIltkYXRhLWlzLXN0cmVhbWluZ10sLmZvbnQtY2xhdWRlLXJlc3BvbnNlLC5mb250LXVzZXItbWVzc2FnZSwud2hpdGVzcGFjZS1wcmUtd3JhcFwiKTsKICAgIGlmIChtc2dzLmxlbmd0aCA9PT0gMCkgewogICAgICBtc2dzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbChcIi5wcm9zZSwgLmZvbnQtY2xhdWRlLXJlc3BvbnNlXCIpOwogICAgfQogICAgdmFyIHRvdGFsQ2hhcnMgPSAwOwogICAgdmFyIG1zZ0NvdW50ID0gMDsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXNncy5sZW5ndGg7IGkrKykgewogICAgICB0b3RhbENoYXJzICs9IChtc2dzW2ldLmlubmVyVGV4dCB8fCBcIlwiKS5sZW5ndGg7CiAgICAgIG1zZ0NvdW50Kys7CiAgICB9CiAgICB2YXIgc3lzUHJvbXB0RXN0ID0gNjAwMDA7CiAgICB2YXIganBSYXRpbyA9IDEuNTsKICAgIHZhciBlc3RUb2tlbnMgPSBNYXRoLnJvdW5kKHRvdGFsQ2hhcnMgKiBqcFJhdGlvKSArIHN5c1Byb21wdEVzdDsKICAgIHZhciBtYXhUb2tlbnMgPSAyMDAwMDA7CiAgICB2YXIgcGN0ID0gTWF0aC5yb3VuZCgoZXN0VG9rZW5zIC8gbWF4VG9rZW5zKSAqIDEwMCk7CiAgICB2YXIgcmVjID0gXCJPS1wiOwogICAgaWYgKHBjdCA+PSA4NSkgcmVjID0gXCJIQU5ET0ZGX05PV1wiOwogICAgZWxzZSBpZiAocGN0ID49IDc1KSByZWMgPSBcIlBSRVBBUkVfSEFORE9GRlwiOwogICAgZWxzZSBpZiAocGN0ID49IDYwKSByZWMgPSBcIk1PTklUT1JcIjsKICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh7Y2hhcnM6IHRvdGFsQ2hhcnMsIG1lc3NhZ2VzOiBtc2dDb3VudCwgZXN0X3Rva2VuczogZXN0VG9rZW5zLCBwY3Q6IHBjdCwgcmVjb21tZW5kYXRpb246IHJlY30pOwogIH0pKCk=
  
  ASFILE="/tmp/croppy-token-est-9.as"
  cat > "" << TEEOF
tell application "Google Chrome"
  set t to tab  of window 
  set b64Js to ""
  set decodedJs to do shell script "echo " & quoted form of b64Js & " | base64 -d"
  return execute t javascript decodedJs
end tell
TEEOF
  RESULT=/bin/sh: 62: osascript: not found
  rm -f ""
  
  echo "" | python3 -c '
import json,sys
try:
    d = json.loads(sys.stdin.read().strip())
    print(f"Messages: {d["messages"]}")
    print(f"Chars: {d["chars"]:,}")
    print(f"Est tokens: {d["est_tokens"]:,} / 200,000")
    print(f"Usage: {d["pct"]}%")
    print(f"Status: {d["recommendation"]}")
except:
    print("PARSE_ERROR")
' 2>/dev/null || echo ""
  ;;

# ============================================================
# HANDOFF: Full chat handoff orchestration
# Usage: handoff <W:T> <project_url> [summary_method]
#   summary_method: "gemini" (default) or "self"
# Flow: read chat -> summarize -> open new tab -> mark -> inject -> unmark old
# ============================================================
handoff)
  WT=""
  PROJECT_URL=""
  SUMMARY_METHOD="gemini"
  
  if [ -z "" ] || [ -z "" ]; then
    echo "Usage: /bin/sh handoff <W:T> <project_url> [gemini|self]"
    exit 1
  fi
  
  log "HANDOFF START:  ->  (method=)"
  echo "=== HANDOFF START ==="
  
  STATUS=
  if [ "" = "BUSY" ]; then
    echo "ERROR: Worker  is BUSY. Wait for response to complete."
    exit 1
  fi
  echo "[1/7] Status: "
  
  RESPONSE=
  echo "[2/7] Read response: 0 chars"
  
  TOKEN_EST=
  echo "[3/7] Token estimate: "
  
  echo "[4/7] Generating summary ()..."
  
  WIDX=""
  TIDX=""
  
  CONV_JS_B64=KCgpID0+IHsKICAgIHZhciBibG9ja3MgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKFwiLmZvbnQtY2xhdWRlLXJlc3BvbnNlLCAuZm9udC11c2VyLW1lc3NhZ2UsIC53aGl0ZXNwYWNlLXByZS13cmFwXCIpOwogICAgdmFyIGNvbnYgPSBbXTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYmxvY2tzLmxlbmd0aDsgaSsrKSB7CiAgICAgIHZhciB0ZXh0ID0gKGJsb2Nrc1tpXS5pbm5lclRleHQgfHwgXCJcIikuc3Vic3RyaW5nKDAsIDUwMCk7CiAgICAgIGlmICh0ZXh0Lmxlbmd0aCA+IDEwKSBjb252LnB1c2godGV4dCk7CiAgICB9CiAgICB2YXIgbGFzdDIwID0gY29udi5zbGljZSgtMjApOwogICAgcmV0dXJuIGxhc3QyMC5qb2luKFwiXFxuLS0tXFxuXCIpLnN1YnN0cmluZygwLCA4MDAwKTsKICB9KSgp
  
  CONV_AS="/tmp/croppy-handoff-conv-9.as"
  cat > "" << CONVEOF
tell application "Google Chrome"
  set t to tab  of window 
  set b64Js to ""
  set decodedJs to do shell script "echo " & quoted form of b64Js & " | base64 -d"
  return execute t javascript decodedJs
end tell
CONVEOF
  CONVERSATION=/bin/sh: 136: osascript: not found
  rm -f ""
  
  SUMMARY_FILE="/tmp/croppy-handoff-summary.md"
  
  if [ "" = "gemini" ]; then
    printf '%s' "以下の会話を引き継ぎ用に要約してください。重要な決定事項、未完了タスク、次のアクションを箇条書きで。500文字以内。

" > /tmp/croppy-handoff-prompt.txt
    gemini < /tmp/croppy-handoff-prompt.txt > "" 2>/dev/null
    rm -f /tmp/croppy-handoff-prompt.txt
  else
    echo "" | tail -c 3000 > ""
  fi
  
  SUMMARY=
  echo "[4/7] Summary: 0 chars"
  
  echo "[5/7] Opening new tab..."
  "/bin/sh" open ""
  sleep 6
  
  NEW_WT=
  if [ -z "" ]; then
    echo "ERROR: Could not find new tab"
    exit 1
  fi
  
  OLD_NUM=
  OLD_NUM="1"
  
  "/bin/sh" mark "" ""
  echo "[6/7] Marked  as [J-WORKER-]"
  
  sleep 2
  HANDOFF_MSG="前チャットからの引き継ぎです。

## 要約


## 指示
croppy-notes.mdとM1.mdを読んで、上記の文脈を踏まえて作業を再開してください。"
  
  "/bin/sh" inject "" ""
  echo "[7/7] Injected summary into "
  
  "/bin/sh" unmark ""
  
  printf '%s' "2026-03-10 06:47 HANDOFF:  ->  (tokens~)
" >> ~/Machinelab\ Dropbox/Matsuoka\ Daijiro/JARVIS-Journal/croppy-notes.md
  
  log "HANDOFF COMPLETE:  -> "
  echo ""
  echo "=== HANDOFF COMPLETE ==="
  echo "Old:  (unmarked)"
  echo "New:  [J-WORKER-]"
  echo "Summary: "
  ;;

# ============================================================
# FALLBACK-CHECK: DOM health check for UI breakage detection
# Usage: fallback-check <W:T>
# Returns: HEALTHY / DEGRADED / BROKEN + details
# ============================================================
fallback-check)
  WT=""
  if [ -z "" ]; then
    echo "Usage: /bin/sh fallback-check <W:T>"
    exit 1
  fi
  WIDX=""
  TIDX=""
  
  JS_B64=KCgpID0+IHsKICAgIHZhciBjaGVja3MgPSB7fTsKICAgIGNoZWNrcy5wcm9zZW1pcnJvciA9ICEhZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5Qcm9zZU1pcnJvclwiKTsKICAgIGNoZWNrcy5jbGF1ZGVSZXNwb25zZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoXCIuZm9udC1jbGF1ZGUtcmVzcG9uc2VcIikubGVuZ3RoOwogICAgY2hlY2tzLmVycm9yRGlhbG9nID0gISEoCiAgICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCJbcm9sZT1kaWFsb2ddXCIpIHx8CiAgICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIuZXJyb3JcIikgfHwKICAgICAgZG9jdW1lbnQuYm9keS5pbm5lclRleHQubWF0Y2goL2NvbnZlcnNhdGlvbiBpcyB0b28gbG9uZ3zkvJroqbHjgYzplbfjgZnjgY58c29tZXRoaW5nIHdlbnQgd3Jvbmd85ZWP6aGM44GM55m655SfLykKICAgICk7CiAgICBjaGVja3Muc2VuZEJ1dHRvbiA9ICEhKAogICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiYnV0dG9uW2FyaWEtbGFiZWw9XFxcIlNlbmQgTWVzc2FnZVxcXCJdXCIpIHx8CiAgICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCJidXR0b25bYXJpYS1sYWJlbD1cXFwi44Oh44OD44K744O844K444KS6YCB5L+hXFxcIl1cIikgfHwKICAgICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcImZpZWxkc2V0IGJ1dHRvblt0eXBlPVxcXCJidXR0b25cXFwiXVwiKQogICAgKTsKICAgIGNoZWNrcy5yYXRlTGltaXQgPSAhISgKICAgICAgZG9jdW1lbnQuYm9keS5pbm5lclRleHQubWF0Y2goL3JhdGUgbGltaXR8dXNhZ2UgbGltaXR844Os44O844OI5Yi26ZmQfOWIqeeUqOWItumZkC8pCiAgICApOwogICAgCiAgICB2YXIgc3RhdHVzID0gXCJIRUFMVEhZXCI7CiAgICB2YXIgaXNzdWVzID0gW107CiAgICBpZiAoIWNoZWNrcy5wcm9zZW1pcnJvcikgeyBzdGF0dXMgPSBcIkJST0tFTlwiOyBpc3N1ZXMucHVzaChcIk5PX0VESVRPUlwiKTsgfQogICAgaWYgKGNoZWNrcy5lcnJvckRpYWxvZykgeyBzdGF0dXMgPSBcIkJST0tFTlwiOyBpc3N1ZXMucHVzaChcIkVSUk9SX0RJQUxPR1wiKTsgfQogICAgaWYgKGNoZWNrcy5yYXRlTGltaXQpIHsgc3RhdHVzID0gXCJCUk9LRU5cIjsgaXNzdWVzLnB1c2goXCJSQVRFX0xJTUlURURcIik7IH0KICAgIGlmICghY2hlY2tzLnNlbmRCdXR0b24gJiYgY2hlY2tzLnByb3NlbWlycm9yKSB7IHN0YXR1cyA9IFwiREVHUkFERURcIjsgaXNzdWVzLnB1c2goXCJOT19TRU5EX0JUTlwiKTsgfQogICAgCiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe3N0YXR1czogc3RhdHVzLCBpc3N1ZXM6IGlzc3VlcywgZGV0YWlsczogY2hlY2tzfSk7CiAgfSkoKQ==
  
  ASFILE="/tmp/croppy-fallback-9.as"
  cat > "" << FBEOF
tell application "Google Chrome"
  set t to tab  of window 
  set b64Js to ""
  set decodedJs to do shell script "echo " & quoted form of b64Js & " | base64 -d"
  return execute t javascript decodedJs
end tell
FBEOF
  RESULT=/bin/sh: 246: osascript: not found
  rm -f ""
  
  echo "" | python3 -c '
import json,sys
try:
    d = json.loads(sys.stdin.read().strip())
    print(f"Status: {d["status"]}")
    if d["issues"]:
        print(f"Issues: {", ".join(d["issues"])}")
    det = d["details"]
    print(f"  Editor: {"OK" if det["prosemirror"] else "MISSING"}")
    print(f"  Responses: {det["claudeResponse"]}")
    print(f"  Send button: {"OK" if det["sendButton"] else "MISSING"}")
    print(f"  Error dialog: {"YES" if det["errorDialog"] else "no"}")
    print(f"  Rate limit: {"YES" if det["rateLimit"] else "no"}")
except:
    print("PARSE_ERROR")
    import traceback; traceback.print_exc()
' 2>/dev/null || echo ""
  
  HEALTH_STATUS=
  if [ "" = "BROKEN" ]; then
    log "FALLBACK-CHECK: BROKEN at  - "
    if [ -f ~/claude-telegram-bot/scripts/notify-dj.sh ]; then
      bash ~/claude-telegram-bot/scripts/notify-dj.sh "Worker  BROKEN: . claude.aiを直接使ってください。"
    fi
  fi
  ;;


# ============================================================
# ============================================================
# NEW-CHAT: Open new claude.ai project tab, inject message, poll for title
# Usage: new-chat "message"
# Output: CHAT_TITLE:<title>  WT:<W:T>
# ============================================================
new-chat)
  MESSAGE="$2"
  if [ -z "$MESSAGE" ]; then
    echo "ERROR: usage: new-chat \"message\""
    exit 1
  fi

  # Get project URL from config
  CONFIG="${HOME}/claude-telegram-bot/.croppy-workers.json"
  PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
  if [ -f "$CONFIG" ]; then
    PROJECT_URL=$(python3 -c "import json; d=json.load(open('$CONFIG')); print(d['workers'][0]['url'])" 2>/dev/null || echo "$PROJECT_URL")
  fi

  # Get front window index and current tab count
  BEFORE_INFO=$(osascript 2>/dev/null -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))')
  WIDX=$(echo "$BEFORE_INFO" | awk '{print $1}')
  TBEFORE=$(echo "$BEFORE_INFO" | awk '{print $2}')

  if [ -z "$WIDX" ] || [ -z "$TBEFORE" ]; then
    echo "ERROR: Chrome not responding"
    exit 1
  fi

  # Open new tab at project URL
  osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  activate
  tell window $WIDX
    set newTab to make new tab
    set URL of newTab to \"$PROJECT_URL\"
  end tell
end tell"

  TIDX=$((TBEFORE + 1))
  NEW_WT="${WIDX}:${TIDX}"
  log "new-chat: opened $NEW_WT"

  # Wait for page load
  sleep 6

  # Write message to tmp file and inject
  MSG_TMP="/tmp/croppy-newchat-msg-$$.txt"
  printf '%s' "$MESSAGE" > "$MSG_TMP"
  INJECT_RESULT=$(bash "$0" inject-raw "$NEW_WT" "$(cat "$MSG_TMP")")
  rm -f "$MSG_TMP"

  if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    echo "ERROR: inject failed on $NEW_WT: $INJECT_RESULT"
    exit 1
  fi

  log "new-chat: injected into $NEW_WT"

  # Return immediately - title set lazily on first reply
  CREATED_AT=$(TZ=Asia/Tokyo date '+%Y-%m-%d_%H%M')
  # Get conversation URL from tab
  CONV_URL=$(osascript 2>/dev/null -e "tell application \"Google Chrome\" to return URL of tab $TIDX of window $WIDX" || echo "")
  echo "CREATED_AT: $CREATED_AT"
  echo "WT: $NEW_WT"
  echo "CONV_URL: $CONV_URL"
  ;;

# ============================================================
# ============================================================
# INJECT-RAW: Inject without J-WORKER check (any claude.ai tab)
# Usage: inject-raw <W:T> "message"
# ============================================================
inject-raw)
  WT="$2"
  MSG="$3"
  if [ -z "$WT" ] || [ -z "$MSG" ]; then
    echo "Usage: $0 inject-raw <W:T> \"message\""
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)

  # Wait for editor ready using AS file (avoids shell quoting issues)
  EDITOR_READY=0
  for i in 1 2 3 4 5 6 7 8; do
    CHKFILE="/tmp/croppy-rawcheck-$$.as"
    cat > "$CHKFILE" << CHKEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => { const e = document.querySelector('.ProseMirror'); if (!e) return 'NO_EDITOR'; const retry = document.querySelector('button[aria-label=\"Retry\"]') || document.querySelector('button[aria-label=\"再試行\"]'); if (retry) return 'READY'; const s = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]'); if (s && s.getBoundingClientRect().width > 0) return 'BUSY'; return 'READY'; })()"
  return execute t javascript js
end tell
CHKEOF
    STATUS=$(osascript "$CHKFILE" 2>&1)
    rm -f "$CHKFILE"
    if [ "$STATUS" = "READY" ]; then
      EDITOR_READY=1
      break
    fi
    sleep 2
  done

  if [ "$EDITOR_READY" != "1" ]; then
    echo "BLOCKED:NO_EDITOR_TIMEOUT:last=$STATUS"
    exit 1
  fi

  B64MSG=$(printf '%s' "$MSG" | base64 | tr -d '\n')
  ASFILE="/tmp/croppy-inject-raw-$$.as"
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
  log "INJECT-RAW $WT: $RESULT"
  echo "$RESULT"
  ;;

# ============================================================
# RENAME-CONVERSATION: Rename claude.ai conversation via internal API
# Usage: rename-conversation <W:T> <new_title>
# ============================================================
rename-conversation)
  WT="$2"
  NEW_NAME="$3"
  if [ -z "$WT" ] || [ -z "$NEW_NAME" ]; then
    echo "ERROR: usage: rename-conversation <W:T> <new_title>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)
  B64NAME=$(printf '%s' "$NEW_NAME" | base64 | tr -d '\n')

  PYHELPER="/tmp/croppy-rename-helper-$$.py"
  ASFILE="/tmp/croppy-rename-conv-$$.as"

  cat > "$PYHELPER" << 'PYEOF'
import json, sys
b64, tidx, widx = sys.argv[1], sys.argv[2], sys.argv[3]
js = (
    "(() => {"
    "const b=Uint8Array.from(atob('" + b64 + "'),c=>c.charCodeAt(0));"
    "const name=new TextDecoder().decode(b);"
    "const ox=new XMLHttpRequest();"
    "ox.open('GET','/api/organizations',false);"
    "ox.withCredentials=true;ox.send();"
    "const orgs=JSON.parse(ox.responseText);"
    "const orgId=Array.isArray(orgs)?orgs[0].uuid:orgs.uuid;"
    "if(!orgId)return 'NO_ORG_ID';"
    r"const m=location.pathname.match(/\/chat\/([-\w]+)/);"
    "if(!m)return 'NO_CONV_ID';"
    "const convId=m[1];"
    "const x=new XMLHttpRequest();"
    "x.open('PUT','/api/organizations/'+orgId+'/chat_conversations/'+convId,false);"
    "x.withCredentials=true;"
    "x.setRequestHeader('Content-Type','application/json');"
    "x.send(JSON.stringify({name:name}));"
    "return x.status+':'+x.responseText.substring(0,50);"
    "})()"
)
lines = [
    'tell application "Google Chrome"',
    f'  set t to tab {tidx} of window {widx}',
    f'  return execute t javascript {json.dumps(js)}',
    'end tell'
]
print('\n'.join(lines))
PYEOF

  python3 "$PYHELPER" "$B64NAME" "$TIDX" "$WIDX" > "$ASFILE"
  rm -f "$PYHELPER"
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  log "RENAME-CONV $WT -> $NEW_NAME: $RESULT"
  echo "$RESULT"
  ;;

# ============================================================
# REOPEN-AND-INJECT: Open a conversation URL in new tab and inject message
# Usage: reopen-and-inject <url> "message"
# Output: CREATED_AT:<t>  WT:<w:t>  INSERTED:SENT or ERROR
# ============================================================
reopen-and-inject)
  URL="$2"
  MESSAGE="$3"
  if [ -z "$URL" ] || [ -z "$MESSAGE" ]; then
    echo "ERROR: usage: reopen-and-inject <url> \"message\""
    exit 1
  fi

  BEFORE_INFO=$(osascript 2>/dev/null -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))')
  WIDX=$(echo "$BEFORE_INFO" | awk '{print $1}')
  TBEFORE=$(echo "$BEFORE_INFO" | awk '{print $2}')

  osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  activate
  tell window $WIDX
    set newTab to make new tab
    set URL of newTab to \"$URL\"
  end tell
end tell"

  TIDX=$((TBEFORE + 1))
  NEW_WT="${WIDX}:${TIDX}"

  # Write message and inject
  MSG_TMP="/tmp/croppy-reopen-msg-$$.txt"
  printf '%s' "$MESSAGE" > "$MSG_TMP"
  INJECT_RESULT=$(bash "$0" inject-raw "$NEW_WT" "$(cat "$MSG_TMP")")
  rm -f "$MSG_TMP"

  if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    echo "ERROR: inject failed: $INJECT_RESULT"
    exit 1
  fi

  echo "WT: $NEW_WT"
  echo "INSERTED:SENT"
  ;;

# INJECT-BY-TITLE: Find claude.ai tab by partial title and inject
# Usage: inject-by-title "partial_title" "message"
# Output: INSERTED:SENT or NOT_FOUND:<query>
# ============================================================
inject-by-title)
  QUERY="$2"
  MESSAGE="$3"
  if [ -z "$QUERY" ] || [ -z "$MESSAGE" ]; then
    echo "ERROR: usage: inject-by-title \"partial_title\" \"message\""
    exit 1
  fi

  # Get all claude.ai tabs
  ALL_TABS=$(bash "$0" list-all 2>/dev/null)

  # Try exact match first, then case-insensitive partial
  MATCH=$(echo "$ALL_TABS" | grep -F "$QUERY" | head -1)
  if [ -z "$MATCH" ]; then
    MATCH=$(echo "$ALL_TABS" | grep -i "$QUERY" | head -1)
  fi

  if [ -z "$MATCH" ]; then
    echo "NOT_FOUND: $QUERY"
    exit 1
  fi

  # Extract W:T (first field before |)
  WT=$(echo "$MATCH" | awk -F'|' '{print $1}' | tr -d ' ')
  FOUND_TITLE=$(echo "$MATCH" | awk -F'|' '{print $2}' | sed 's/^ *//;s/ *$//')
  log "inject-by-title: found \"$FOUND_TITLE\" at $WT"

  # Write message to tmp and inject
  MSG_TMP2="/tmp/croppy-ibt-msg-$$.txt"
  printf '%s' "$MESSAGE" > "$MSG_TMP2"
  RESULT=$(bash "$0" inject-raw "$WT" "$(cat "$MSG_TMP2")")
  rm -f "$MSG_TMP2"
  if echo "$RESULT" | grep -q "INSERTED:SENT"; then
    echo "INSERTED:SENT"
    echo "WT: $WT"
  else
    echo "$RESULT"
  fi
  ;;

# ============================================================
# SETUP-WORKERS: Open N worker tabs, mark them, update config
# Usage: setup-workers [N=10]
# ============================================================
setup-workers)
  N="${2:-10}"

  CONFIG="${HOME}/claude-telegram-bot/.croppy-workers.json"
  PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
  if [ -f "$CONFIG" ]; then
    PROJECT_URL=$(python3 -c "import json; d=json.load(open('$CONFIG')); print(d['workers'][0]['url'])" 2>/dev/null || echo "$PROJECT_URL")
  fi

  echo "Opening $N worker tabs at: $PROJECT_URL"

  for i in $(seq 1 $N); do
    BEFORE=$(osascript 2>/dev/null -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))')
    WX=$(echo "$BEFORE" | awk '{print $1}')
    TX=$(echo "$BEFORE" | awk '{print $2}')

    osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  activate
  tell window $WX
    set newTab to make new tab
    set URL of newTab to \"$PROJECT_URL\"
  end tell
end tell"

    sleep 3
    NEW_TX=$((TX + 1))
    WT="${WX}:${NEW_TX}"
    bash "$0" mark "$WT" "$i"
    echo "Worker $i: $WT"
    sleep 1
  done

  # Update config
  python3 << PYEOF2
import json
workers = [{"num": i, "url": "$PROJECT_URL"} for i in range(1, $N + 1)]
with open("$CONFIG", "w") as f:
    json.dump({"workers": workers}, f, indent=2)
print(f"Config updated: $N workers in $CONFIG")
PYEOF2
  ;;

# ============================================================
# GET-TITLE: Get current tab title
# Usage: get-title <W:T>
# ============================================================
get-title)
  WT="$2"
  if [ -z "$WT" ]; then echo "ERROR: usage: get-title <W:T>"; exit 1; fi
  WIDX="${WT%%:*}"; TIDX="${WT##*:}"
  osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  try
    return title of tab $TIDX of window $WIDX
  on error
    return \"\"
  end try
end tell"
  ;;

# ============================================================
# SET-TITLE: Set document.title of a tab
# Usage: set-title <W:T> <new_title>
# ============================================================
set-title)
  WT="$2"; NEW_TITLE="$3"
  if [ -z "$WT" ] || [ -z "$NEW_TITLE" ]; then echo "ERROR: usage: set-title <W:T> <title>"; exit 1; fi
  WIDX="${WT%%:*}"; TIDX="${WT##*:}"
  ESCAPED=$(printf '%s' "$NEW_TITLE" | sed 's/\\/\\\\/g; s/"/\\"/g')
  osascript 2>/dev/null -e "
tell application \"Google Chrome\"
  try
    execute tab $TIDX of window $WIDX javascript \"document.title = \\\"$ESCAPED\\\"\"
    return \"OK\"
  on error e
    return \"ERROR: \" & e
  end try
end tell"
  ;;



# ============================================================
# INJECT-FILE: Inject message from file (avoids shell quoting)
# Usage: inject-file <W:T> <filepath>
# ============================================================
inject-file)
  WT="$2"
  FPATH="$3"
  if [ -z "$WT" ] || [ -z "$FPATH" ] || [ ! -f "$FPATH" ]; then
    echo "Usage: $0 inject-file <W:T> <filepath>"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)

  # Wait for editor ready
  EDITOR_READY=0
  for i in 1 2 3 4 5 6 7 8; do
    CHKFILE="/tmp/croppy-fileinj-chk-$$.as"
    cat > "$CHKFILE" << CHKEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => { const e = document.querySelector('.ProseMirror'); if (!e) return 'NO_EDITOR'; const retry = document.querySelector('button[aria-label=\"Retry\"]') || document.querySelector('button[aria-label=\"再試行\"]'); if (retry) return 'READY'; const s = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]'); if (s && s.getBoundingClientRect().width > 0) return 'BUSY'; return 'READY'; })()"
  return execute t javascript js
end tell
CHKEOF
    STATUS=$(osascript "$CHKFILE" 2>&1)
    rm -f "$CHKFILE"
    if [ "$STATUS" = "READY" ]; then
      EDITOR_READY=1
      break
    fi
    sleep 2
  done

  if [ "$EDITOR_READY" != "1" ]; then
    echo "BLOCKED:NO_EDITOR_TIMEOUT:last=$STATUS"
    exit 1
  fi

  # Base64 encode file content (safe for any content)
  B64MSG=$(base64 < "$FPATH" | tr -d '\n')
  ASFILE="/tmp/croppy-inject-file-$$.as"
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
  log "inject-file: $WT from $FPATH -> $RESULT"
  echo "$RESULT"
  ;;


# ============================================================
# WAIT-RESPONSE: Poll until BUSY->READY, then read response
# Usage: wait-response <W:T> [timeout_sec]
# Returns: response text, or TIMEOUT, or ERROR
# ============================================================
wait-response)
  WT="$2"
  TIMEOUT_SEC="${3:-300}"
  if [ -z "$WT" ]; then
    echo "Usage: $0 wait-response <W:T> [timeout_sec]"
    exit 1
  fi
  WIDX=$(echo "$WT" | cut -d: -f1)
  TIDX=$(echo "$WT" | cut -d: -f2)

  log "wait-response: $WT timeout=${TIMEOUT_SEC}s"
  ELAPSED=0
  PREV_STATUS=""

  while [ "$ELAPSED" -lt "$TIMEOUT_SEC" ]; do
    STATUS=$(bash "$0" check-status "$WT" 2>/dev/null)

    # Log status transitions
    if [ "$STATUS" != "$PREV_STATUS" ]; then
      log "wait-response: $WT status=$STATUS (${ELAPSED}s)"
      PREV_STATUS="$STATUS"
    fi

    # READY = response complete
    if [ "$STATUS" = "READY" ]; then
      # Small delay to ensure DOM is settled
      sleep 1
      RESPONSE=$(bash "$0" read-response "$WT" 2>/dev/null)
      if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
        echo "NO_RESPONSE"
      else
        echo "$RESPONSE"
      fi
      exit 0
    fi

    # ERROR states = bail out
    if [ "$STATUS" = "NO_EDITOR" ] || [ "$STATUS" = "ERROR" ]; then
      log "wait-response: $WT error status=$STATUS"
      echo "ERROR:$STATUS"
      exit 1
    fi

    # BUSY = still generating, keep polling
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done

  log "wait-response: $WT TIMEOUT after ${TIMEOUT_SEC}s"
  echo "TIMEOUT"
  exit 0
  ;;


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
  echo "  token-estimate <W:T>     Estimate token usage"
  echo "  handoff <W:T> <URL>      Full chat handoff"
  echo "  fallback-check <W:T>     DOM health check"
  ;;
esac
