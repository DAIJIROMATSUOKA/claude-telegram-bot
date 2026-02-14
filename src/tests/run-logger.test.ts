// @ts-nocheck
/**
 * Tests for src/task/run-logger.ts
 *
 * Covers: RunLogger event logging, summary writing, query helpers
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RunLogger, listRecentRuns, readRunEvents, readRunSummary } from "../task/run-logger";

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "runlogger-test-"));
  process.env.TASK_RUN_LOGS_DIR = tempHome;
});

afterEach(() => {
  delete process.env.TASK_RUN_LOGS_DIR;
  try { rmSync(tempHome, { recursive: true }); } catch {};
});

describe("RunLogger", () => {
  test("generates unique run_id from plan_id", () => {
    const logger = new RunLogger("TP-001");
    expect(logger.runId).toMatch(/^run_TP-001_\d{4}-\d{2}-\d{2}T/);
  });

  test("creates log directory and JSONL file", () => {
    const logger = new RunLogger("TP-002");
    logger.logEvent("run_start", { plan_id: "TP-002" });

    expect(existsSync(logger.logPath)).toBe(true);
    const content = readFileSync(logger.logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);

    const event = JSON.parse(lines[0]);
    expect(event.event).toBe("run_start");
    expect(event.run_id).toBe(logger.runId);
    expect(event.data.plan_id).toBe("TP-002");
    expect(event.timestamp).toBeTruthy();
  });

  test("appends multiple events to JSONL", () => {
    const logger = new RunLogger("TP-003");
    logger.logEvent("run_start", { plan_id: "TP-003" });
    logger.logEvent("task_start", { task_id: "MT-001" });
    logger.logEvent("task_done", { task_id: "MT-001", status: "success" });

    const lines = readFileSync(logger.logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).event).toBe("run_start");
    expect(JSON.parse(lines[1]).event).toBe("task_start");
    expect(JSON.parse(lines[2]).event).toBe("task_done");
  });

  test("writes summary JSON", () => {
    const logger = new RunLogger("TP-004");
    logger.writeSummary({
      plan_id: "TP-004",
      title: "Test Plan",
      final_status: "all_passed",
      total_tasks: 2,
      passed_tasks: 2,
      failed_tasks: 0,
      total_duration_seconds: 45,
      task_results: [
        {
          task_id: "MT-001",
          status: "success",
          duration_seconds: 20,
          exit_code: 0,
          violations: [],
          changed_files: ["src/a.ts"],
        },
        {
          task_id: "MT-002",
          status: "success",
          duration_seconds: 25,
          exit_code: 0,
          violations: [],
          changed_files: ["src/b.ts"],
        },
      ],
    });

    expect(existsSync(logger.summaryPath)).toBe(true);
    const summary = JSON.parse(readFileSync(logger.summaryPath, "utf-8"));
    expect(summary.run_id).toBe(logger.runId);
    expect(summary.plan_id).toBe("TP-004");
    expect(summary.final_status).toBe("all_passed");
    expect(summary.started_at).toBeTruthy();
    expect(summary.completed_at).toBeTruthy();
    expect(summary.task_results.length).toBe(2);
  });
});

describe("Query Helpers", () => {
  test("listRecentRuns returns summaries newest first", async () => {
    const l1 = new RunLogger("TP-A");
    l1.writeSummary({
      plan_id: "TP-A", title: "Plan A", final_status: "all_passed",
      total_tasks: 1, passed_tasks: 1, failed_tasks: 0,
      total_duration_seconds: 10, task_results: [],
    });

    await new Promise((r) => setTimeout(r, 10));

    const l2 = new RunLogger("TP-B");
    l2.writeSummary({
      plan_id: "TP-B", title: "Plan B", final_status: "failed",
      total_tasks: 1, passed_tasks: 0, failed_tasks: 1,
      total_duration_seconds: 5, task_results: [],
    });

    const runs = listRecentRuns(10);
    expect(runs.length).toBe(2);
    expect(runs[0].plan_id).toBe("TP-B");
    expect(runs[1].plan_id).toBe("TP-A");
  });

  test("readRunEvents returns parsed JSONL", () => {
    const logger = new RunLogger("TP-EVT");
    logger.logEvent("run_start", {});
    logger.logEvent("task_start", { task_id: "MT-001" });

    const events = readRunEvents(logger.runId);
    expect(events.length).toBe(2);
    expect(events[0].event).toBe("run_start");
    expect(events[1].event).toBe("task_start");
  });

  test("readRunEvents returns empty for non-existent run", () => {
    const events = readRunEvents("run_nonexistent_2099-01-01T00-00-00");
    expect(events).toEqual([]);
  });

  test("readRunSummary returns parsed summary", () => {
    const logger = new RunLogger("TP-SUM");
    logger.writeSummary({
      plan_id: "TP-SUM", title: "Summary Test", final_status: "partial",
      total_tasks: 3, passed_tasks: 2, failed_tasks: 1,
      total_duration_seconds: 60, task_results: [],
    });

    const summary = readRunSummary(logger.runId);
    expect(summary).not.toBeNull();
    expect(summary!.plan_id).toBe("TP-SUM");
    expect(summary!.final_status).toBe("partial");
  });

  test("readRunSummary returns null for non-existent", () => {
    expect(readRunSummary("run_nonexistent_2099")).toBeNull();
  });

  test("listRecentRuns respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      const l = new RunLogger(`TP-LIM-${i}`);
      l.writeSummary({
        plan_id: `TP-LIM-${i}`, title: `Plan ${i}`, final_status: "all_passed",
        total_tasks: 1, passed_tasks: 1, failed_tasks: 0,
        total_duration_seconds: 1, task_results: [],
      });
      await new Promise((r) => setTimeout(r, 5));
    }

    const runs = listRecentRuns(3);
    expect(runs.length).toBe(3);
  });
});
