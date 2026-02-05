-- Migration: Consolidated Notification Architecture
-- Created: 2026-02-04
-- Description: D1 tables for unified notification control system

-- =============================================================================
-- Table 1: jarvis_control_tower (現在の状態)
-- =============================================================================
CREATE TABLE IF NOT EXISTS jarvis_control_tower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'idle',              -- アイドル状態
    'thinking',          -- LLM思考中
    'planning',          -- プラン生成中
    'executing',         -- アクション実行中
    'waiting_approval',  -- ユーザー承認待ち
    'completed',         -- 完了
    'error'              -- エラー
  )),
  phase TEXT,            -- 任意のphase名（例: "Phase 3: Implementation"）
  current_action TEXT,   -- 現在のアクション（例: "Reading file.ts"）
  started_at INTEGER NOT NULL,  -- UNIX timestamp
  updated_at INTEGER NOT NULL,  -- UNIX timestamp
  metadata TEXT,         -- JSON形式の追加情報
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_control_tower_session
  ON jarvis_control_tower(session_id);
CREATE INDEX IF NOT EXISTS idx_control_tower_status
  ON jarvis_control_tower(status);
CREATE INDEX IF NOT EXISTS idx_control_tower_updated
  ON jarvis_control_tower(updated_at);

-- =============================================================================
-- Table 2: jarvis_action_trace (履歴)
-- =============================================================================
CREATE TABLE IF NOT EXISTS jarvis_action_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  action_type TEXT NOT NULL,  -- "tool", "thinking", "text", "error", etc.
  action_name TEXT,           -- "Read", "Edit", "Bash", etc.
  status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  metadata TEXT,              -- JSON形式の追加情報
  -- Phase E: /why command fields
  trace_id TEXT,              -- UUID for tracking this action
  task_id TEXT,               -- Task identifier
  inputs_redacted TEXT,       -- Redacted inputs (no sensitive data)
  decisions TEXT,             -- JSON: Decision rationale
  outputs_summary TEXT,       -- Summary of outputs
  error_summary TEXT,         -- Error summary if failed
  rollback_instruction TEXT,  -- How to rollback this action
  FOREIGN KEY(session_id) REFERENCES jarvis_control_tower(session_id)
);

CREATE INDEX IF NOT EXISTS idx_action_trace_session
  ON jarvis_action_trace(session_id);
CREATE INDEX IF NOT EXISTS idx_action_trace_type
  ON jarvis_action_trace(action_type);
CREATE INDEX IF NOT EXISTS idx_action_trace_status
  ON jarvis_action_trace(status);
CREATE INDEX IF NOT EXISTS idx_action_trace_started
  ON jarvis_action_trace(started_at);

-- =============================================================================
-- Table 3: jarvis_settings (設定)
-- =============================================================================
CREATE TABLE IF NOT EXISTS jarvis_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- デフォルト設定
INSERT OR IGNORE INTO jarvis_settings (key, value, updated_at) VALUES
  ('notification_buffer_enabled', 'true', strftime('%s', 'now'));
INSERT OR IGNORE INTO jarvis_settings (key, value, updated_at) VALUES
  ('phase_notifications_enabled', 'true', strftime('%s', 'now'));
INSERT OR IGNORE INTO jarvis_settings (key, value, updated_at) VALUES
  ('spam_prevention_threshold', '10', strftime('%s', 'now'));
INSERT OR IGNORE INTO jarvis_settings (key, value, updated_at) VALUES
  ('why_allowlist_user_ids', '[]', strftime('%s', 'now'));

-- =============================================================================
-- Migration Complete
-- =============================================================================
