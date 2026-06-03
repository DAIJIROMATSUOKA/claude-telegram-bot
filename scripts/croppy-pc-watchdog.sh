#!/bin/bash
# croppy-pc-watchdog.sh - monitor RC session log for auth-expiry / Sonnet-downgrade.
# Replaces old Chrome-based croppy-health.sh. Run via LaunchAgent (StartInterval 60).
LOG="/tmp/rc-croppy.log"
NOTIFY="$HOME/claude-telegram-bot/scripts/notify-dj.sh"
STATE="/tmp/croppy-pc-watchdog-state"

[ -f "$LOG" ] || exit 0

SIGNAL=""
if grep -qaiE "OAuth token has expired|need to run /login|please run /login" "$LOG" 2>/dev/null; then
  SIGNAL="AUTH_EXPIRED"
elif grep -qaiE "Opus limit reached|now using Sonnet|falling back to Sonnet" "$LOG" 2>/dev/null; then
  SIGNAL="SONNET_DOWNGRADE"
fi

LAST=$(cat "$STATE" 2>/dev/null)

# No signal: clear state so a future recurrence re-notifies
if [ -z "$SIGNAL" ]; then
  [ -n "$LAST" ] && rm -f "$STATE"
  exit 0
fi

# Same signal already notified: debounce
[ "$SIGNAL" = "$LAST" ] && exit 0

echo "$SIGNAL" > "$STATE"
case "$SIGNAL" in
  AUTH_EXPIRED)     "$NOTIFY" "croppy-pc: auth expired - run /login in RC" ;;
  SONNET_DOWNGRADE) "$NOTIFY" "croppy-pc: Opus limit hit - downgraded to Sonnet" ;;
esac
exit 0
