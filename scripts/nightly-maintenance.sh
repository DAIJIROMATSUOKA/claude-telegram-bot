#!/bin/bash
# nightly-maintenance.sh — Lightweight system health check
# Run: standalone or from nightly-runner.sh
# No Claude Code needed. Pure bash.
set -uo pipefail

SCRIPTS_DIR=""
PROJECT_DIR="."
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

REPORT=""
add() { REPORT="${REPORT}$1\n"; }

add "🔧 Nightly Maintenance $(date '+%Y-%m-%d %H:%M')"
add ""

# 1. Claude Code version
CC_VER=$(claude --version 2>/dev/null || echo 'NOT FOUND')
add "📦 Claude Code: $CC_VER"

# 2. brew outdated (claude-code + critical)
BREW_CC=$(brew outdated --cask claude-code 2>/dev/null)
if [ -n "$BREW_CC" ]; then
  add "⬆️ brew update available: $BREW_CC"
else
  add "✅ claude-code: up to date"
fi
BREW_COUNT=$(brew outdated 2>/dev/null | wc -l | tr -d ' ')
add "📋 brew outdated: ${BREW_COUNT} packages"

# 3. npm audit
cd "$PROJECT_DIR" || exit 1
AUDIT=$(npm audit --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); v=d.get("metadata",{}).get("vulnerabilities",{}); print(f"critical={v.get("critical",0)} high={v.get("high",0)} moderate={v.get("moderate",0)}")' 2>/dev/null || echo 'audit failed')
add "🔒 npm audit: $AUDIT"

# 4. git uncommitted
UNCOMMITTED=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
add "📝 Uncommitted files: $UNCOMMITTED"

# 5. git unpushed
UNPUSHED=$(git log origin/main..main --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED" -gt 0 ]; then
  UNPUSH_LIST=$(git log origin/main..main --oneline 2>/dev/null | head -5)
  add "⚠️ Unpushed commits: $UNPUSHED"
  add "$UNPUSH_LIST"
else
  add "✅ All commits pushed"
fi

# 6. Disk usage
DISK=$(df -h / 2>/dev/null | tail -1 | awk '{print $4 " free (" $5 " used)"}')
add "💾 Disk: $DISK"

# 7. Bot process check
BOT_PID=$(pgrep -f 'bun.*index.ts' 2>/dev/null | head -1)
if [ -n "$BOT_PID" ]; then
  BOT_UP=$(ps -o etime= -p "$BOT_PID" 2>/dev/null | tr -d ' ')
  add "🤖 Bot: running (PID $BOT_PID, uptime $BOT_UP)"
else
  add "❌ Bot: NOT RUNNING"
fi

# Send report
echo -e "$REPORT"
bash "$NOTIFY" "$(echo -e "$REPORT")" 2>/dev/null || true
log "Maintenance report sent"
