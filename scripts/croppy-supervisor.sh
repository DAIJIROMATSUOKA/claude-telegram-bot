#!/bin/bash
# croppy-supervisor.sh - Autonomous worker tab supervisor
# Location: ~/claude-telegram-bot/scripts/croppy-supervisor.sh
#
# Usage:
#   ./croppy-supervisor.sh detect <W:T>          # Full state detection
#   ./croppy-supervisor.sh click-stop <W:T>      # Click Stop Response
#   ./croppy-supervisor.sh click-retry <W:T>     # Click last Retry button
#   ./croppy-supervisor.sh new-chat <W:T>        # Navigate to project URL (new chat)
#   ./croppy-supervisor.sh handoff <W:T>         # Save context + new chat + inject
#   ./croppy-supervisor.sh watch <W:T>           # Continuous monitoring loop (10s)
#   ./croppy-supervisor.sh watch-all             # Monitor all [J-WORKER] tabs

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPT_DIR/croppy-tab-manager.sh"
NOTIFY="$SCRIPT_DIR/notify-dj.sh"
LOG="/tmp/croppy-supervisor.log"
STALL_THRESHOLD=30  # seconds with no text growth = stalled
WATCH_INTERVAL=10   # seconds between checks
MAX_RETRY=3         # max auto-retry before giving up
HANDOFF_DIR="/tmp/croppy-handoffs"

mkdir -p "$HANDOFF_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# ============================================================
# DETECT: Full state detection for a worker tab
# Returns: READY / BUSY / STALLED / RATE_LIMIT / LONG_CHAT / ERROR / NO_EDITOR
# ============================================================
do_detect() {
  local WIDX="$1" TIDX="$2"
  
  ASFILE="/tmp/croppy-detect-$$.as"
  cat > "$ASFILE" << DETECTEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => {
    const e = document.querySelector('.ProseMirror');
    if (!e) return JSON.stringify({state: 'NO_EDITOR'});
    
    // Stop button = actively generating
    const stop = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]');
    const stopVisible = stop ? stop.getBoundingClientRect().width > 0 : false;
    
    // Retry button = response done or failed
    const retry = document.querySelector('button[aria-label=\"Retry\"]') || document.querySelector('button[aria-label=\"再試行\"]');
    const retryVisible = retry ? retry.getBoundingClientRect().width > 0 : false;
    
    // Last assistant message length (for stall detection)
    const blocks = document.querySelectorAll('[data-is-streaming]');
    const streaming = blocks.length > 0;
    const allText = document.querySelector('main') ? document.querySelector('main').innerText : '';
    const textLen = allText.length;
    
    // Error/limit detection
    const bodyText = document.body.innerText;
    const rateLimit = bodyText.includes('rate limit') || bodyText.includes('Usage limit') || bodyText.includes('limit reached') || bodyText.includes('メッセージ数の上限');
    const longChat = bodyText.includes('long conversation') || bodyText.includes('This conversation is getting long') || bodyText.includes('長い会話');
    const errorMsg = bodyText.includes('Something went wrong') || bodyText.includes('エラーが発生');
    
    // Editor disabled
    const editorDisabled = e.getAttribute('contenteditable') === 'false';
    
    // Project URL for new chat
    const projLink = document.querySelector('a[href*=\"/project/\"]');
    const projUrl = projLink ? projLink.href : '';
    
    let state = 'READY';
    if (rateLimit) state = 'RATE_LIMIT';
    else if (longChat) state = 'LONG_CHAT';
    else if (errorMsg) state = 'ERROR';
    else if (stopVisible && !streaming) state = 'STALLED';
    else if (stopVisible) state = 'BUSY';
    else if (retryVisible) state = 'READY';
    else if (editorDisabled) state = 'ERROR';
    
    return JSON.stringify({
      state: state,
      stopVisible: stopVisible,
      retryVisible: retryVisible,
      streaming: streaming,
      textLen: textLen,
      rateLimit: rateLimit,
      longChat: longChat,
      errorMsg: errorMsg,
      editorDisabled: editorDisabled,
      projUrl: projUrl,
      url: window.location.href
    });
  })()"
  return execute t javascript js
end tell
DETECTEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
}

# ============================================================
# CLICK-STOP: Click Stop Response button
# ============================================================
do_click_stop() {
  local WIDX="$1" TIDX="$2"
  
  ASFILE="/tmp/croppy-clickstop-$$.as"
  cat > "$ASFILE" << CSEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => { const stop = document.querySelector('button[aria-label=\"Stop Response\"]') || document.querySelector('button[aria-label=\"応答を停止\"]'); if (stop) { stop.click(); return 'STOPPED'; } return 'NO_BUTTON'; })()"
  return execute t javascript js
end tell
CSEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
}

# ============================================================
# CLICK-RETRY: Click last Retry button
# ============================================================
do_click_retry() {
  local WIDX="$1" TIDX="$2"
  
  ASFILE="/tmp/croppy-clickretry-$$.as"
  cat > "$ASFILE" << CREOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => { const btns = document.querySelectorAll('button[aria-label=\"Retry\"], button[aria-label=\"再試行\"]'); if (btns.length > 0) { btns[btns.length - 1].click(); return 'RETRIED'; } return 'NO_BUTTON'; })()"
  return execute t javascript js
end tell
CREOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
}

# ============================================================
# NEW-CHAT: Navigate to project URL (creates fresh chat)
# ============================================================
do_new_chat() {
  local WIDX="$1" TIDX="$2" PROJ_URL="$3"
  
  if [ -z "$PROJ_URL" ]; then
    # Extract project URL from current page
    PROJ_URL=$(do_detect "$WIDX" "$TIDX" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('projUrl',''))" 2>/dev/null)
  fi
  
  if [ -z "$PROJ_URL" ]; then
    echo "ERROR: No project URL"
    return 1
  fi
  
  ASFILE="/tmp/croppy-newchat-$$.as"
  cat > "$ASFILE" << NCEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set URL of t to "$PROJ_URL"
  return "NAVIGATED"
end tell
NCEOF
  RESULT=$(osascript "$ASFILE" 2>&1)
  rm -f "$ASFILE"
  echo "$RESULT"
}

# ============================================================
# HANDOFF: Save context from current chat, open new chat, inject context
# ============================================================
do_handoff() {
  local WT="$1"
  local WIDX=$(echo "$WT" | cut -d: -f1)
  local TIDX=$(echo "$WT" | cut -d: -f2)
  
  log "HANDOFF start for $WT"
  
  # 1. Get current chat URL and project URL
  DETECT=$(do_detect "$WIDX" "$TIDX")
  PROJ_URL=$(echo "$DETECT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('projUrl',''))" 2>/dev/null)
  CHAT_URL=$(echo "$DETECT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('url',''))" 2>/dev/null)
  STATE=$(echo "$DETECT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('state',''))" 2>/dev/null)
  
  if [ -z "$PROJ_URL" ]; then
    log "HANDOFF FAILED: no project URL"
    echo "ERROR: No project URL"
    return 1
  fi
  
  # 2. Self-summary: ask 🦞 to summarize before leaving
  SUMMARY=""
  SUMMARY_REQUEST="この会話で行った作業・決定事項・未完了タスクを5行以内で要約してください。次のチャットへの引き継ぎに使います。"
  
  if [ "$STATE" = "READY" ]; then
    log "HANDOFF: injecting summary request"
    "$TAB_MANAGER" inject "$WT" "$SUMMARY_REQUEST" 2>/dev/null
    
    # Wait for response (poll READY: BUSY->READY transition)
    sleep 3  # Initial wait for BUSY state
    local SUMMARY_WAIT=0
    local SUMMARY_MAX=60  # 60 seconds max wait
    while [ "$SUMMARY_WAIT" -lt "$SUMMARY_MAX" ]; do
      sleep 3
      SUMMARY_WAIT=$((SUMMARY_WAIT + 3))
      local S_STATE
      S_STATE=$(do_detect "$WIDX" "$TIDX" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('state',''))" 2>/dev/null)
      if [ "$S_STATE" = "READY" ]; then
        log "HANDOFF: summary response received (${SUMMARY_WAIT}s)"
        break
      fi
      if [ "$S_STATE" = "ERROR" ] || [ "$S_STATE" = "RATE_LIMIT" ]; then
        log "HANDOFF: summary failed ($S_STATE), proceeding without"
        break
      fi
    done
    
    # Extract last assistant message as summary
    ASFILE="/tmp/croppy-summary-$$.as"
    cat > "$ASFILE" << SUMEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => {
    const msgs = document.querySelectorAll('[data-testid] .font-claude-message, [class*=\"claude\"] .whitespace-pre-wrap, [class*=\"assistant\"] .whitespace-pre-wrap');
    if (msgs.length === 0) return '';
    const last = msgs[msgs.length - 1];
    return last.innerText.substring(0, 1500);
  })()"
  return execute t javascript js
end tell
SUMEOF
    SUMMARY=$(osascript "$ASFILE" 2>&1)
    rm -f "$ASFILE"
    
    if [ -n "$SUMMARY" ] && [ ${#SUMMARY} -gt 20 ]; then
      log "HANDOFF: summary captured (${#SUMMARY} chars)"
    else
      log "HANDOFF: summary too short or empty, falling back to DOM extract"
      SUMMARY=""
    fi
  else
    log "HANDOFF: skipping summary (state=$STATE, not READY)"
  fi
  
  # 3. Fallback: extract last messages if no summary
  if [ -z "$SUMMARY" ]; then
    ASFILE="/tmp/croppy-extract-$$.as"
    cat > "$ASFILE" << EXEOF
tell application "Google Chrome"
  set t to tab $TIDX of window $WIDX
  set js to "(() => {
    const msgs = document.querySelectorAll('[data-testid] .font-claude-message, .font-user-message, .whitespace-pre-wrap');
    const last5 = Array.from(msgs).slice(-6).map(m => m.innerText.substring(0, 500));
    return JSON.stringify(last5);
  })()"
  return execute t javascript js
end tell
EXEOF
    FALLBACK_CONTEXT=$(osascript "$ASFILE" 2>&1)
    rm -f "$ASFILE"
    
    SUMMARY=$(echo "$FALLBACK_CONTEXT" | python3 -c "
import json, sys
try:
    msgs = json.loads(sys.stdin.read())
    for m in msgs[-3:]:
        print('---')
        print(m[:300])
except:
    print('(context extraction failed)')
" 2>/dev/null)
  fi
  
  # 4. Save summary to temp file for safe JSON serialization
  printf '%s' "$SUMMARY" > /tmp/croppy-handoff-summary.txt
  
  # 5. Save handoff file
  HANDOFF_FILE="$HANDOFF_DIR/handoff-$(date +%Y%m%d-%H%M%S).json"
  python3 << PYSAVE
import json
data = {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "from_chat": "$CHAT_URL",
    "project_url": "$PROJ_URL",
    "summary": open("/tmp/croppy-handoff-summary.txt").read()[:2000] if __import__("os").path.exists("/tmp/croppy-handoff-summary.txt") else ""
}
with open("$HANDOFF_FILE", "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
PYSAVE
  log "HANDOFF context saved: $HANDOFF_FILE"
  
  # 6. Extract worker number from tab title before navigation
  WORKER_NUM=$("$TAB_MANAGER" list 2>/dev/null | grep "^${WT}" | python3 -c "
import sys, re
line = sys.stdin.read()
m = re.search(r'\[J-WORKER-(\d+)\]', line)
print(m.group(1) if m else '1')
" 2>/dev/null)
  
  # 7. Navigate to project URL (new chat)
  do_new_chat "$WIDX" "$TIDX" "$PROJ_URL"
  sleep 5  # Wait for page load
  
  # 8. Re-mark the tab
  "$TAB_MANAGER" mark "$WT" "$WORKER_NUM" 2>/dev/null
  sleep 2
  
  # 9. Inject handoff context with summary
  HANDOFF_MSG="[HANDOFF - 前チャットからの引き継ぎ]

## 前チャット要約:
$SUMMARY

---
引き続きタスクを実行してください。完了したらnotify-dj.shで通知。"
  
  "$TAB_MANAGER" inject "$WT" "$HANDOFF_MSG" 2>/dev/null
  
  log "HANDOFF complete: $WT → new chat in $PROJ_URL (summary=${#SUMMARY}chars)"
  echo "HANDOFF_OK"
}

# ============================================================
# WATCH: Continuous monitoring loop for a single worker tab
# ============================================================
do_watch() {
  local WT="$1"
  local WIDX=$(echo "$WT" | cut -d: -f1)
  local TIDX=$(echo "$WT" | cut -d: -f2)
  local PREV_TEXT_LEN=0
  local STALL_COUNT=0
  local RETRY_COUNT=0
  
  log "WATCH start: $WT (interval=${WATCH_INTERVAL}s, stall=${STALL_THRESHOLD}s)"
  
  while true; do
    # Check stop flag
    if [ -f /tmp/croppy-stop ]; then
      log "WATCH stopped by /tmp/croppy-stop"
      break
    fi
    
    # Detect state
    RAW=$(do_detect "$WIDX" "$TIDX")
    STATE=$(echo "$RAW" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('state','ERROR'))" 2>/dev/null)
    TEXT_LEN=$(echo "$RAW" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('textLen',0))" 2>/dev/null)
    
    case "$STATE" in
      READY)
        STALL_COUNT=0
        RETRY_COUNT=0
        # Silent - normal state
        ;;
      
      BUSY)
        # Check for stall: text not growing
        if [ "$TEXT_LEN" = "$PREV_TEXT_LEN" ]; then
          STALL_COUNT=$((STALL_COUNT + WATCH_INTERVAL))
          if [ "$STALL_COUNT" -ge "$STALL_THRESHOLD" ]; then
            log "STALLED: $WT (${STALL_COUNT}s no text growth)"
            STATE="STALLED"
            # Fall through to STALLED handler below
          fi
        else
          STALL_COUNT=0
        fi
        ;;
      
      RATE_LIMIT)
        log "RATE_LIMIT: $WT - auto handoff"
        "$NOTIFY" "⚠️ Worker $WT rate limited. Auto-rotating to new chat..." 2>/dev/null
        do_handoff "$WT"
        STALL_COUNT=0
        RETRY_COUNT=0
        sleep 10  # Wait for new chat to load
        ;;
      
      LONG_CHAT)
        log "LONG_CHAT: $WT - auto handoff"
        "$NOTIFY" "📏 Worker $WT chat too long. Auto-rotating..." 2>/dev/null
        do_handoff "$WT"
        STALL_COUNT=0
        RETRY_COUNT=0
        sleep 10
        ;;
      
      ERROR)
        log "ERROR: $WT"
        if [ "$RETRY_COUNT" -lt "$MAX_RETRY" ]; then
          RETRY_COUNT=$((RETRY_COUNT + 1))
          log "Auto-retry $RETRY_COUNT/$MAX_RETRY"
          do_click_retry "$WIDX" "$TIDX"
          STALL_COUNT=0
          sleep 5
        else
          log "MAX_RETRY reached: $WT"
          "$NOTIFY" "🔴 Worker $WT error after $MAX_RETRY retries. Manual intervention needed." 2>/dev/null
          RETRY_COUNT=0
          sleep 60  # Back off
        fi
        ;;
      
      NO_EDITOR)
        log "NO_EDITOR: $WT - page may be loading"
        sleep 5
        ;;
    esac
    
    # Handle STALLED (from BUSY detection above)
    if [ "$STATE" = "STALLED" ]; then
      if [ "$RETRY_COUNT" -lt "$MAX_RETRY" ]; then
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log "STALL recovery $RETRY_COUNT/$MAX_RETRY: Stop → Retry"
        do_click_stop "$WIDX" "$TIDX"
        sleep 2
        do_click_retry "$WIDX" "$TIDX"
        STALL_COUNT=0
        sleep 5
      else
        log "STALL MAX_RETRY: $WT"
        "$NOTIFY" "🔴 Worker $WT stalled $MAX_RETRY times. Handoff..." 2>/dev/null
        do_handoff "$WT"
        STALL_COUNT=0
        RETRY_COUNT=0
        sleep 10
      fi
    fi
    
    PREV_TEXT_LEN="$TEXT_LEN"
    sleep "$WATCH_INTERVAL"
  done
  
  log "WATCH end: $WT"
}

# ============================================================
# WATCH-ALL: Monitor all [J-WORKER] tabs
# ============================================================
do_watch_all() {
  log "WATCH-ALL start"
  
  WORKERS=$("$TAB_MANAGER" list 2>/dev/null)
  if [ -z "$WORKERS" ]; then
    log "No workers found"
    exit 1
  fi
  
  # Launch watch for each worker in background
  PIDS=""
  while IFS= read -r line; do
    WT=$(echo "$line" | cut -d'|' -f1 | tr -d ' ')
    if [ -n "$WT" ]; then
      do_watch "$WT" &
      PID=$!
      PIDS="$PIDS $PID"
      log "Watching $WT (PID=$PID)"
    fi
  done <<< "$WORKERS"
  
  # Wait for all watchers (or until stop flag)
  log "All watchers launched: $PIDS"
  
  trap 'log "WATCH-ALL SIGTERM"; kill $PIDS 2>/dev/null; exit 0' TERM INT
  
  # Heartbeat loop
  while true; do
    if [ -f /tmp/croppy-stop ]; then
      log "WATCH-ALL stopped by flag"
      kill $PIDS 2>/dev/null
      break
    fi
    sleep 30
    # Check if watchers still alive
    for PID in $PIDS; do
      if ! kill -0 "$PID" 2>/dev/null; then
        log "Watcher $PID died, restarting watch-all"
        kill $PIDS 2>/dev/null
        exec "$0" watch-all
      fi
    done
  done
}

# ============================================================
# MAIN dispatch
# ============================================================
case "$1" in
  detect)
    WT="$2"
    [ -z "$WT" ] && { echo "Usage: $0 detect <W:T>"; exit 1; }
    WIDX=$(echo "$WT" | cut -d: -f1)
    TIDX=$(echo "$WT" | cut -d: -f2)
    do_detect "$WIDX" "$TIDX"
    ;;
  
  click-stop)
    WT="$2"
    [ -z "$WT" ] && { echo "Usage: $0 click-stop <W:T>"; exit 1; }
    WIDX=$(echo "$WT" | cut -d: -f1)
    TIDX=$(echo "$WT" | cut -d: -f2)
    do_click_stop "$WIDX" "$TIDX"
    ;;
  
  click-retry)
    WT="$2"
    [ -z "$WT" ] && { echo "Usage: $0 click-retry <W:T>"; exit 1; }
    WIDX=$(echo "$WT" | cut -d: -f1)
    TIDX=$(echo "$WT" | cut -d: -f2)
    do_click_retry "$WIDX" "$TIDX"
    ;;
  
  new-chat)
    WT="$2"
    PROJ_URL="$3"
    [ -z "$WT" ] && { echo "Usage: $0 new-chat <W:T> [project-url]"; exit 1; }
    WIDX=$(echo "$WT" | cut -d: -f1)
    TIDX=$(echo "$WT" | cut -d: -f2)
    do_new_chat "$WIDX" "$TIDX" "$PROJ_URL"
    ;;
  
  handoff)
    WT="$2"
    [ -z "$WT" ] && { echo "Usage: $0 handoff <W:T>"; exit 1; }
    do_handoff "$WT"
    ;;
  
  watch)
    WT="$2"
    [ -z "$WT" ] && { echo "Usage: $0 watch <W:T>"; exit 1; }
    do_watch "$WT"
    ;;
  
  watch-all)
    do_watch_all
    ;;
  
  *)
    echo "croppy-supervisor.sh - Autonomous worker tab supervisor"
    echo ""
    echo "Commands:"
    echo "  detect <W:T>              Full state detection"
    echo "  click-stop <W:T>          Click Stop Response"
    echo "  click-retry <W:T>         Click last Retry"
    echo "  new-chat <W:T> [url]      Navigate to new chat"
    echo "  handoff <W:T>             Context save + new chat + inject"
    echo "  watch <W:T>               Monitor single worker (10s loop)"
    echo "  watch-all                 Monitor all workers"
    ;;
esac
