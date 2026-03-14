#!/bin/bash
# project-tab-router.sh - Map project M-numbers to Chrome Worker Tabs
# Resolves M1317 -> W:T position, creating new chat if needed
#
# Usage:
#   ./project-tab-router.sh resolve <M1317>          # Get or create tab
#   ./project-tab-router.sh list                      # All mappings
#   ./project-tab-router.sh register <M1317> <url>    # Manual register
#   ./project-tab-router.sh cleanup                   # Re-resolve closed tabs

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
CONTEXT_BUILDER="$SCRIPTS_DIR/project-context-builder.sh"
GATEWAY="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
LOCAL_CACHE="$HOME/.croppy-project-tabs.json"
LOG="/tmp/project-tab-router.log"
MAX_PROJECT_TABS=6

# Validate W:T format (digits:digits)
validate_wt() {
  local wt="$1"
  if echo "$wt" | grep -qE '^[0-9]+:[0-9]+$'; then
    echo "$wt"
  else
    # Extract W:T pattern from garbled output
    local extracted
    extracted=$(echo "$wt" | grep -oE '[0-9]+:[0-9]+' | tail -1)
    if [ -n "$extracted" ]; then
      echo "$extracted"
    else
      echo "ERROR: invalid WT format: $wt"
    fi
  fi
}

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# ============================================================
# D1 helpers (with local fallback)
# ============================================================
d1_get() {
  local project_id="$1"
  local result
  result=$(curl -s --max-time 5 "$GATEWAY/v1/kv/get?key=ptab:$project_id" 2>/dev/null)
  if echo "$result" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and d.get("value")' 2>/dev/null; then
    echo "$result" | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])'
    return 0
  fi
  # Fallback: local cache
  if [ -f "$LOCAL_CACHE" ]; then
    python3 -c "import json; d=json.load(open('$LOCAL_CACHE')); print(d.get('$project_id',''))" 2>/dev/null
  fi
}

d1_set() {
  local project_id="$1"
  local value="$2"
  # D1 via gateway
  curl -s --max-time 5 -X POST "$GATEWAY/v1/kv/set" \
    -H 'Content-Type: application/json' \
    -d "{\"key\":\"ptab:$project_id\",\"value\":$(echo "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" > /dev/null 2>&1
  # Always also save locally
  if [ -f "$LOCAL_CACHE" ]; then
    python3 -c "
import json
d = json.load(open('$LOCAL_CACHE'))
d['$project_id'] = '''$value'''
json.dump(d, open('$LOCAL_CACHE','w'), indent=2)
" 2>/dev/null
  else
    python3 -c "
import json
json.dump({'$project_id': '''$value'''}, open('$LOCAL_CACHE','w'), indent=2)
" 2>/dev/null
  fi
}

d1_list() {
  local result
  result=$(curl -s --max-time 5 "$GATEWAY/v1/kv/list?prefix=ptab:" 2>/dev/null)
  if echo "$result" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok")' 2>/dev/null; then
    echo "$result" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for item in d.get("entries",[]):
    key=item.get("key","").replace("ptab:","")
    val=item.get("value","")
    print(f"{key} | {val}")
'
    return 0
  fi
  # Fallback: local
  if [ -f "$LOCAL_CACHE" ]; then
    python3 -c "
import json
d=json.load(open('$LOCAL_CACHE'))
for k,v in d.items():
    print(f'{k} | {v}')
" 2>/dev/null
  fi
}

# ============================================================
# Find tab by conv URL (scan all claude.ai tabs)
# ============================================================
find_tab_by_url() {
  local target_url="$1"
  # Extract conversation UUID from URL
  local conv_id
  conv_id=$(echo "$target_url" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | tail -1)
  if [ -z "$conv_id" ]; then
    echo ""
    return 1
  fi

  bash "$TAB_MANAGER" list-all 2>/dev/null | while IFS='|' read -r wt title url; do
    url_clean=$(echo "$url" | xargs)
    if echo "$url_clean" | grep -q "$conv_id"; then
      echo "$(echo "$wt" | xargs)"
      return 0
    fi
  done
}


# ============================================================
# Close excess project tabs (keep MAX_PROJECT_TABS open)
# Closes oldest tabs by WT position (lowest index = opened earliest)
# ============================================================
close_excess_project_tabs() {
  local exclude_wt="$1"  # newly created tab, don't close it
  if [ ! -f "$LOCAL_CACHE" ]; then return; fi

  # Get all project tabs with valid WTs
  local open_tabs=""
  local count=0
  while IFS='|' read -r proj_id url wt; do
    if [ -n "$wt" ] && [ "$wt" != "$exclude_wt" ]; then
      # Check if tab is actually open
      local status
      status=$(bash "$TAB_MANAGER" check-status "$wt" 2>/dev/null)
      if [ "$status" = "READY" ] || [ "$status" = "BUSY" ]; then
        open_tabs="$open_tabs $proj_id|$wt"
        count=$((count + 1))
      fi
    fi
  done < <(python3 -c "
import json, os
d = json.load(open(os.path.expanduser('$LOCAL_CACHE')))
for k, v in d.items():
    parts = v.split('|')
    url = parts[0] if len(parts) > 0 else ''
    wt = parts[1] if len(parts) > 1 else ''
    print(f'{k}|{url}|{wt}')
" 2>/dev/null)

  # +1 for the newly created tab
  local total=$((count + 1))
  if [ "$total" -le "$MAX_PROJECT_TABS" ]; then
    log "close_excess: $total tabs open (limit=$MAX_PROJECT_TABS), no cleanup needed"
    return
  fi

  local excess=$((total - MAX_PROJECT_TABS))
  log "close_excess: $total tabs open, closing $excess oldest"

  # Sort by WT index (ascending = oldest first) and close excess
  local closed=0
  for entry in $(echo "$open_tabs" | tr ' ' '
' | sort -t: -k2 -n | head -$excess); do
    local proj=$(echo "$entry" | cut -d'|' -f1)
    local wt=$(echo "$entry" | cut -d'|' -f2)
    
    # Skip if BUSY
    local st
    st=$(bash "$TAB_MANAGER" check-status "$wt" 2>/dev/null)
    if [ "$st" = "BUSY" ]; then
      log "close_excess: $proj ($wt) is BUSY, skipping"
      continue
    fi

    # Close the tab
    local widx=$(echo "$wt" | cut -d: -f1)
    local tidx=$(echo "$wt" | cut -d: -f2)
    osascript -e "tell application "Google Chrome" to close tab $tidx of window $widx" 2>/dev/null
    
    # Clear WT from mapping (keep URL for re-resolve)
    python3 -c "
import json, os
path = os.path.expanduser('$LOCAL_CACHE')
d = json.load(open(path))
if '$proj' in d:
    url = d['$proj'].split('|')[0]
    d['$proj'] = url + '|'
    json.dump(d, open(path, 'w'), indent=2)
" 2>/dev/null
    
    log "close_excess: closed $proj ($wt)"
    closed=$((closed + 1))
  done
  
  log "close_excess: closed $closed tabs"
}


# ============================================================
# Close excess project tabs (keep MAX_PROJECT_TABS open)
# Closes the tab whose mapping was least recently updated
# ============================================================
trim_project_tabs() {
  if [ ! -f "$LOCAL_CACHE" ]; then return; fi

  # Count open project tabs
  OPEN_WTS=$(python3 -c "
import json, os
d = json.load(open(os.path.expanduser('$LOCAL_CACHE')))
for k, v in d.items():
    wt = v.split('|')[-1] if '|' in v else ''
    if wt and wt != '':
        print(k + '|' + wt)
" 2>/dev/null)

  OPEN_COUNT=$(echo "$OPEN_WTS" | grep -c '|' 2>/dev/null || echo 0)
  if [ "$OPEN_COUNT" -le "$MAX_PROJECT_TABS" ]; then return; fi

  EXCESS=$((OPEN_COUNT - MAX_PROJECT_TABS))
  log "trim: $OPEN_COUNT open project tabs, closing $EXCESS"

  # Close oldest tabs (first in list = oldest mapping)
  echo "$OPEN_WTS" | head -n "$EXCESS" | while IFS='|' read -r proj_id wt; do
    [ -z "$wt" ] && continue
    # Verify tab is actually open
    STATUS=$(bash "$TAB_MANAGER" check-status "$wt" 2>/dev/null)
    if [ "$STATUS" = "READY" ] || [ "$STATUS" = "BUSY" ]; then
      WIDX=$(echo "$wt" | cut -d: -f1)
      TIDX=$(echo "$wt" | cut -d: -f2)
      osascript -e "tell application \"Google Chrome\" to close tab $TIDX of window $WIDX" 2>/dev/null
      log "trim: closed $proj_id ($wt)"
    fi
    # Clear WT from mapping (keep URL for re-resolve)
    python3 -c "
import json, os
path = os.path.expanduser('$LOCAL_CACHE')
d = json.load(open(path))
if '$proj_id' in d:
    url = d['$proj_id'].split('|')[0]
    d['$proj_id'] = url + '|'
    json.dump(d, open(path, 'w'), indent=2)
" 2>/dev/null
  done
}

# ============================================================
# COMMANDS
# ============================================================
case "$1" in

resolve)
  PROJECT_ID="$2"
  if [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 resolve <M1317>"
    exit 1
  fi

  # Step 1: Check D1/local mapping
  MAPPING=$(d1_get "$PROJECT_ID")
  if [ -n "$MAPPING" ]; then
    # Parse: conv_url|wt
    CONV_URL=$(echo "$MAPPING" | cut -d'|' -f1)
    CACHED_WT=$(echo "$MAPPING" | cut -d'|' -f2)

    # Step 2: Verify tab is still open
    if [ -n "$CACHED_WT" ]; then
      STATUS=$(bash "$TAB_MANAGER" check-status "$CACHED_WT" 2>/dev/null)
      if [ "$STATUS" = "READY" ] || [ "$STATUS" = "BUSY" ]; then
        log "resolve: $PROJECT_ID -> $CACHED_WT (cached, alive)"
        validate_wt "$CACHED_WT"
        exit 0
      fi
    fi

    # Step 3: Tab closed -> find by URL or reopen
    if [ -n "$CONV_URL" ]; then
      FOUND_WT=$(find_tab_by_url "$CONV_URL")
      if [ -n "$FOUND_WT" ]; then
        # Update cached WT
        d1_set "$PROJECT_ID" "${CONV_URL}|${FOUND_WT}" > /dev/null 2>&1
        log "resolve: $PROJECT_ID -> $FOUND_WT (found by URL)"
        validate_wt "$FOUND_WT"
        exit 0
      fi

      # Reopen URL in new tab
      log "resolve: $PROJECT_ID reopening $CONV_URL"
      WT_INFO=$(bash "$TAB_MANAGER" open "$CONV_URL" 2>/dev/null)
      sleep 4
      # Get the new tab WT
      NEW_WT=$(find_tab_by_url "$CONV_URL")
      if [ -n "$NEW_WT" ]; then
        d1_set "$PROJECT_ID" "${CONV_URL}|${NEW_WT}" > /dev/null 2>&1
        log "resolve: $PROJECT_ID -> $NEW_WT (reopened)"
        validate_wt "$NEW_WT"
        exit 0
      fi
    fi
  fi

  # Step 4: No mapping exists -> create new chat with Dropbox/Obsidian context
  log "resolve: $PROJECT_ID creating new chat with context"

  # Get chat name from Dropbox folder
  CHAT_NAME=$(bash "$CONTEXT_BUILDER" chat-name "$PROJECT_ID" 2>/dev/null)
  [ -z "$CHAT_NAME" ] && CHAT_NAME="$PROJECT_ID"
  log "resolve: $PROJECT_ID chat-name=$CHAT_NAME"

  # Build context and write to file (avoids shell quoting issues)
  CONTEXT_FILE="/tmp/project-context-$PROJECT_ID-$$.txt"
  bash "$CONTEXT_BUILDER" context "$PROJECT_ID" > "$CONTEXT_FILE" 2>/dev/null

  # Open new project tab
  CONFIG="${HOME}/claude-telegram-bot/.croppy-workers.json"
  PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
  if [ -f "$CONFIG" ]; then
    PROJECT_URL=$(python3 -c "import json; d=json.load(open('$CONFIG')); print(d['workers'][0]['url'])" 2>/dev/null || echo "$PROJECT_URL")
  fi

  BEFORE_COUNT=$(osascript -e 'tell application "Google Chrome" to return (count of tabs of front window)' 2>/dev/null)
  WIDX=$(osascript -e 'tell application "Google Chrome" to return index of front window' 2>/dev/null)
  osascript -e "tell application \"Google Chrome\" to tell window $WIDX to set URL of (make new tab) to \"$PROJECT_URL\"" 2>/dev/null
  NEW_TIDX=$((BEFORE_COUNT + 1))
  NEW_WT="${WIDX}:${NEW_TIDX}"

  log "resolve: $PROJECT_ID opened tab $NEW_WT, waiting for page load..."
  sleep 8

  # Inject full context via file (single step, no seed message)
  INJECT_RESULT=$(bash "$TAB_MANAGER" inject-file "$NEW_WT" "$CONTEXT_FILE" 2>/dev/null)
  rm -f "$CONTEXT_FILE"

  if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    log "resolve: $PROJECT_ID inject failed: $INJECT_RESULT"
    echo "ERROR: context inject failed for $PROJECT_ID: $INJECT_RESULT"
    exit 1
  fi

  # Wait for Claude to create conversation (URL changes from /project/ to /chat/UUID)
  sleep 5
  CONV_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $NEW_TIDX of window $WIDX" 2>/dev/null)
  # Verify we got a chat URL, not project URL
  if echo "$CONV_URL" | grep -q "/project/"; then
    log "resolve: $PROJECT_ID WARNING: still project URL, retrying..."
    sleep 5
    CONV_URL=$(osascript -e "tell application \"Google Chrome\" to return URL of tab $NEW_TIDX of window $WIDX" 2>/dev/null)
  fi

  # Rename conversation to project name
  if [ "$CHAT_NAME" != "$PROJECT_ID" ]; then
    sleep 3
    ESCAPED_NAME=$(printf '%s' "$CHAT_NAME" | sed "s/'/'\\\\''/g")
    bash "$TAB_MANAGER" rename-conversation "$NEW_WT" "$ESCAPED_NAME" 2>/dev/null
    log "resolve: $PROJECT_ID renamed to $CHAT_NAME"
  fi

  d1_set "$PROJECT_ID" "${CONV_URL}|${NEW_WT}" 2>/dev/null
  log "resolve: $PROJECT_ID -> $NEW_WT (new chat created: $CHAT_NAME)"

  # Close excess project tabs (keep MAX_PROJECT_TABS)
  close_excess_project_tabs "$NEW_WT"
  # Trim excess project tabs
  trim_project_tabs

  validate_wt "$NEW_WT"
  ;;

list)
  d1_list
  ;;

register)
  PROJECT_ID="$2"
  CONV_URL="$3"
  if [ -z "$PROJECT_ID" ] || [ -z "$CONV_URL" ]; then
    echo "Usage: $0 register <M1317> <conv_url>"
    exit 1
  fi
  # Find current WT for this URL
  WT=$(find_tab_by_url "$CONV_URL")
  d1_set "$PROJECT_ID" "${CONV_URL}|${WT}" > /dev/null 2>&1
  echo "OK: $PROJECT_ID -> ${CONV_URL}|${WT}"
  ;;

cleanup)
  echo "=== Cleanup: checking all mappings ==="
  d1_list | while IFS='|' read -r project_id mapping; do
    project_id=$(echo "$project_id" | xargs)
    conv_url=$(echo "$mapping" | cut -d'|' -f1 | xargs)
    cached_wt=$(echo "$mapping" | cut -d'|' -f2 | xargs)

    if [ -n "$cached_wt" ]; then
      STATUS=$(bash "$TAB_MANAGER" check-status "$cached_wt" 2>/dev/null)
      if [ "$STATUS" = "READY" ] || [ "$STATUS" = "BUSY" ]; then
        echo "  $project_id: $cached_wt OK ($STATUS)"
      else
        # Try to find by URL
        NEW_WT=$(find_tab_by_url "$conv_url")
        if [ -n "$NEW_WT" ]; then
          d1_set "$project_id" "${conv_url}|${NEW_WT}" > /dev/null 2>&1
          echo "  $project_id: $cached_wt DEAD -> $NEW_WT (re-resolved)"
        else
          echo "  $project_id: $cached_wt DEAD, tab not found (needs reopen)"
        fi
      fi
    fi
  done
  ;;

*)
  echo "project-tab-router.sh - Map projects to Chrome tabs"
  echo ""
  echo "Commands:"
  echo "  resolve <M1317>          Get or create project tab"
  echo "  list                     All project mappings"
  echo "  register <M1317> <url>   Manual register"
  echo "  cleanup                  Re-resolve closed tabs"
  ;;

esac
