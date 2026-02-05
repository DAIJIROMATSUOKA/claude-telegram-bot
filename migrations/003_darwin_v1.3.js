// migrations/003_darwin_v1.3.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'jarvis.db');
const db = new Database(dbPath);

console.log('📊 [Migration 003] Darwin Engine v1.3 - Self-Learning Workflow Optimizer');

try {
  // 1. workflow_patterns テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_key TEXT NOT NULL UNIQUE,
      description TEXT,
      frequency INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ workflow_patterns table created');

  // 2. context_cache テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      cache_data TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      accessed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ context_cache table created');

  // 3. time_blocks テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS time_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ time_blocks table created');

  // 4. focus_sessions テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      interruptions INTEGER DEFAULT 0,
      quality_score REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ focus_sessions table created');

  // 5. performance_metrics テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_type TEXT NOT NULL,
      metric_value REAL NOT NULL,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    )
  `);
  console.log('✅ performance_metrics table created');

  // 6. インデックス作成
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_workflow_patterns_frequency ON workflow_patterns(frequency DESC);
    CREATE INDEX IF NOT EXISTS idx_context_cache_expires ON context_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_time_blocks_status ON time_blocks(status);
    CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_performance_metrics_type ON performance_metrics(metric_type, recorded_at DESC);
  `);
  console.log('✅ Indexes created');

  console.log('✅ [Migration 003] Completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
