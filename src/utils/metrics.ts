/**
 * Metrics - 軽量パフォーマンスメトリクス収集
 *
 * SQLiteにメッセージ処理のパフォーマンスデータを記録。
 * /status コマンドで直近のP50/P99レイテンシなどを表示可能。
 */

import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), '.claude-telegram-metrics.db');

let db: Database | null = null;

function getDB(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        enrichment_ms INTEGER DEFAULT 0,
        context_fetch_ms INTEGER DEFAULT 0,
        claude_latency_ms INTEGER DEFAULT 0,
        total_ms INTEGER DEFAULT 0,
        context_size_chars INTEGER DEFAULT 0,
        tool_count INTEGER DEFAULT 0,
        bg_tasks_ok INTEGER DEFAULT 0,
        bg_tasks_fail INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS bg_task_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        task_name TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER DEFAULT 0,
        error_message TEXT
      )
    `);
    // 30日より古いレコードを自動削除するトリガーは手動cleanup
  }
  return db;
}

// ============================================================================
// メッセージメトリクス
// ============================================================================

export interface MessageMetrics {
  message_type?: string;
  enrichment_ms?: number;
  context_fetch_ms?: number;
  claude_latency_ms?: number;
  total_ms?: number;
  context_size_chars?: number;
  tool_count?: number;
  bg_tasks_ok?: number;
  bg_tasks_fail?: number;
  success?: boolean;
}

export function recordMessageMetrics(metrics: MessageMetrics): void {
  try {
    const d = getDB();
    d.run(
      `INSERT INTO message_metrics
       (timestamp, message_type, enrichment_ms, context_fetch_ms, claude_latency_ms, total_ms, context_size_chars, tool_count, bg_tasks_ok, bg_tasks_fail, success)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Math.floor(Date.now() / 1000),
        metrics.message_type || 'text',
        metrics.enrichment_ms || 0,
        metrics.context_fetch_ms || 0,
        metrics.claude_latency_ms || 0,
        metrics.total_ms || 0,
        metrics.context_size_chars || 0,
        metrics.tool_count || 0,
        metrics.bg_tasks_ok || 0,
        metrics.bg_tasks_fail || 0,
        metrics.success !== false ? 1 : 0,
      ]
    );
  } catch (error) {
    console.error('[Metrics] Record error:', error);
  }
}

// ============================================================================
// バックグラウンドタスクメトリクス
// ============================================================================

export function recordBgTaskMetrics(
  taskName: string,
  success: boolean,
  durationMs: number,
  errorMessage?: string
): void {
  try {
    const d = getDB();
    d.run(
      `INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [Math.floor(Date.now() / 1000), taskName, success ? 1 : 0, durationMs, errorMessage || null]
    );
  } catch (error) {
    console.error('[Metrics] BgTask record error:', error);
  }
}

// ============================================================================
// 集計・表示用
// ============================================================================

export interface MetricsSummary {
  totalMessages: number;
  successRate: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p99TotalMs: number;
  avgEnrichmentMs: number;
  avgContextFetchMs: number;
  avgClaudeMs: number;
  avgContextSizeChars: number;
  bgTaskSuccessRate: number;
  bgTaskTotal: number;
}

/**
 * 直近N時間のメトリクス集計を取得
 */
export function getMetricsSummary(hoursBack: number = 1): MetricsSummary {
  try {
    const d = getDB();
    const since = Math.floor(Date.now() / 1000) - (hoursBack * 3600);

    // メッセージメトリクス集計
    const msgStats = d.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
         AVG(total_ms) as avg_total,
         AVG(enrichment_ms) as avg_enrichment,
         AVG(context_fetch_ms) as avg_context,
         AVG(claude_latency_ms) as avg_claude,
         AVG(context_size_chars) as avg_ctx_size
       FROM message_metrics
       WHERE timestamp >= ?`
    ).get(since) as any;

    // P50/P99 計算
    const latencies = d.query(
      `SELECT total_ms FROM message_metrics WHERE timestamp >= ? ORDER BY total_ms`
    ).all(since) as Array<{ total_ms: number }>;

    let p50 = 0;
    let p99 = 0;
    if (latencies.length > 0) {
      p50 = latencies[Math.floor(latencies.length * 0.5)]?.total_ms || 0;
      p99 = latencies[Math.floor(latencies.length * 0.99)]?.total_ms || 0;
    }

    // BGタスクメトリクス
    const bgStats = d.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
       FROM bg_task_metrics
       WHERE timestamp >= ?`
    ).get(since) as any;

    const total = msgStats?.total || 0;
    const bgTotal = bgStats?.total || 0;

    return {
      totalMessages: total,
      successRate: total > 0 ? Math.round(((msgStats?.successes || 0) / total) * 100) : 100,
      avgTotalMs: Math.round(msgStats?.avg_total || 0),
      p50TotalMs: p50,
      p99TotalMs: p99,
      avgEnrichmentMs: Math.round(msgStats?.avg_enrichment || 0),
      avgContextFetchMs: Math.round(msgStats?.avg_context || 0),
      avgClaudeMs: Math.round(msgStats?.avg_claude || 0),
      avgContextSizeChars: Math.round(msgStats?.avg_ctx_size || 0),
      bgTaskSuccessRate: bgTotal > 0 ? Math.round(((bgStats?.successes || 0) / bgTotal) * 100) : 100,
      bgTaskTotal: bgTotal,
    };
  } catch (error) {
    console.error('[Metrics] Summary error:', error);
    return {
      totalMessages: 0, successRate: 100, avgTotalMs: 0,
      p50TotalMs: 0, p99TotalMs: 0, avgEnrichmentMs: 0,
      avgContextFetchMs: 0, avgClaudeMs: 0, avgContextSizeChars: 0,
      bgTaskSuccessRate: 100, bgTaskTotal: 0,
    };
  }
}

/**
 * /status コマンド用のフォーマット済み文字列
 */
export function formatMetricsForStatus(hoursBack: number = 1): string {
  const s = getMetricsSummary(hoursBack);

  if (s.totalMessages === 0) {
    return `📊 メトリクス（直近${hoursBack}h）: データなし`;
  }

  return [
    `📊 メトリクス（直近${hoursBack}h）`,
    `  Messages: ${s.totalMessages} (成功率: ${s.successRate}%)`,
    `  Latency: avg=${s.avgTotalMs}ms P50=${s.p50TotalMs}ms P99=${s.p99TotalMs}ms`,
    `  内訳: enrichment=${s.avgEnrichmentMs}ms context=${s.avgContextFetchMs}ms claude=${s.avgClaudeMs}ms`,
    `  Context Size: avg ${s.avgContextSizeChars} chars`,
    `  BG Tasks: ${s.bgTaskTotal} (成功率: ${s.bgTaskSuccessRate}%)`,
  ].join('\n');
}

/**
 * 30日より古いレコードを削除
 */
export function cleanupOldMetrics(): void {
  try {
    const d = getDB();
    const threshold = Math.floor(Date.now() / 1000) - (30 * 24 * 3600);
    d.run('DELETE FROM message_metrics WHERE timestamp < ?', [threshold]);
    d.run('DELETE FROM bg_task_metrics WHERE timestamp < ?', [threshold]);
  } catch (error) {
    console.error('[Metrics] Cleanup error:', error);
  }
}
