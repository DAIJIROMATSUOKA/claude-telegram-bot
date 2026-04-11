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

# 8. bun test
cd "$PROJECT_DIR" || exit 1
TEST_RESULT=$(bun test --timeout 30000 2>&1 | tail -1)
add "🧪 bun test: $TEST_RESULT"

# 9. D1 backup
D1_RESULT=$(bash "$SCRIPTS_DIR/d1-backup.sh" 2>&1 | tail -1)
add "📦 $D1_RESULT"

# 10. git push
cd "$PROJECT_DIR" || exit 1
UNPUSHED_COUNT=$(git log origin/main..main --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED_COUNT" -gt 0 ]; then
  PUSH_RESULT=$(git push --no-verify 2>&1)
  PUSH_EXIT=$?
  if [ $PUSH_EXIT -eq 0 ]; then
    add "🚀 git push: ${UNPUSHED_COUNT} commits pushed"
  else
    add "❌ git push: FAILED - $(echo "$PUSH_RESULT" | tail -1)"
  fi
else
  add "✅ git push: nothing to push"
fi

# 11. Weekly digest (Sunday only)
DAY_OF_WEEK=$(date '+%u')  # 7 = Sunday
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  add ""
  add "📅 Weekly Digest (last 7 days)"
  cd "$PROJECT_DIR" || exit 1

  # Git stats
  WEEK_COMMITS=$(git log --since="7 days ago" --oneline 2>/dev/null | wc -l | tr -d ' ')
  add "  Commits: $WEEK_COMMITS"
  if [ "$WEEK_COMMITS" -gt 0 ]; then
    WEEK_AUTHORS=$(git log --since="7 days ago" --format='%an' 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/, $//')
    add "  Authors: $WEEK_AUTHORS"
    WEEK_FILES=$(git log --since="7 days ago" --name-only --pretty=format: 2>/dev/null | sort -u | grep -c '.' || echo '0')
    add "  Files changed: $WEEK_FILES"
  fi

  # D1 triage stats
  GATEWAY="${GATEWAY_URL:-https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev}"
  source "$HOME/claude-telegram-bot/.env" 2>/dev/null || true

  TRIAGE_RESP=$(curl -s -X POST "$GATEWAY/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${GATEWAY_API_KEY:-}" \
    -d '{"sql":"SELECT action, COUNT(*) as cnt FROM triage_items WHERE created_at > datetime('"'"'now'"'"','"'"'-7 days'"'"') GROUP BY action"}' 2>/dev/null)
  TRIAGE_STATS=$(echo "$TRIAGE_RESP" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    rows = d.get('results', [])
    if rows:
        print('  Triage: ' + ', '.join(f\"{r.get('action','?')}={r.get('cnt',0)}\" for r in rows))
    else:
        print('  Triage: no data')
except:
    print('  Triage: query failed')
" 2>/dev/null || echo "  Triage: query failed")
  add "$TRIAGE_STATS"

  # D1 contact count
  CONTACT_RESP=$(curl -s -X POST "$GATEWAY/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${GATEWAY_API_KEY:-}" \
    -d '{"sql":"SELECT COUNT(*) as cnt FROM contacts WHERE created_at > datetime('"'"'now'"'"','"'"'-7 days'"'"')"}' 2>/dev/null)
  CONTACT_COUNT=$(echo "$CONTACT_RESP" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    rows = d.get('results', [])
    cnt = rows[0].get('cnt', 0) if rows else 0
    print(f'  New contacts: {cnt}')
except:
    print('  Contacts: query failed')
" 2>/dev/null || echo "  Contacts: query failed")
  add "$CONTACT_COUNT"

  # Send weekly digest as separate notification
  WEEKLY_MSG="📅 Weekly Digest (last 7 days)
  Commits: $WEEK_COMMITS
$TRIAGE_STATS
$CONTACT_COUNT"
  bash "$NOTIFY" "$WEEKLY_MSG" 2>/dev/null || true
  log "Weekly digest sent"
fi

# 12. Compressed history rotation check
KNOWLEDGE_DIR="/root/machinelab-knowledge"
HIST_WARN=""
for hfile in ""/*/history.compressed.md; do
  [ -f "$hfile" ] || continue
  LINES=$(wc -l < "$hfile" | tr -d ' ')
  DOMAIN=$(basename "$(dirname "$hfile")")
  if [ "$LINES" -gt 150 ]; then
    HIST_WARN="${HIST_WARN}${DOMAIN}(${LINES}行) "
  fi
done
if [ -n "$HIST_WARN" ]; then
  add "⚠️ History rotation needed: $HIST_WARN"
else
  add "✅ All compressed histories under 150 lines"
fi

# 13. Project index update (weekly diff)
if [ -f "/root/scripts/project-indexer.py" ]; then
  log "Running project indexer (recent 7 days)..."
  IDX_OUT=$(python3 "/root/scripts/project-indexer.py" --recent 7 2>&1 | tail -1)
  add "📁 Project index: $IDX_OUT"
fi

# 14. Nightly batch scheduler
log "Running nightly batch scheduler..."
bash "$(dirname "$0")/nightly-batch-scheduler.sh" 2>&1 | while IFS= read -r line; do log "$line"; done || true

# 15. Handoff file rotation (keep last 5)
HANDOFF_DIR="$(dirname "$0")/../autonomous/state/handoffs"
if [ -d "$HANDOFF_DIR" ]; then
  HANDOFF_COUNT=$(ls -1 "$HANDOFF_DIR" 2>/dev/null | wc -l | tr -d " ")
  if [ "$HANDOFF_COUNT" -gt 5 ]; then
    DELETED=$(ls -1t "$HANDOFF_DIR" | tail -n +6 | while read f; do rm "$HANDOFF_DIR/$f" 2>/dev/null && echo 1; done | wc -l | tr -d " ")
    add "🗑️ Handoff cleanup: $DELETED old files removed ($HANDOFF_COUNT→5)"
  else
    add "✅ Handoff files: $HANDOFF_COUNT (≤5)"
  fi
fi

# Send report
echo -e "$REPORT"
bash "$NOTIFY" "$(echo -e "$REPORT")" 2>/dev/null || true
log "Maintenance report sent"
