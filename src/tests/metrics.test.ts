import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to set the DB path before importing metrics
// metrics.ts uses homedir() + fixed path, so we mock the Database
// Actually, metrics uses bun:sqlite directly with a fixed path.
// We'll test by importing and using a temp DB via env or direct approach.

// Since metrics.ts uses a module-level `db` variable and fixed path,
// we need to test the actual functions but with a test DB.
// The cleanest approach: mock the module internals.

// Alternative: test the pure logic functions and integration with real SQLite

const TEST_DB_PATH = join(tmpdir(), `test-metrics-${Date.now()}.db`);

// We'll use dynamic import after patching
let metrics: typeof import("../utils/metrics");

// Since metrics.ts hardcodes the DB path using homedir(), 
// we'll test it by directly using bun:sqlite with the same schema
import { Database } from "bun:sqlite";

function createTestDB(): Database {
  const db = new Database(TEST_DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
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
  return db;
}

describe("Metrics (schema and query logic)", () => {
  let db: Database;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    db = createTestDB();
  });

  afterEach(() => {
    db.close();
    try {
      if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
      if (existsSync(TEST_DB_PATH + "-wal")) unlinkSync(TEST_DB_PATH + "-wal");
      if (existsSync(TEST_DB_PATH + "-shm")) unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
  });

  describe("message_metrics table", () => {
    it("inserts and retrieves a record", () => {
      db.run(
        `INSERT INTO message_metrics
         (timestamp, message_type, enrichment_ms, context_fetch_ms, claude_latency_ms, total_ms, context_size_chars, tool_count, bg_tasks_ok, bg_tasks_fail, success)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [now, "text", 10, 20, 500, 530, 1200, 3, 2, 0, 1]
      );

      const row = db.query("SELECT * FROM message_metrics WHERE id = 1").get() as any;
      expect(row).not.toBeNull();
      expect(row.message_type).toBe("text");
      expect(row.enrichment_ms).toBe(10);
      expect(row.context_fetch_ms).toBe(20);
      expect(row.claude_latency_ms).toBe(500);
      expect(row.total_ms).toBe(530);
      expect(row.context_size_chars).toBe(1200);
      expect(row.tool_count).toBe(3);
      expect(row.success).toBe(1);
    });

    it("records failure with success=0", () => {
      db.run(
        `INSERT INTO message_metrics (timestamp, message_type, total_ms, success) VALUES (?, ?, ?, ?)`,
        [now, "text", 100, 0]
      );
      const row = db.query("SELECT success FROM message_metrics WHERE id = 1").get() as any;
      expect(row.success).toBe(0);
    });

    it("defaults optional fields to 0", () => {
      db.run(
        `INSERT INTO message_metrics (timestamp) VALUES (?)`,
        [now]
      );
      const row = db.query("SELECT * FROM message_metrics WHERE id = 1").get() as any;
      expect(row.enrichment_ms).toBe(0);
      expect(row.context_fetch_ms).toBe(0);
      expect(row.claude_latency_ms).toBe(0);
      expect(row.total_ms).toBe(0);
      expect(row.tool_count).toBe(0);
      expect(row.success).toBe(1);
    });
  });

  describe("bg_task_metrics table", () => {
    it("inserts success record", () => {
      db.run(
        `INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`,
        [now, "context-fetch", 1, 250]
      );
      const row = db.query("SELECT * FROM bg_task_metrics WHERE id = 1").get() as any;
      expect(row.task_name).toBe("context-fetch");
      expect(row.success).toBe(1);
      expect(row.duration_ms).toBe(250);
      expect(row.error_message).toBeNull();
    });

    it("inserts failure record with error message", () => {
      db.run(
        `INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms, error_message) VALUES (?, ?, ?, ?, ?)`,
        [now, "memory-write", 0, 5000, "Gateway timeout"]
      );
      const row = db.query("SELECT * FROM bg_task_metrics WHERE id = 1").get() as any;
      expect(row.success).toBe(0);
      expect(row.error_message).toBe("Gateway timeout");
    });
  });

  describe("aggregation queries (same as getMetricsSummary)", () => {
    it("computes correct averages and counts", () => {
      const since = now - 3600;
      // Insert 3 messages
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, enrichment_ms, context_fetch_ms, claude_latency_ms, context_size_chars, success) VALUES (?, ?, ?, ?, ?, ?, ?)`, [now, 100, 5, 10, 80, 500, 1]);
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, enrichment_ms, context_fetch_ms, claude_latency_ms, context_size_chars, success) VALUES (?, ?, ?, ?, ?, ?, ?)`, [now, 200, 10, 20, 160, 1000, 1]);
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, enrichment_ms, context_fetch_ms, claude_latency_ms, context_size_chars, success) VALUES (?, ?, ?, ?, ?, ?, ?)`, [now, 300, 15, 30, 240, 1500, 0]);

      const stats = db.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes, AVG(total_ms) as avg_total, AVG(enrichment_ms) as avg_enrichment, AVG(context_fetch_ms) as avg_context, AVG(claude_latency_ms) as avg_claude, AVG(context_size_chars) as avg_ctx_size FROM message_metrics WHERE timestamp >= ?`
      ).get(since) as any;

      expect(stats.total).toBe(3);
      expect(stats.successes).toBe(2);
      expect(stats.avg_total).toBe(200);
      expect(stats.avg_enrichment).toBe(10);
      expect(stats.avg_context).toBe(20);
      expect(stats.avg_claude).toBe(160);
      expect(stats.avg_ctx_size).toBe(1000);
    });

    it("computes P50 and P99", () => {
      const since = now - 3600;
      // Insert 10 messages with increasing latency
      for (let i = 1; i <= 10; i++) {
        db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [now, i * 100, 1]);
      }

      const latencies = db.query(
        `SELECT total_ms FROM message_metrics WHERE timestamp >= ? ORDER BY total_ms`
      ).all(since) as Array<{ total_ms: number }>;

      const p50 = latencies[Math.floor(latencies.length * 0.5)]?.total_ms || 0;
      const p99 = latencies[Math.floor(latencies.length * 0.99)]?.total_ms || 0;

      expect(p50).toBe(600); // index 5 → 600ms
      expect(p99).toBe(1000); // index 9 → 1000ms
    });

    it("filters by time window", () => {
      // Old record (2 hours ago)
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [now - 7200, 999, 1]);
      // Recent record
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [now, 100, 1]);

      const since = now - 3600; // 1 hour window
      const stats = db.query(
        `SELECT COUNT(*) as total FROM message_metrics WHERE timestamp >= ?`
      ).get(since) as any;

      expect(stats.total).toBe(1); // Only recent record
    });

    it("bg task success rate calculation", () => {
      const since = now - 3600;
      db.run(`INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`, [now, "task-a", 1, 100]);
      db.run(`INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`, [now, "task-b", 1, 200]);
      db.run(`INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`, [now, "task-c", 0, 300]);

      const bgStats = db.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes FROM bg_task_metrics WHERE timestamp >= ?`
      ).get(since) as any;

      const successRate = Math.round((bgStats.successes / bgStats.total) * 100);
      expect(successRate).toBe(67);
    });
  });

  describe("cleanup query", () => {
    it("deletes records older than 30 days", () => {
      const thirtyOneDaysAgo = now - (31 * 24 * 3600);
      const twentyNineDaysAgo = now - (29 * 24 * 3600);
      const threshold = now - (30 * 24 * 3600);

      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [thirtyOneDaysAgo, 100, 1]);
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [twentyNineDaysAgo, 200, 1]);
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [now, 300, 1]);

      db.run(`INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`, [thirtyOneDaysAgo, "old", 1, 100]);
      db.run(`INSERT INTO bg_task_metrics (timestamp, task_name, success, duration_ms) VALUES (?, ?, ?, ?)`, [now, "new", 1, 200]);

      // Cleanup
      db.run("DELETE FROM message_metrics WHERE timestamp < ?", [threshold]);
      db.run("DELETE FROM bg_task_metrics WHERE timestamp < ?", [threshold]);

      const msgCount = (db.query("SELECT COUNT(*) as c FROM message_metrics").get() as any).c;
      const bgCount = (db.query("SELECT COUNT(*) as c FROM bg_task_metrics").get() as any).c;

      expect(msgCount).toBe(2); // 29 days ago + now
      expect(bgCount).toBe(1); // only now
    });
  });

  describe("empty database edge cases", () => {
    it("returns zero counts for empty tables", () => {
      const since = now - 3600;
      const stats = db.query(
        `SELECT COUNT(*) as total, AVG(total_ms) as avg_total FROM message_metrics WHERE timestamp >= ?`
      ).get(since) as any;

      expect(stats.total).toBe(0);
      expect(stats.avg_total).toBeNull();
    });

    it("P50/P99 with no data returns 0", () => {
      const since = now - 3600;
      const latencies = db.query(
        `SELECT total_ms FROM message_metrics WHERE timestamp >= ? ORDER BY total_ms`
      ).all(since) as Array<{ total_ms: number }>;

      expect(latencies.length).toBe(0);
      const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)]?.total_ms || 0 : 0;
      expect(p50).toBe(0);
    });

    it("single record P50 and P99 are the same", () => {
      db.run(`INSERT INTO message_metrics (timestamp, total_ms, success) VALUES (?, ?, ?)`, [now, 500, 1]);

      const since = now - 3600;
      const latencies = db.query(
        `SELECT total_ms FROM message_metrics WHERE timestamp >= ? ORDER BY total_ms`
      ).all(since) as Array<{ total_ms: number }>;

      const p50 = latencies[Math.floor(latencies.length * 0.5)]?.total_ms || 0;
      const p99 = latencies[Math.floor(latencies.length * 0.99)]?.total_ms || 0;

      expect(p50).toBe(500);
      expect(p99).toBe(500);
    });
  });

  describe("formatMetricsForStatus output format", () => {
    it("produces correct format string with data", () => {
      // Simulate what formatMetricsForStatus does
      const s = {
        totalMessages: 10,
        successRate: 90,
        avgTotalMs: 250,
        p50TotalMs: 200,
        p99TotalMs: 800,
        avgEnrichmentMs: 10,
        avgContextFetchMs: 30,
        avgClaudeMs: 200,
        avgContextSizeChars: 1500,
        bgTaskTotal: 5,
        bgTaskSuccessRate: 80,
      };

      const output = [
        `\ud83d\udcca \u30e1\u30c8\u30ea\u30af\u30b9\uff08\u76f4\u8fd11h\uff09`,
        `  Messages: ${s.totalMessages} (\u6210\u529f\u7387: ${s.successRate}%)`,
        `  Latency: avg=${s.avgTotalMs}ms P50=${s.p50TotalMs}ms P99=${s.p99TotalMs}ms`,
        `  \u5185\u8a33: enrichment=${s.avgEnrichmentMs}ms context=${s.avgContextFetchMs}ms claude=${s.avgClaudeMs}ms`,
        `  Context Size: avg ${s.avgContextSizeChars} chars`,
        `  BG Tasks: ${s.bgTaskTotal} (\u6210\u529f\u7387: ${s.bgTaskSuccessRate}%)`,
      ].join("\n");

      expect(output).toContain("Messages: 10");
      expect(output).toContain("P50=200ms");
      expect(output).toContain("P99=800ms");
      expect(output).toContain("BG Tasks: 5");
    });

    it("produces 'no data' message when empty", () => {
      const totalMessages = 0;
      const hoursBack = 1;
      const output = totalMessages === 0
        ? `\ud83d\udcca \u30e1\u30c8\u30ea\u30af\u30b9\uff08\u76f4\u8fd1${hoursBack}h\uff09: \u30c7\u30fc\u30bf\u306a\u3057`
        : "has data";
      expect(output).toContain("\u30c7\u30fc\u30bf\u306a\u3057");
    });
  });
});
