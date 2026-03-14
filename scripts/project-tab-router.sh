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
GATEWAY="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
LOCAL_CACHE="$HOME/.croppy-project-tabs.json"
LOG="/tmp/project-tab-router.log"

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
        echo "$CACHED_WT"
        exit 0
      fi
    fi

    # Step 3: Tab closed -> find by URL or reopen
    if [ -n "$CONV_URL" ]; then
      FOUND_WT=$(find_tab_by_url "$CONV_URL")
      if [ -n "$FOUND_WT" ]; then
        # Update cached WT
        d1_set "$PROJECT_ID" "${CONV_URL}|${FOUND_WT}"
        log "resolve: $PROJECT_ID -> $FOUND_WT (found by URL)"
        echo "$FOUND_WT"
        exit 0
      fi

      # Reopen URL in new tab
      log "resolve: $PROJECT_ID reopening $CONV_URL"
      WT_INFO=$(bash "$TAB_MANAGER" open "$CONV_URL" 2>/dev/null)
      sleep 4
      # Get the new tab WT
      NEW_WT=$(find_tab_by_url "$CONV_URL")
      if [ -n "$NEW_WT" ]; then
        d1_set "$PROJECT_ID" "${CONV_URL}|${NEW_WT}"
        log "resolve: $PROJECT_ID -> $NEW_WT (reopened)"
        echo "$NEW_WT"
        exit 0
      fi
    fi
  fi

  # Step 4: No mapping exists -> create new chat
  log "resolve: $PROJECT_ID creating new chat"
  RESULT=$(bash "$TAB_MANAGER" new-chat "This is the project chat for $PROJECT_ID. All information about this project will be posted here." 2>/dev/null)
  NEW_WT=$(echo "$RESULT" | grep '^WT:' | awk '{print $2}')
  CONV_URL=$(echo "$RESULT" | grep '^CONV_URL:' | awk '{print $2}')

  if [ -z "$NEW_WT" ]; then
    echo "ERROR: failed to create chat for $PROJECT_ID"
    exit 1
  fi

  d1_set "$PROJECT_ID" "${CONV_URL}|${NEW_WT}"
  log "resolve: $PROJECT_ID -> $NEW_WT (new chat created)"
  echo "$NEW_WT"
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
  d1_set "$PROJECT_ID" "${CONV_URL}|${WT}"
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
          d1_set "$project_id" "${conv_url}|${NEW_WT}"
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
