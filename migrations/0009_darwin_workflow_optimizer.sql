-- Migration: Darwin Engine v1.3 - Self-Learning Workflow Optimizer
-- Created: 2026-02-05
-- Description: Add workflow pattern mining, bottleneck detection, time prediction, and auto-skip

-- =============================================================================
-- Table 1: workflow_patterns (パターンマイニング)
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_hash TEXT NOT NULL UNIQUE,  -- MD5 hash of pattern
  pattern_type TEXT NOT NULL,         -- 'sequence', 'parallel', 'conditional'
  pattern_name TEXT NOT NULL,         -- Human-readable name
  pattern_description TEXT,           -- Description of the pattern
  action_sequence TEXT NOT NULL,      -- JSON: Array of action names
  frequency_count INTEGER DEFAULT 1,  -- How many times this pattern occurred
  avg_duration_ms INTEGER,            -- Average execution time
  success_rate REAL DEFAULT 1.0,      -- Success rate (0.0-1.0)
  last_seen_at TEXT NOT NULL,         -- ISO8601 timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT                       -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_workflow_patterns_hash
  ON workflow_patterns(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_type
  ON workflow_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_frequency
  ON workflow_patterns(frequency_count DESC);

-- =============================================================================
-- Table 2: bottleneck_detections (ボトルネック検出)
-- =============================================================================
CREATE TABLE IF NOT EXISTS bottleneck_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_name TEXT NOT NULL,          -- Name of the slow action
  action_type TEXT NOT NULL,          -- Type of action
  expected_duration_ms INTEGER,       -- Expected duration (baseline)
  actual_duration_ms INTEGER NOT NULL,-- Actual duration
  slowdown_factor REAL NOT NULL,      -- Actual / Expected (e.g., 2.5x)
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT NOT NULL,           -- Session where bottleneck occurred
  suggested_optimization TEXT,        -- AI-generated optimization suggestion
  user_feedback TEXT,                 -- User feedback on suggestion
  resolved INTEGER DEFAULT 0,         -- 0=unresolved, 1=resolved
  FOREIGN KEY(session_id) REFERENCES jarvis_control_tower(session_id)
);

CREATE INDEX IF NOT EXISTS idx_bottleneck_action
  ON bottleneck_detections(action_name);
CREATE INDEX IF NOT EXISTS idx_bottleneck_detected
  ON bottleneck_detections(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_bottleneck_unresolved
  ON bottleneck_detections(resolved);

-- =============================================================================
-- Table 3: time_predictions (時間予測)
-- =============================================================================
CREATE TABLE IF NOT EXISTS time_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_name TEXT NOT NULL,          -- Name of action
  action_type TEXT NOT NULL,          -- Type of action
  predicted_duration_ms INTEGER NOT NULL, -- Predicted time (ms)
  actual_duration_ms INTEGER,         -- Actual time (NULL if not yet executed)
  prediction_confidence REAL DEFAULT 0.5, -- Confidence (0.0-1.0)
  based_on_samples INTEGER DEFAULT 0, -- Number of historical samples used
  predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,                  -- When the action actually completed
  prediction_error_ms INTEGER,        -- |predicted - actual|
  session_id TEXT NOT NULL,           -- Session ID
  FOREIGN KEY(session_id) REFERENCES jarvis_control_tower(session_id)
);

CREATE INDEX IF NOT EXISTS idx_time_predictions_action
  ON time_predictions(action_name);
CREATE INDEX IF NOT EXISTS idx_time_predictions_predicted
  ON time_predictions(predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_predictions_session
  ON time_predictions(session_id);

-- =============================================================================
-- Table 4: auto_skip_candidates (自動スキップ候補)
-- =============================================================================
CREATE TABLE IF NOT EXISTS auto_skip_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_name TEXT NOT NULL UNIQUE,     -- Name of the step
  step_description TEXT,              -- Description of the step
  skip_count INTEGER DEFAULT 0,       -- Number of times user skipped this
  total_appearances INTEGER DEFAULT 0,-- Total times this step appeared
  skip_rate REAL DEFAULT 0.0,         -- skip_count / total_appearances
  last_skipped_at TEXT,               -- Last time user skipped this
  auto_skip_enabled INTEGER DEFAULT 0,-- 0=suggest only, 1=auto-skip
  user_approved INTEGER DEFAULT 0,    -- 0=not approved, 1=approved
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT                       -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_auto_skip_step
  ON auto_skip_candidates(step_name);
CREATE INDEX IF NOT EXISTS idx_auto_skip_rate
  ON auto_skip_candidates(skip_rate DESC);
CREATE INDEX IF NOT EXISTS idx_auto_skip_enabled
  ON auto_skip_candidates(auto_skip_enabled);

-- =============================================================================
-- Table 5: pattern_analysis_runs (パターン分析実行履歴)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pattern_analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,        -- ULID
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed'
  patterns_discovered INTEGER DEFAULT 0,  -- Number of new patterns found
  bottlenecks_detected INTEGER DEFAULT 0, -- Number of bottlenecks detected
  predictions_made INTEGER DEFAULT 0,     -- Number of time predictions made
  skip_candidates_found INTEGER DEFAULT 0,-- Number of skip candidates found
  analysis_summary TEXT,              -- AI-generated summary
  error_message TEXT                  -- Error message if failed
);

CREATE INDEX IF NOT EXISTS idx_pattern_runs_started
  ON pattern_analysis_runs(started_at DESC);

-- =============================================================================
-- Migration Complete
-- =============================================================================
