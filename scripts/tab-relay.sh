#!/bin/bash
# tab-relay.sh - Relay messages and responses between claude.ai Chrome tabs
# Enables: Inbox->project forwarding, tab-to-tab debate, response chaining
#
# Usage:
#   ./tab-relay.sh relay <from_wt> <to_wt> [prefix]
#   ./tab-relay.sh ask-and-forward <from_wt> <to_wt> "question" [prefix]
#   ./tab-relay.sh debate <wt_a> <wt_b> "topic" [rounds] [timeout]

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TAB_MANAGER="$SCRIPTS_DIR/croppy-tab-manager.sh"
LOG="/tmp/tab-relay.log"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
DEFAULT_TIMEOUT=300
DEFAULT_ROUNDS=3

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

notify() {
  if [ -f "$NOTIFY" ]; then
    bash "$NOTIFY" "$1" 2>/dev/null &
  fi
}

# ============================================================
# RELAY: Read last response from A, inject into B
# ============================================================
do_relay() {
  local FROM_WT="$1"
  local TO_WT="$2"
  local PREFIX="$3"

  # Read response from source tab
  RESPONSE=$(bash "$TAB_MANAGER" read-response "$FROM_WT" 2>/dev/null)
  if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
    echo "ERROR: no response in $FROM_WT"
    return 1
  fi

  # Prepare message with optional prefix
  if [ -n "$PREFIX" ]; then
    MESSAGE="${PREFIX}

${RESPONSE}"
  else
    MESSAGE="$RESPONSE"
  fi

  # Inject into target tab
  # Write to temp file to avoid shell quoting issues
  TMPF="/tmp/tab-relay-msg-$$.txt"
  printf '%s' "$MESSAGE" > "$TMPF"
  INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$TO_WT" "$(cat "$TMPF")" 2>/dev/null)
  rm -f "$TMPF"
  if echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    local CHARS=${#RESPONSE}
    log "relay: $FROM_WT -> $TO_WT (${CHARS} chars)"
    echo "OK: relayed ${CHARS} chars from $FROM_WT to $TO_WT"
    return 0
  else
    log "relay: inject failed $TO_WT: $INJECT_RESULT"
    echo "ERROR: inject failed: $INJECT_RESULT"
    return 1
  fi
}

# ============================================================
# ASK-AND-FORWARD: Inject question into A, wait, forward to B
# ============================================================
do_ask_and_forward() {
  local FROM_WT="$1"
  local TO_WT="$2"
  local QUESTION="$3"
  local PREFIX="$4"
  local TIMEOUT="${5:-$DEFAULT_TIMEOUT}"

  # Step 1: Inject question into source
  log "ask-and-forward: injecting into $FROM_WT"
  INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$FROM_WT" "$QUESTION" 2>/dev/null)
  if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    echo "ERROR: inject into $FROM_WT failed: $INJECT_RESULT"
    return 1
  fi

  # Step 2: Wait for response
  log "ask-and-forward: waiting for response from $FROM_WT (timeout=${TIMEOUT}s)"
  RESPONSE=$(bash "$TAB_MANAGER" wait-response "$FROM_WT" "$TIMEOUT" 2>/dev/null)

  if [ "$RESPONSE" = "TIMEOUT" ]; then
    echo "ERROR: timeout waiting for $FROM_WT"
    notify "tab-relay TIMEOUT: $FROM_WT -> $TO_WT"
    return 1
  fi
  if echo "$RESPONSE" | grep -q "^ERROR:"; then
    echo "ERROR: $FROM_WT returned $RESPONSE"
    return 1
  fi
  if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
    echo "ERROR: empty response from $FROM_WT"
    return 1
  fi

  # Step 3: Forward to target
  if [ -n "$PREFIX" ]; then
    MESSAGE="${PREFIX}

${RESPONSE}"
  else
    MESSAGE="$RESPONSE"
  fi

  # Write to temp file to avoid shell quoting issues
  TMPF="/tmp/tab-relay-msg-$$.txt"
  printf '%s' "$MESSAGE" > "$TMPF"
  INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$TO_WT" "$(cat "$TMPF")" 2>/dev/null)
  rm -f "$TMPF"
  if echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    local CHARS=${#RESPONSE}
    log "ask-and-forward: $FROM_WT -> $TO_WT (${CHARS} chars)"
    echo "OK: forwarded ${CHARS} chars"
    return 0
  else
    echo "ERROR: inject into $TO_WT failed: $INJECT_RESULT"
    return 1
  fi
}

# ============================================================
# DEBATE: Multi-round exchange between two tabs
# ============================================================
do_debate() {
  local WT_A="$1"
  local WT_B="$2"
  local TOPIC="$3"
  local ROUNDS="${4:-$DEFAULT_ROUNDS}"
  local TIMEOUT="${5:-$DEFAULT_TIMEOUT}"

  log "debate: $WT_A vs $WT_B | topic='$TOPIC' | rounds=$ROUNDS"
  echo "=== Debate: $ROUNDS rounds ==="
  echo "Tab A: $WT_A"
  echo "Tab B: $WT_B"
  echo "Topic: $TOPIC"
  echo ""

  # Round 0: Seed topic into Tab A
  log "debate: R0 seeding topic into $WT_A"
  TMPF="/tmp/tab-relay-seed-$$.txt"
  printf '%s' "$TOPIC" > "$TMPF"
  INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$WT_A" "$(cat "$TMPF")" 2>/dev/null)
  rm -f "$TMPF"
  if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
    echo "ERROR: failed to seed topic into $WT_A"
    notify "debate FAILED: seed into $WT_A"
    return 1
  fi

  # Wait for A's initial response
  RESPONSE_A=$(bash "$TAB_MANAGER" wait-response "$WT_A" "$TIMEOUT" 2>/dev/null)
  if [ "$RESPONSE_A" = "TIMEOUT" ] || echo "$RESPONSE_A" | grep -q "^ERROR:"; then
    echo "ERROR: A failed to respond: $RESPONSE_A"
    notify "debate FAILED R0: A timeout"
    return 1
  fi
  echo "[R0] A responded (${#RESPONSE_A} chars)"

  # Rounds 1..N: B responds to A, then A responds to B
  for R in $(seq 1 "$ROUNDS"); do
    # B's turn: receive A's response, generate reply
    log "debate: R${R} B's turn"
    PREFIX_B="[Round ${R}/${ROUNDS}] The other participant said:"
    TMPF="/tmp/tab-relay-debate-$$.txt"
    printf '%s\n\n%s' "$PREFIX_B" "$RESPONSE_A" > "$TMPF"
    INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$WT_B" "$(cat "$TMPF")" 2>/dev/null)
    rm -f "$TMPF"
    if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
      echo "ERROR: R${R} inject into B failed"
      notify "debate FAILED R${R}: inject B"
      return 1
    fi

    RESPONSE_B=$(bash "$TAB_MANAGER" wait-response "$WT_B" "$TIMEOUT" 2>/dev/null)
    if [ "$RESPONSE_B" = "TIMEOUT" ] || echo "$RESPONSE_B" | grep -q "^ERROR:"; then
      echo "ERROR: R${R} B timeout: $RESPONSE_B"
      notify "debate FAILED R${R}: B timeout"
      return 1
    fi
    echo "[R${R}] B responded (${#RESPONSE_B} chars)"

    # If last round, skip A's response
    if [ "$R" -eq "$ROUNDS" ]; then
      break
    fi

    # A's turn: receive B's response
    log "debate: R${R} A's turn"
    PREFIX_A="[Round $((R+1))/${ROUNDS}] The other participant said:"
    TMPF="/tmp/tab-relay-debate-$$.txt"
    printf '%s\n\n%s' "$PREFIX_A" "$RESPONSE_B" > "$TMPF"
    INJECT_RESULT=$(bash "$TAB_MANAGER" inject-raw "$WT_A" "$(cat "$TMPF")" 2>/dev/null)
    rm -f "$TMPF"
    if ! echo "$INJECT_RESULT" | grep -q "INSERTED:SENT"; then
      echo "ERROR: R${R} inject into A failed"
      notify "debate FAILED R${R}: inject A"
      return 1
    fi

    RESPONSE_A=$(bash "$TAB_MANAGER" wait-response "$WT_A" "$TIMEOUT" 2>/dev/null)
    if [ "$RESPONSE_A" = "TIMEOUT" ] || echo "$RESPONSE_A" | grep -q "^ERROR:"; then
      echo "ERROR: R${R} A timeout: $RESPONSE_A"
      notify "debate FAILED R${R}: A timeout"
      return 1
    fi
    echo "[R$((R))] A responded (${#RESPONSE_A} chars)"
  done

  log "debate: completed $ROUNDS rounds"
  echo ""
  echo "=== Debate complete: $ROUNDS rounds ==="
  notify "Debate complete: ${ROUNDS} rounds between $WT_A and $WT_B"
  return 0
}

# ============================================================
# MAIN
# ============================================================
case "$1" in

relay)
  do_relay "$2" "$3" "$4"
  ;;

ask-and-forward)
  do_ask_and_forward "$2" "$3" "$4" "$5" "$6"
  ;;

debate)
  do_debate "$2" "$3" "$4" "$5" "$6"
  ;;

*)
  echo "tab-relay.sh - Relay responses between claude.ai Chrome tabs"
  echo ""
  echo "Commands:"
  echo "  relay <from_wt> <to_wt> [prefix]"
  echo "    Read last response from source, inject into target"
  echo ""
  echo "  ask-and-forward <from_wt> <to_wt> \"question\" [prefix] [timeout]"
  echo "    Inject question into source, wait for response, forward to target"
  echo ""
  echo "  debate <wt_a> <wt_b> \"topic\" [rounds] [timeout]"
  echo "    Multi-round exchange: A and B take turns responding"
  ;;

esac
