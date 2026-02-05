#!/bin/bash
# Apply migration 0009_darwin_workflow_optimizer.sql via Memory Gateway API

set -e

MEMORY_GATEWAY_URL="${MEMORY_GATEWAY_URL:-https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev}"
GATEWAY_API_KEY="${GATEWAY_API_KEY:-placeholder_key_auth_disabled}"

echo "🚀 Applying migration: 0009_darwin_workflow_optimizer.sql"
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

  if [[ -n "$error" && "$error" != "table"*"already exists"* ]]; then
    echo "❌ Error: $error"
    return 1
  else
    echo "✅ Success"
  fi
}

# Create workflow_patterns table
execute_sql "CREATE TABLE IF NOT EXISTS workflow_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_hash TEXT NOT NULL UNIQUE,
  pattern_type TEXT NOT NULL,
  pattern_name TEXT NOT NULL,
  pattern_description TEXT,
  action_sequence TEXT NOT NULL,
  frequency_count INTEGER DEFAULT 1,
  avg_duration_ms INTEGER,
  success_rate REAL DEFAULT 1.0,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);" "Creating workflow_patterns table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_workflow_patterns_hash ON workflow_patterns(pattern_hash);" \
  "Creating index on workflow_patterns(pattern_hash)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_workflow_patterns_type ON workflow_patterns(pattern_type);" \
  "Creating index on workflow_patterns(pattern_type)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_workflow_patterns_frequency ON workflow_patterns(frequency_count DESC);" \
  "Creating index on workflow_patterns(frequency_count)"

# Create bottleneck_detections table
execute_sql "CREATE TABLE IF NOT EXISTS bottleneck_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  expected_duration_ms INTEGER,
  actual_duration_ms INTEGER NOT NULL,
  slowdown_factor REAL NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT NOT NULL,
  suggested_optimization TEXT,
  user_feedback TEXT,
  resolved INTEGER DEFAULT 0
);" "Creating bottleneck_detections table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_bottleneck_action ON bottleneck_detections(action_name);" \
  "Creating index on bottleneck_detections(action_name)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_bottleneck_detected ON bottleneck_detections(detected_at DESC);" \
  "Creating index on bottleneck_detections(detected_at)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_bottleneck_unresolved ON bottleneck_detections(resolved);" \
  "Creating index on bottleneck_detections(resolved)"

# Create time_predictions table
execute_sql "CREATE TABLE IF NOT EXISTS time_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  predicted_duration_ms INTEGER NOT NULL,
  actual_duration_ms INTEGER,
  prediction_confidence REAL DEFAULT 0.5,
  based_on_samples INTEGER DEFAULT 0,
  predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  prediction_error_ms INTEGER,
  session_id TEXT NOT NULL
);" "Creating time_predictions table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_time_predictions_action ON time_predictions(action_name);" \
  "Creating index on time_predictions(action_name)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_time_predictions_predicted ON time_predictions(predicted_at DESC);" \
  "Creating index on time_predictions(predicted_at)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_time_predictions_session ON time_predictions(session_id);" \
  "Creating index on time_predictions(session_id)"

# Create auto_skip_candidates table
execute_sql "CREATE TABLE IF NOT EXISTS auto_skip_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_name TEXT NOT NULL UNIQUE,
  step_description TEXT,
  skip_count INTEGER DEFAULT 0,
  total_appearances INTEGER DEFAULT 0,
  skip_rate REAL DEFAULT 0.0,
  last_skipped_at TEXT,
  auto_skip_enabled INTEGER DEFAULT 0,
  user_approved INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);" "Creating auto_skip_candidates table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_auto_skip_step ON auto_skip_candidates(step_name);" \
  "Creating index on auto_skip_candidates(step_name)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_auto_skip_rate ON auto_skip_candidates(skip_rate DESC);" \
  "Creating index on auto_skip_candidates(skip_rate)"

execute_sql "CREATE INDEX IF NOT EXISTS idx_auto_skip_enabled ON auto_skip_candidates(auto_skip_enabled);" \
  "Creating index on auto_skip_candidates(auto_skip_enabled)"

# Create pattern_analysis_runs table
execute_sql "CREATE TABLE IF NOT EXISTS pattern_analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  patterns_discovered INTEGER DEFAULT 0,
  bottlenecks_detected INTEGER DEFAULT 0,
  predictions_made INTEGER DEFAULT 0,
  skip_candidates_found INTEGER DEFAULT 0,
  analysis_summary TEXT,
  error_message TEXT
);" "Creating pattern_analysis_runs table"

execute_sql "CREATE INDEX IF NOT EXISTS idx_pattern_runs_started ON pattern_analysis_runs(started_at DESC);" \
  "Creating index on pattern_analysis_runs(started_at)"

echo ""
echo "🎉 Migration 0009 completed successfully!"
