-- Migration: Meta-Agent Self-Improvement Engine
-- Created: 2026-02-05
-- Description: Self-audit, code review, refactor proposals, capability gap analysis, meta-agent logging

-- =============================================================================
-- Table 1: self_audit_results (Self-Audit Results)
-- =============================================================================
CREATE TABLE IF NOT EXISTS self_audit_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,             -- Date of audit (YYYY-MM-DD)
  error_count INTEGER DEFAULT 0,         -- Number of errors detected in logs
  avg_response_ms INTEGER,               -- Average response time
  satisfaction_score REAL DEFAULT 0.0,   -- Estimated DJ satisfaction (0.0-1.0)
  issues_found TEXT,                     -- JSON: Array of issues
  recommendations TEXT,                  -- JSON: Array of recommendations
  log_file_size INTEGER,                 -- Size of bot.log in bytes
  total_messages INTEGER DEFAULT 0,      -- Total messages processed
  total_sessions INTEGER DEFAULT 0,      -- Total sessions
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT                          -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_self_audit_date
  ON self_audit_results(date DESC);

-- =============================================================================
-- Table 2: code_review_suggestions (Code Review Suggestions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS code_review_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id TEXT NOT NULL UNIQUE,    -- ULID
  file_path TEXT NOT NULL,               -- File being reviewed (relative path)
  line_number INTEGER,                   -- Line number (if applicable)
  issue_type TEXT NOT NULL,              -- 'duplicate_code', 'inefficiency', 'error_handling', etc.
  severity TEXT NOT NULL,                -- 'low', 'medium', 'high', 'critical'
  description TEXT NOT NULL,             -- Human-readable description
  suggested_fix TEXT,                    -- Suggested code change
  status TEXT NOT NULL DEFAULT 'pending',-- 'pending', 'approved', 'rejected', 'applied'
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,                      -- When suggestion was resolved
  user_feedback TEXT,                    -- DJ's feedback
  metadata TEXT                          -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_code_review_file
  ON code_review_suggestions(file_path);
CREATE INDEX IF NOT EXISTS idx_code_review_status
  ON code_review_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_code_review_severity
  ON code_review_suggestions(severity);

-- =============================================================================
-- Table 3: refactor_proposals (Refactor Proposals)
-- =============================================================================
CREATE TABLE IF NOT EXISTS refactor_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL UNIQUE,      -- ULID
  proposal_title TEXT NOT NULL,          -- Short title
  proposal_description TEXT NOT NULL,    -- Detailed description
  affected_files TEXT NOT NULL,          -- JSON: Array of file paths
  estimated_impact TEXT NOT NULL,        -- 'low', 'medium', 'high'
  estimated_time_minutes INTEGER,        -- Estimated time to complete
  benefits TEXT,                         -- JSON: Array of benefits
  risks TEXT,                            -- JSON: Array of risks
  rollback_plan TEXT,                    -- Rollback strategy
  status TEXT NOT NULL DEFAULT 'proposed', -- 'proposed', 'approved', 'in_progress', 'completed', 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,                      -- When DJ approved
  completed_at TEXT,                     -- When refactor was completed
  user_feedback TEXT,                    -- DJ's feedback
  metadata TEXT                          -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_refactor_status
  ON refactor_proposals(status);
CREATE INDEX IF NOT EXISTS idx_refactor_created
  ON refactor_proposals(created_at DESC);

-- =============================================================================
-- Table 4: capability_gaps (Capability Gap Analysis)
-- =============================================================================
CREATE TABLE IF NOT EXISTS capability_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_id TEXT NOT NULL UNIQUE,           -- ULID
  operation_name TEXT NOT NULL,          -- Name of repeated operation
  operation_description TEXT NOT NULL,   -- Description
  manual_count INTEGER DEFAULT 1,        -- How many times DJ did this manually
  last_seen_at TEXT NOT NULL,            -- Last time this was detected
  automation_suggestion TEXT,            -- How to automate this
  estimated_time_saved_minutes INTEGER,  -- Estimated time saved per automation
  priority TEXT NOT NULL DEFAULT 'low',  -- 'low', 'medium', 'high'
  status TEXT NOT NULL DEFAULT 'detected', -- 'detected', 'proposed', 'approved', 'implemented', 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,                      -- When gap was resolved
  user_feedback TEXT,                    -- DJ's feedback
  metadata TEXT                          -- JSON: Additional context
);

CREATE INDEX IF NOT EXISTS idx_capability_gaps_operation
  ON capability_gaps(operation_name);
CREATE INDEX IF NOT EXISTS idx_capability_gaps_status
  ON capability_gaps(status);
CREATE INDEX IF NOT EXISTS idx_capability_gaps_priority
  ON capability_gaps(priority);

-- =============================================================================
-- Table 5: meta_agent_log (Meta-Agent Action Log)
-- =============================================================================
CREATE TABLE IF NOT EXISTS meta_agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id TEXT NOT NULL UNIQUE,           -- ULID
  action_type TEXT NOT NULL,             -- 'self_audit', 'code_review', 'refactor', 'gap_analysis', 'kill_switch'
  action_status TEXT NOT NULL,           -- 'started', 'in_progress', 'completed', 'failed', 'cancelled'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,                     -- When action completed
  duration_ms INTEGER,                   -- Duration in milliseconds
  result_summary TEXT,                   -- Summary of results
  error_message TEXT,                    -- Error message if failed
  metadata TEXT                          -- JSON: Additional context (files changed, etc.)
);

CREATE INDEX IF NOT EXISTS idx_meta_agent_log_type
  ON meta_agent_log(action_type);
CREATE INDEX IF NOT EXISTS idx_meta_agent_log_status
  ON meta_agent_log(action_status);
CREATE INDEX IF NOT EXISTS idx_meta_agent_log_started
  ON meta_agent_log(started_at DESC);

-- =============================================================================
-- Meta-Agent State Table (Kill Switch)
-- =============================================================================
CREATE TABLE IF NOT EXISTS meta_agent_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton table (only 1 row)
  enabled INTEGER DEFAULT 1,             -- 0=stopped (kill switch active), 1=enabled
  self_audit_enabled INTEGER DEFAULT 1,  -- Individual feature toggles
  code_review_enabled INTEGER DEFAULT 1,
  refactor_enabled INTEGER DEFAULT 1,
  gap_analysis_enabled INTEGER DEFAULT 1,
  last_modified_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_modified_by TEXT DEFAULT 'system'
);

-- Insert default state
INSERT OR IGNORE INTO meta_agent_state (id, enabled)
VALUES (1, 1);

-- =============================================================================
-- Migration Complete
-- =============================================================================
