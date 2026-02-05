#!/bin/bash
# Apply migration 0008_context_switcher.sql via Memory Gateway API

set -e

MEMORY_GATEWAY_URL="${MEMORY_GATEWAY_URL:-https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev}"
GATEWAY_API_KEY="${GATEWAY_API_KEY:-placeholder_key_auth_disabled}"

echo "🚀 Applying migration: 0008_context_switcher.sql"
echo "📡 Memory Gateway: $MEMORY_GATEWAY_URL"
echo ""

# Execute each statement separately
execute_sql() {
  local sql="$1"
  local desc="$2"

  echo "⏳ $desc"

  response=$(curl -s -X POST "$MEMORY_GATEWAY_URL/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    -d "{\"sql\": $(echo "$sql" | jq -Rs .)}")

  error=$(echo "$response" | jq -r '.error // empty')

  if [[ -n "$error" && "$error" != "duplicate column name"* ]]; then
    echo "❌ Error: $error"
    return 1
  else
    echo "✅ Success"
  fi
}

# Add columns (ignore duplicate errors)
execute_sql "ALTER TABLE jarvis_context ADD COLUMN work_mode TEXT DEFAULT 'chatting';" \
  "Adding work_mode column"

execute_sql "ALTER TABLE jarvis_context ADD COLUMN focus_mode INTEGER DEFAULT 0;" \
  "Adding focus_mode column"

execute_sql "ALTER TABLE jarvis_context ADD COLUMN recommended_ai TEXT DEFAULT 'jarvis';" \
  "Adding recommended_ai column"

execute_sql "ALTER TABLE jarvis_context ADD COLUMN mode_confidence REAL DEFAULT 0.0;" \
  "Adding mode_confidence column"

# Create focus_mode_buffer table
execute_sql "CREATE TABLE IF NOT EXISTS focus_mode_buffer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered INTEGER DEFAULT 0
);" "Creating focus_mode_buffer table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_focus_buffer_user ON focus_mode_buffer(user_id);" \
  "Creating index on focus_mode_buffer(user_id)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_focus_buffer_delivered ON focus_mode_buffer(delivered);" \
  "Creating index on focus_mode_buffer(delivered)"

# Create interrupt_snapshot table
execute_sql "CREATE TABLE IF NOT EXISTS interrupt_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  work_mode TEXT NOT NULL,
  current_task TEXT,
  current_phase TEXT,
  snapshot_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  restored INTEGER DEFAULT 0
);" "Creating interrupt_snapshot table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_interrupt_user ON interrupt_snapshot(user_id);" \
  "Creating index on interrupt_snapshot(user_id)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_interrupt_session ON interrupt_snapshot(session_id);" \
  "Creating index on interrupt_snapshot(session_id)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_interrupt_restored ON interrupt_snapshot(restored);" \
  "Creating index on interrupt_snapshot(restored)"

echo ""
echo "🎉 Migration 0008 completed successfully!"
