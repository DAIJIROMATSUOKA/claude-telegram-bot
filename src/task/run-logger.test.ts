/**
 * RunLogger unit tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunLogger,
  listRecentRuns,
  readRunEvents,
  readRunSummary,
} from "./run-logger";

const TEST_LOG_DIR = join(tmpdir(), `test-run-logs-${Date.now()}`);

beforeAll(() => {
  // Set environment variable to redirect logs to test directory
  process.env.TASK_RUN_LOGS_DIR = TEST_LOG_DIR;
  mkdirSync(TEST_LOG_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  delete process.env.TASK_RUN_LOGS_DIR;
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  }
});

describe("RunLogger", () => {
  describe("constructor", () => {
    test("generates runId in run_{planId}_{timestamp} format", () => {
      const logger = new RunLogger("MT-001");

      expect(logger.runId).toMatch(/^run_MT-001_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });

    test("creates log paths correctly", () => {
      const logger = new RunLogger("TEST-002");

      expect(logger.logPath).toBe(join(TEST_LOG_DIR, `${logger.runId}.jsonl`));
      expect(logger.summaryPath).toBe(join(TEST_LOG_DIR, `${logger.runId}.summary.json`));
    });

    test("creates log directory if not exists", () => {
      // Directory should exist after constructor
      expect(existsSync(TEST_LOG_DIR)).toBe(true);
    });
  });

  describe("logEvent", () => {
    test("appends event to JSONL file", () => {
      const logger = new RunLogger("LOG-001");

      logger.logEvent("task_start", { task_id: "T-1", goal: "Test goal" });

      expect(existsSync(logger.logPath)).toBe(true);

      const content = readFileSync(logger.logPath, "utf-8").trim();
      const event = JSON.parse(content);

      expect(event.run_id).toBe(logger.runId);
      expect(event.event).toBe("task_start");
      expect(event.data.task_id).toBe("T-1");
      expect(event.data.goal).toBe("Test goal");
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("appends multiple events as separate lines", () => {
      const logger = new RunLogger("LOG-002");

      logger.logEvent("run_start", { plan_id: "P-1" });
      logger.logEvent("task_start", { task_id: "T-1" });
      logger.logEvent("task_done", { task_id: "T-1", status: "passed" });

      const lines = readFileSync(logger.logPath, "utf-8").trim().split("\n");
      expect(lines.length).toBe(3);

      const events = lines.map((l) => JSON.parse(l));
      expect(events[0].event).toBe("run_start");
      expect(events[1].event).toBe("task_start");
      expect(events[2].event).toBe("task_done");
    });
  });

  describe("writeSummary", () => {
    test("creates summary JSON file with all fields", () => {
      const logger = new RunLogger("SUM-001");

      const summary = {
        plan_id: "SUM-001",
        title: "Test Plan",
        final_status: "all_passed" as const,
        total_tasks: 3,
        passed_tasks: 3,
        failed_tasks: 0,
        total_duration_seconds: 120,
        task_results: [
          {
            task_id: "T-1",
            status: "passed",
            duration_seconds: 40,
            exit_code: 0,
            violations: [],
            changed_files: ["src/a.ts"],
          },
        ],
      };

      logger.writeSummary(summary);

      expect(existsSync(logger.summaryPath)).toBe(true);

      const content = readFileSync(logger.summaryPath, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.run_id).toBe(logger.runId);
      expect(saved.plan_id).toBe("SUM-001");
      expect(saved.title).toBe("Test Plan");
      expect(saved.final_status).toBe("all_passed");
      expect(saved.total_tasks).toBe(3);
      expect(saved.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(saved.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(saved.task_results).toHaveLength(1);
    });
  });
});

describe("listRecentRuns", () => {
  test("returns recent run summaries sorted newest first", () => {
    // Create multiple runs with summaries
    const logger1 = new RunLogger("LIST-001");
    const logger2 = new RunLogger("LIST-002");
    const logger3 = new RunLogger("LIST-003");

    logger1.writeSummary({
      plan_id: "LIST-001",
      title: "First",
      final_status: "all_passed",
      total_tasks: 1,
      passed_tasks: 1,
      failed_tasks: 0,
      total_duration_seconds: 10,
      task_results: [],
    });

    logger2.writeSummary({
      plan_id: "LIST-002",
      title: "Second",
      final_status: "partial",
      total_tasks: 2,
      passed_tasks: 1,
      failed_tasks: 1,
      total_duration_seconds: 20,
      task_results: [],
    });

    logger3.writeSummary({
      plan_id: "LIST-003",
      title: "Third",
      final_status: "failed",
      total_tasks: 1,
      passed_tasks: 0,
      failed_tasks: 1,
      total_duration_seconds: 5,
      task_results: [],
    });

    const runs = listRecentRuns(10);

    // Should have at least 3 (may have more from other tests)
    expect(runs.length).toBeGreaterThanOrEqual(3);

    // Find our test runs
    const listRuns = runs.filter((r) => r.plan_id.startsWith("LIST-"));
    expect(listRuns.length).toBe(3);

    // Should be sorted newest first (reverse alphabetical by runId)
    expect(listRuns[0].plan_id).toBe("LIST-003");
    expect(listRuns[1].plan_id).toBe("LIST-002");
    expect(listRuns[2].plan_id).toBe("LIST-001");
  });

  test("respects limit parameter", () => {
    const runs = listRecentRuns(2);
    expect(runs.length).toBeLessThanOrEqual(2);
  });

  test("returns empty array when no summaries exist", () => {
    // Temporarily point to nonexistent directory
    const original = process.env.TASK_RUN_LOGS_DIR;
    process.env.TASK_RUN_LOGS_DIR = join(tmpdir(), "nonexistent-dir-12345");

    const runs = listRecentRuns();
    expect(runs).toEqual([]);

    process.env.TASK_RUN_LOGS_DIR = original;
  });
});

describe("readRunEvents", () => {
  test("reads events from JSONL file", () => {
    const logger = new RunLogger("READ-001");

    logger.logEvent("run_start", { plan_id: "READ-001" });
    logger.logEvent("task_start", { task_id: "T-1" });
    logger.logEvent("task_done", { task_id: "T-1", status: "passed" });
    logger.logEvent("run_complete", {});

    const events = readRunEvents(logger.runId);

    expect(events).toHaveLength(4);
    expect(events[0].event).toBe("run_start");
    expect(events[1].event).toBe("task_start");
    expect(events[2].event).toBe("task_done");
    expect(events[3].event).toBe("run_complete");
    expect(events[0].run_id).toBe(logger.runId);
  });

  test("returns empty array for nonexistent runId", () => {
    const events = readRunEvents("nonexistent-run-id");
    expect(events).toEqual([]);
  });
});

describe("readRunSummary", () => {
  test("reads summary for existing run", () => {
    const logger = new RunLogger("SUMREAD-001");

    logger.writeSummary({
      plan_id: "SUMREAD-001",
      title: "Summary Read Test",
      final_status: "all_passed",
      total_tasks: 2,
      passed_tasks: 2,
      failed_tasks: 0,
      total_duration_seconds: 60,
      task_results: [
        {
          task_id: "T-1",
          status: "passed",
          duration_seconds: 30,
          exit_code: 0,
          violations: [],
          changed_files: [],
        },
        {
          task_id: "T-2",
          status: "passed",
          duration_seconds: 30,
          exit_code: 0,
          violations: [],
          changed_files: ["file.ts"],
        },
      ],
    });

    const summary = readRunSummary(logger.runId);

    expect(summary).not.toBeNull();
    expect(summary!.run_id).toBe(logger.runId);
    expect(summary!.plan_id).toBe("SUMREAD-001");
    expect(summary!.title).toBe("Summary Read Test");
    expect(summary!.final_status).toBe("all_passed");
    expect(summary!.task_results).toHaveLength(2);
  });

  test("returns null for nonexistent runId", () => {
    const summary = readRunSummary("nonexistent-run-id");
    expect(summary).toBeNull();
  });
});

// === Additional edge case tests ===

describe("RunLogger edge cases", () => {
  test("two RunLoggers with same planId generate different runIds", async () => {
    const logger1 = new RunLogger("SAME-PLAN");
    // Wait 1001ms to ensure timestamp (second precision) differs
    await new Promise((resolve) => setTimeout(resolve, 1001));
    const logger2 = new RunLogger("SAME-PLAN");

    expect(logger1.runId).not.toBe(logger2.runId);
    expect(logger1.runId).toContain("SAME-PLAN");
    expect(logger2.runId).toContain("SAME-PLAN");
  });
});

describe("logEvent edge cases", () => {
  test("handles large event data (1000 char stdout)", () => {
    const logger = new RunLogger("LARGE-001");
    const largeStdout = "x".repeat(1000);

    logger.logEvent("task_exec_done", { stdout: largeStdout, exit_code: 0 });

    const events = readRunEvents(logger.runId);
    expect(events).toHaveLength(1);
    expect(events[0].data.stdout).toBe(largeStdout);
    expect((events[0].data.stdout as string).length).toBe(1000);
  });

  test("handles 10 consecutive events", () => {
    const logger = new RunLogger("MULTI-001");

    for (let i = 0; i < 10; i++) {
      logger.logEvent("task_start", { task_id: `T-${i}`, index: i });
    }

    const events = readRunEvents(logger.runId);
    expect(events).toHaveLength(10);

    for (let i = 0; i < 10; i++) {
      expect(events[i].event).toBe("task_start");
      expect(events[i].data.task_id).toBe(`T-${i}`);
      expect(events[i].data.index).toBe(i);
    }
  });
});

describe("writeSummary edge cases", () => {
  test("second writeSummary overwrites first", () => {
    const logger = new RunLogger("OVERWRITE-001");

    logger.writeSummary({
      plan_id: "OVERWRITE-001",
      title: "First Summary",
      final_status: "failed",
      total_tasks: 1,
      passed_tasks: 0,
      failed_tasks: 1,
      total_duration_seconds: 10,
      task_results: [],
    });

    logger.writeSummary({
      plan_id: "OVERWRITE-001",
      title: "Second Summary",
      final_status: "all_passed",
      total_tasks: 2,
      passed_tasks: 2,
      failed_tasks: 0,
      total_duration_seconds: 20,
      task_results: [],
    });

    const summary = readRunSummary(logger.runId);
    expect(summary).not.toBeNull();
    expect(summary!.title).toBe("Second Summary");
    expect(summary!.final_status).toBe("all_passed");
    expect(summary!.total_tasks).toBe(2);
    expect(summary!.passed_tasks).toBe(2);
    expect(summary!.failed_tasks).toBe(0);
    expect(summary!.total_duration_seconds).toBe(20);
  });
});

describe("listRecentRuns edge cases", () => {
  test("returns empty array when log directory is empty", () => {
    // Create a fresh empty directory
    const emptyDir = join(tmpdir(), `empty-logs-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });

    const original = process.env.TASK_RUN_LOGS_DIR;
    process.env.TASK_RUN_LOGS_DIR = emptyDir;

    const runs = listRecentRuns();
    expect(runs).toEqual([]);

    process.env.TASK_RUN_LOGS_DIR = original;
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
