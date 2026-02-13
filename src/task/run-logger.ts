/**
 * Jarvis Task Orchestrator - Run Logger
 *
 * Persistent JSONL logging for every orchestrator execution.
 * Each run gets a unique run_id and a dedicated log file.
 *
 * Log location: ~/claude-telegram-bot/logs/task-runs/<run_id>.jsonl
 * Summary:      ~/claude-telegram-bot/logs/task-runs/<run_id>.summary.json
 *
 * Usage:
 *   const logger = new RunLogger(planId);
 *   logger.logEvent("task_start", { task_id: "MT-001", goal: "..." });
 *   logger.writeSummary(completionReport);
 */

import { mkdirSync, appendFileSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// === Types ===

export type RunEventType =
  | "run_start"
  | "task_start"
  | "task_exec_done"
  | "task_validation"
  | "task_committed"
  | "task_rollback"
  | "task_done"
  | "run_stopped"
  | "run_complete"
  | "error";

export interface RunEvent {
  timestamp: string;
  run_id: string;
  event: RunEventType;
  data: Record<string, unknown>;
}

export interface RunSummary {
  run_id: string;
  plan_id: string;
  title: string;
  started_at: string;
  completed_at: string;
  final_status: "all_passed" | "partial" | "failed";
  total_tasks: number;
  passed_tasks: number;
  failed_tasks: number;
  total_duration_seconds: number;
  task_results: Array<{
    task_id: string;
    status: string;
    duration_seconds: number;
    exit_code: number;
    violations: string[];
    changed_files: string[];
  }>;
}

// === Constants ===

function getLogsDir(): string {
  return process.env.TASK_RUN_LOGS_DIR || join(
    process.env.HOME || "/Users/daijiromatsuokam1",
    "claude-telegram-bot",
    "logs",
    "task-runs",
  );
}

// === RunLogger ===

export class RunLogger {
  readonly runId: string;
  readonly logPath: string;
  readonly summaryPath: string;
  private readonly startedAt: string;

  constructor(planId: string) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.runId = `run_${planId}_${ts}`;
    this.startedAt = new Date().toISOString();

    // Ensure log directory
    mkdirSync(getLogsDir(), { recursive: true });

    this.logPath = join(getLogsDir(), `${this.runId}.jsonl`);
    this.summaryPath = join(getLogsDir(), `${this.runId}.summary.json`);
  }

  /**
   * Append a structured event to the JSONL log
   */
  logEvent(event: RunEventType, data: Record<string, unknown> = {}): void {
    const entry: RunEvent = {
      timestamp: new Date().toISOString(),
      run_id: this.runId,
      event,
      data,
    };
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(`[RunLogger] Failed to write event:`, err);
    }
  }

  /**
   * Write the final summary JSON
   */
  writeSummary(summary: Omit<RunSummary, "run_id" | "started_at" | "completed_at">): void {
    const full: RunSummary = {
      ...summary,
      run_id: this.runId,
      started_at: this.startedAt,
      completed_at: new Date().toISOString(),
    };
    try {
      writeFileSync(this.summaryPath, JSON.stringify(full, null, 2) + "\n");
    } catch (err) {
      console.error(`[RunLogger] Failed to write summary:`, err);
    }
  }
}

// === Query Helpers (for /tasklog command) ===

/**
 * List recent run summaries (newest first)
 */
export function listRecentRuns(limit = 10): RunSummary[] {
  if (!existsSync(getLogsDir())) return [];

  const files = readdirSync(getLogsDir())
    .filter((f) => f.endsWith(".summary.json"))
    .sort()
    .reverse()
    .slice(0, limit);

  const results: RunSummary[] = [];
  for (const f of files) {
    try {
      const content = readFileSync(join(getLogsDir(), f), "utf-8");
      results.push(JSON.parse(content));
    } catch {}
  }
  return results;
}

/**
 * Read JSONL events for a specific run
 */
export function readRunEvents(runId: string): RunEvent[] {
  const logPath = join(getLogsDir(), `${runId}.jsonl`);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").trim().split("\n");
  const events: RunEvent[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

/**
 * Read summary for a specific run
 */
export function readRunSummary(runId: string): RunSummary | null {
  const summaryPath = join(getLogsDir(), `${runId}.summary.json`);
  if (!existsSync(summaryPath)) return null;
  try {
    return JSON.parse(readFileSync(summaryPath, "utf-8"));
  } catch {
    return null;
  }
}
