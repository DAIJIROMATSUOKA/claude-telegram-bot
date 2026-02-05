/**
 * Control Tower DB - D1-compatible SQLite wrapper
 *
 * Manages jarvis_control_tower, jarvis_action_trace, and jarvis_settings tables
 */

import { Database } from 'bun:sqlite';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ControlTowerRow {
  id: number;
  session_id: string;
  status: string;
  phase: string | null;
  current_action: string | null;
  started_at: number;
  updated_at: number;
  metadata: string | null;
}

export interface ActionTraceRow {
  id: number;
  session_id: string;
  action_type: string;
  action_name: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  metadata: string | null;
  // Phase E new fields
  trace_id: string | null;
  task_id: string | null;
  inputs_redacted: string | null;
  decisions: string | null;
  outputs_summary: string | null;
  error_summary: string | null;
  rollback_instruction: string | null;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface UpdateControlTowerParams {
  session_id: string;
  status: string;
  phase?: string;
  current_action?: string;
  metadata?: any;
}

export interface StartActionTraceParams {
  session_id: string;
  action_type: string;
  action_name?: string;
  metadata?: any;
  // Phase E new fields
  trace_id?: string;
  task_id?: string;
  inputs_redacted?: string;
  decisions?: any;
}

export interface CompleteActionTraceParams {
  id: number;
  status: 'completed' | 'failed';
  completed_at: number;
  duration_ms?: number;
  metadata?: any;
  // Phase E new fields
  outputs_summary?: string;
  error_summary?: string;
  rollback_instruction?: string;
}

export interface UpdateSettingParams {
  key: string;
  value: string;
}

// ============================================================================
// ControlTowerDB Class
// ============================================================================

export class ControlTowerDB {
  private db: Database;

  constructor(dbPath: string = '/tmp/jarvis_control_tower.db') {
    // Open database
    this.db = new Database(dbPath, { create: true });

    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL');

    // Run migration
    this.migrate();
  }

  // ==========================================================================
  // Migration
  // ==========================================================================

  private migrate(): void {
    const migrationPath = resolve(__dirname, '../../migrations/0002_notification_control_tower.sql');

    if (existsSync(migrationPath)) {
      const sql = readFileSync(migrationPath, 'utf-8');
      this.db.exec(sql);
      console.log('[ControlTowerDB] Migration applied successfully');
    } else {
      // Fallback: create tables inline
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS jarvis_control_tower (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN (
            'idle', 'thinking', 'planning', 'executing',
            'waiting_approval', 'completed', 'error'
          )),
          phase TEXT,
          current_action TEXT,
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_control_tower_session
          ON jarvis_control_tower(session_id);
        CREATE INDEX IF NOT EXISTS idx_control_tower_status
          ON jarvis_control_tower(status);
        CREATE INDEX IF NOT EXISTS idx_control_tower_updated
          ON jarvis_control_tower(updated_at);

        CREATE TABLE IF NOT EXISTS jarvis_action_trace (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_name TEXT,
          status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed')),
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_ms INTEGER,
          metadata TEXT,
          trace_id TEXT,
          task_id TEXT,
          inputs_redacted TEXT,
          decisions TEXT,
          outputs_summary TEXT,
          error_summary TEXT,
          rollback_instruction TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_action_trace_session
          ON jarvis_action_trace(session_id);
        CREATE INDEX IF NOT EXISTS idx_action_trace_type
          ON jarvis_action_trace(action_type);
        CREATE INDEX IF NOT EXISTS idx_action_trace_status
          ON jarvis_action_trace(status);
        CREATE INDEX IF NOT EXISTS idx_action_trace_started
          ON jarvis_action_trace(started_at);

        CREATE TABLE IF NOT EXISTS jarvis_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO jarvis_settings (key, value, updated_at) VALUES
          ('notification_buffer_enabled', 'true', strftime('%s', 'now')),
          ('phase_notifications_enabled', 'true', strftime('%s', 'now')),
          ('spam_prevention_threshold', '10', strftime('%s', 'now')),
          ('why_allowlist_user_ids', '[]', strftime('%s', 'now'));
      `);
      console.log('[ControlTowerDB] Fallback migration applied');
    }
  }

  // ==========================================================================
  // Control Tower Methods
  // ==========================================================================

  updateControlTower(params: UpdateControlTowerParams): void {
    const now = Math.floor(Date.now() / 1000);
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO jarvis_control_tower (session_id, status, phase, current_action, started_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        phase = excluded.phase,
        current_action = excluded.current_action,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata
    `);

    stmt.run(
      params.session_id,
      params.status,
      params.phase || null,
      params.current_action || null,
      now,
      now,
      metadata
    );
  }

  getControlTower(sessionId: string): ControlTowerRow | null {
    const stmt = this.db.prepare('SELECT * FROM jarvis_control_tower WHERE session_id = ?');
    const row = stmt.get(sessionId) as ControlTowerRow | null;
    return row;
  }

  getAllControlTowers(): ControlTowerRow[] {
    const stmt = this.db.prepare('SELECT * FROM jarvis_control_tower ORDER BY updated_at DESC');
    return stmt.all() as ControlTowerRow[];
  }

  // ==========================================================================
  // Action Trace Methods
  // ==========================================================================

  startActionTrace(params: StartActionTraceParams): number {
    const now = Math.floor(Date.now() / 1000);
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;
    const decisions = params.decisions ? JSON.stringify(params.decisions) : null;

    const stmt = this.db.prepare(`
      INSERT INTO jarvis_action_trace (
        session_id, action_type, action_name, status, started_at,
        metadata, trace_id, task_id, inputs_redacted, decisions
      )
      VALUES (?, ?, ?, 'started', ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.session_id,
      params.action_type,
      params.action_name || null,
      now,
      metadata,
      params.trace_id || null,
      params.task_id || null,
      params.inputs_redacted || null,
      decisions
    );

    return Number(result.lastInsertRowid);
  }

  completeActionTrace(params: CompleteActionTraceParams): void {
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    const stmt = this.db.prepare(`
      UPDATE jarvis_action_trace
      SET status = ?,
          completed_at = ?,
          duration_ms = ?,
          metadata = COALESCE(?, metadata),
          outputs_summary = ?,
          error_summary = ?,
          rollback_instruction = ?
      WHERE id = ?
    `);

    stmt.run(
      params.status,
      params.completed_at,
      params.duration_ms || null,
      metadata,
      params.outputs_summary || null,
      params.error_summary || null,
      params.rollback_instruction || null,
      params.id
    );
  }

  getActionTraces(sessionId: string, limit: number = 100): ActionTraceRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jarvis_action_trace
      WHERE session_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    return stmt.all(sessionId, limit) as ActionTraceRow[];
  }

  getLatestActionTrace(sessionId: string): ActionTraceRow | null {
    const stmt = this.db.prepare(`
      SELECT * FROM jarvis_action_trace
      WHERE session_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);

    return stmt.get(sessionId) as ActionTraceRow | null;
  }

  // ==========================================================================
  // Settings Methods
  // ==========================================================================

  updateSetting(params: UpdateSettingParams): void {
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO jarvis_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    stmt.run(params.key, params.value, now);
  }

  getSetting(key: string): SettingRow | null {
    const stmt = this.db.prepare('SELECT * FROM jarvis_settings WHERE key = ?');
    return stmt.get(key) as SettingRow | null;
  }

  getAllSettings(): SettingRow[] {
    const stmt = this.db.prepare('SELECT * FROM jarvis_settings ORDER BY key');
    return stmt.all() as SettingRow[];
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const controlTowerDB = new ControlTowerDB();
