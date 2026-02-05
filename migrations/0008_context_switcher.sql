-- Migration: Proactive Context Switcher
-- Created: 2026-02-04
-- Description: Add work_mode and focus_mode support to jarvis_context

-- =============================================================================
-- Add work_mode column to jarvis_context
-- =============================================================================

-- Check if work_mode column exists, if not add it
ALTER TABLE jarvis_context ADD COLUMN work_mode TEXT DEFAULT 'chatting';

-- Check if focus_mode column exists, if not add it
ALTER TABLE jarvis_context ADD COLUMN focus_mode INTEGER DEFAULT 0; -- 0=off, 1=on

-- Check if recommended_ai column exists, if not add it
ALTER TABLE jarvis_context ADD COLUMN recommended_ai TEXT DEFAULT 'jarvis';

-- Check if mode_confidence column exists, if not add it
ALTER TABLE jarvis_context ADD COLUMN mode_confidence REAL DEFAULT 0.0;

-- =============================================================================
-- Create focus_mode_buffer table (for buffering notifications)
-- =============================================================================

CREATE TABLE IF NOT EXISTS focus_mode_buffer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL, -- 'info', 'warning', 'error', 'success'
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered INTEGER DEFAULT 0 -- 0=pending, 1=delivered
);

CREATE INDEX IF NOT EXISTS idx_focus_buffer_user
  ON focus_mode_buffer(user_id);
CREATE INDEX IF NOT EXISTS idx_focus_buffer_delivered
  ON focus_mode_buffer(delivered);

-- =============================================================================
-- Create interrupt_snapshot table (for Interrupt Recovery)
-- =============================================================================

CREATE TABLE IF NOT EXISTS interrupt_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  work_mode TEXT NOT NULL,
  current_task TEXT,
  current_phase TEXT,
  snapshot_data TEXT, -- JSON: full context snapshot
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  restored INTEGER DEFAULT 0 -- 0=not restored, 1=restored
);

CREATE INDEX IF NOT EXISTS idx_interrupt_user
  ON interrupt_snapshot(user_id);
CREATE INDEX IF NOT EXISTS idx_interrupt_session
  ON interrupt_snapshot(session_id);
CREATE INDEX IF NOT EXISTS idx_interrupt_restored
  ON interrupt_snapshot(restored);

-- =============================================================================
-- Migration Complete
-- =============================================================================
