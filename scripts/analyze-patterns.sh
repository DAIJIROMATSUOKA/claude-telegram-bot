#!/bin/bash
# Darwin Engine v1.3 - Pattern Analysis Cron Job
# Runs daily at 23:00 JST (launchd: 14:00 UTC)
#
# Features:
# 1. Mine workflow patterns from action history
# 2. Detect bottlenecks (2x+ slower actions)
# 3. Generate time predictions
# 4. Find auto-skip candidates
# 5. Send summary to Telegram

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/logs/analyze-patterns.log"
LOCK_FILE="$PROJECT_DIR/.analyze-patterns.lock"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

MEMORY_GATEWAY_URL="${MEMORY_GATEWAY_URL:-https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev}"
GATEWAY_API_KEY="${GATEWAY_API_KEY:-placeholder_key_auth_disabled}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_USER_ID="${TELEGRAM_ALLOWED_USERS%%,*}"  # First user ID

# ============================================================================
# Logging
# ============================================================================

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# ============================================================================
# Lock Management
# ============================================================================

# Check if another instance is running
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    log "❌ Another analysis is already running (PID: $PID)"
    exit 1
  else
    log "⚠️ Stale lock file found, removing..."
    rm -f "$LOCK_FILE"
  fi
fi

# Create lock file
echo $$ > "$LOCK_FILE"
trap "rm -f '$LOCK_FILE'" EXIT

# ============================================================================
# Analysis Script
# ============================================================================

log "🚀 Starting Darwin Pattern Analysis v1.3"

RUN_ID=$(date +%s)

# Create analysis run record
curl -s -X POST "$MEMORY_GATEWAY_URL/v1/db/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -d "{\"sql\": \"INSERT INTO pattern_analysis_runs (run_id, status) VALUES ('$RUN_ID', 'running')\"}" \
  > /dev/null

log "📊 Run ID: $RUN_ID"

# ============================================================================
# Run Bun Script
# ============================================================================

log "🔍 Running workflow analysis..."

ANALYSIS_RESULT=$(cd "$PROJECT_DIR" && bun run src/jobs/analyze-patterns.ts --run-id "$RUN_ID" 2>&1)
EXIT_CODE=$?

log "$ANALYSIS_RESULT"

if [ $EXIT_CODE -ne 0 ]; then
  log "❌ Analysis failed with exit code $EXIT_CODE"

  # Mark run as failed
  ERROR_MSG=$(echo "$ANALYSIS_RESULT" | tail -10 | jq -Rs .)
  curl -s -X POST "$MEMORY_GATEWAY_URL/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    -d "{\"sql\": \"UPDATE pattern_analysis_runs SET status = 'failed', completed_at = datetime('now'), error_message = $ERROR_MSG WHERE run_id = '$RUN_ID'\"}" \
    > /dev/null

  exit 1
fi

# ============================================================================
# Extract Stats
# ============================================================================

PATTERNS=$(echo "$ANALYSIS_RESULT" | grep -oP 'Patterns: \K\d+' || echo "0")
BOTTLENECKS=$(echo "$ANALYSIS_RESULT" | grep -oP 'Bottlenecks: \K\d+' || echo "0")
PREDICTIONS=$(echo "$ANALYSIS_RESULT" | grep -oP 'Predictions: \K\d+' || echo "0")
SKIP_CANDIDATES=$(echo "$ANALYSIS_RESULT" | grep -oP 'Skip Candidates: \K\d+' || echo "0")

log "✅ Analysis complete:"
log "   - Patterns: $PATTERNS"
log "   - Bottlenecks: $BOTTLENECKS"
log "   - Predictions: $PREDICTIONS"
log "   - Skip Candidates: $SKIP_CANDIDATES"

# ============================================================================
# Generate Summary with Claude CLI
# ============================================================================

log "🤖 Generating AI summary with Claude CLI..."

SUMMARY_PROMPT="Based on the workflow analysis results:
- Workflow Patterns Discovered: $PATTERNS
- Bottlenecks Detected: $BOTTLENECKS
- Time Predictions Made: $PREDICTIONS
- Auto-Skip Candidates Found: $SKIP_CANDIDATES

Generate a concise 3-sentence summary of the key findings and suggest one actionable optimization.

Format:
📊 Analysis Summary:
[summary]

💡 Recommended Action:
[action]"

SUMMARY=$(echo "$SUMMARY_PROMPT" | claude -p "You are a workflow optimization expert. Respond concisely." 2>/dev/null || echo "Summary generation failed")

log "Summary: $SUMMARY"

# Save summary to DB
SUMMARY_JSON=$(echo "$SUMMARY" | jq -Rs .)
curl -s -X POST "$MEMORY_GATEWAY_URL/v1/db/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -d "{\"sql\": \"UPDATE pattern_analysis_runs SET status = 'completed', completed_at = datetime('now'), patterns_discovered = $PATTERNS, bottlenecks_detected = $BOTTLENECKS, predictions_made = $PREDICTIONS, skip_candidates_found = $SKIP_CANDIDATES, analysis_summary = $SUMMARY_JSON WHERE run_id = '$RUN_ID'\"}" \
  > /dev/null

# ============================================================================
# Send Telegram Notification
# ============================================================================

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_USER_ID" ]; then
  log "📨 Sending Telegram notification..."

  MESSAGE="🧠 <b>Darwin Pattern Analysis Complete</b>

📊 Results:
  • Patterns: $PATTERNS
  • Bottlenecks: $BOTTLENECKS
  • Predictions: $PREDICTIONS
  • Skip Candidates: $SKIP_CANDIDATES

$SUMMARY

<code>Run ID: $RUN_ID</code>"

  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$TELEGRAM_USER_ID\", \"text\": $(echo "$MESSAGE" | jq -Rs .), \"parse_mode\": \"HTML\"}" \
    > /dev/null

  log "✅ Telegram notification sent"
else
  log "⚠️ Telegram credentials not configured, skipping notification"
fi

log "🎉 Pattern analysis completed successfully"
