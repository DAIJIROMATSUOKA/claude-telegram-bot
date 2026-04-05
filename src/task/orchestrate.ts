/**
 * Jarvis Task Orchestrator - Main Loop
 *
 * Standalone script: bun run src/task/orchestrate.ts /tmp/taskplan.json
 *
 * Flow:
 * 1. Read TaskPlan JSON
 * 2. Create git worktree (isolated workspace)
 * 3. For each MicroTask: execute → validate → commit or rollback
 * 4. Send Completion Report
 * 5. Cleanup worktree (keep if DJ wants to inspect)
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";

const execAsync = promisify(exec);
import { loadJsonFile } from "../utils/json-loader";
import { join, resolve } from "node:path";
import type {
  TaskPlan,
  TaskResult,
  CompletionReport,
} from "./types";
import { executeMicroTask } from "./executor";
import { validate, rollback } from "./validator";
import {
  initReporter,
  notifyOrchestratorStarted,
  notifyTaskStarted,
  notifyTaskPassed,
  notifyTaskFailed,
  sendCompletionReport,
  notifyOrchestratorStopped,
  notifyHealthCheckFailed,
} from "./reporter";
import { RunLogger } from "./run-logger";
import { buildRetryPrompt, summarizeFailureReason } from "./retry";
import { checkDockerAvailable } from "./docker-runner";
import type { ValidatorMode } from "./types";
import { checkAllLimits } from "./resource-limits";
import { DEFAULT_RESOURCE_LIMITS } from "./types";
import { runHealthCheck } from "./health-check";

// === Config ===
const MAIN_REPO = process.env.HOME
  ? join(process.env.HOME, "claude-telegram-bot")
  : "/Users/daijiromatsuokam1/claude-telegram-bot";
const WORKTREE_BASE = "/tmp/jarvis-worktrees";
const PID_FILE = "/tmp/jarvis-orchestrator.pid";
const STOP_FILE = "/tmp/jarvis-orchestrator-stop";

// === AbortController for /stop ===
const abortController = new AbortController();

// === SIGTERM handler ===
process.on("SIGTERM", () => {
  console.log("[Orchestrator] SIGTERM received, aborting...");
  abortController.abort();
});

process.on("SIGINT", () => {
  console.log("[Orchestrator] SIGINT received, aborting...");
  abortController.abort();
});

/**
 * Load .env file manually (standalone script, no dotenv)
 */
async function loadEnv(): Promise<void> {
  const envPath = join(MAIN_REPO, ".env");
  if (!existsSync(envPath)) return;
  const content = await readFile(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

/**
 * Mask secrets in text (env var values > 8 chars)
 */
const SECRET_KEYS = [
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN", "MEMORY_GATEWAY_URL",
];

function maskSecrets(text: string): string {
  if (!text) return text;
  for (const key of SECRET_KEYS) {
    const val = process.env[key];
    if (val && val.length > 8) {
      text = text.replaceAll(val, `[${key}:***]`);
    }
  }
  return text;
}

/**
 * Create git worktree for isolated execution
 */
async function createWorktree(planId: string): Promise<{ path: string; baseCommit: string }> {
  const worktreePath = join(WORKTREE_BASE, planId);
  // Clean up any stale worktree (previous run, crash, etc.)
  try {
    await execAsync(`git worktree remove --force "${worktreePath}" 2>/dev/null; rm -rf "${worktreePath}"; git worktree prune`, {
      cwd: MAIN_REPO,
      timeout: 10_000,
    });
  } catch {}

  await mkdir(WORKTREE_BASE, { recursive: true });

  // Create worktree from current branch
  await execAsync(`git worktree add "${worktreePath}" HEAD`, {
    cwd: MAIN_REPO,
    timeout: 30_000,
  });

  // Symlink node_modules from main repo (worktree doesn't include .gitignored dirs)
  const nmMain = join(MAIN_REPO, "node_modules");
  const nmWorktree = join(worktreePath, "node_modules");
  try {
    await execAsync(`ln -s "${nmMain}" "${nmWorktree}"`, { timeout: 5_000 });
    console.log(`[Orchestrator] node_modules symlinked`);
  } catch {}

  // Record base commit for validator (Claude CLI may auto-commit)
  let baseCommit = "";
  try {
    const { stdout } = await execAsync("git rev-parse HEAD", { cwd: worktreePath });
    baseCommit = stdout.trim();
    console.log(`[Orchestrator] Base commit: ${baseCommit.slice(0, 8)}`);
  } catch {}

  console.log(`[Orchestrator] Worktree created: ${worktreePath}`);
  return { path: worktreePath, baseCommit };
}

/**
 * Git commit in worktree
 */
async function gitCommit(worktreePath: string, taskId: string, goal: string): Promise<void> {
  try {
    await execAsync("git add -A", { cwd: worktreePath, timeout: 10_000 });
    await execAsync(
      `git commit -m "task(${taskId}): ${goal}" --no-verify`,
      { cwd: worktreePath, timeout: 10_000 },
    );
  } catch (err) {
    console.error(`[Orchestrator] Git commit failed:`, err);
  }
}

/**
 * Generate changes summary for next task context
 */
async function generateChangesSummary(
  worktreePath: string,
): Promise<string> {
  try {
    const { stdout: statOut } = await execAsync("git diff HEAD~1 --stat", {
      cwd: worktreePath,
      timeout: 10_000,
    });
    const { stdout: diff } = await execAsync("git diff HEAD~1 --no-color", {
      cwd: worktreePath,
      timeout: 10_000,
    });
    // Keep summary short for context injection
    return `変更概要:\n${statOut.trim()}\n\n主な変更:\n${diff.slice(0, 3000)}`;
  } catch {
    return "(変更サマリー生成失敗)";
  }
}

/**
 * Check if /stop was requested
 */
function isStopRequested(): boolean {
  return abortController.signal.aborted || existsSync(STOP_FILE);
}

/**
 * Clean worktrees older than maxAgeMs
 */
async function cleanOldWorktrees(basePath: string, maxAgeMs: number): Promise<void> {
  try {
    if (!existsSync(basePath)) return;
    const entries = await readdir(basePath);
    const now = Date.now();
    for (const entry of entries) {
      const fullPath = join(basePath, entry);
      try {
        const statResult = await stat(fullPath);
        if (statResult.isDirectory() && (now - statResult.mtimeMs) > maxAgeMs) {
          console.log(`[Orchestrator] Removing stale worktree: ${entry}`);
          try {
            await execAsync(`git worktree remove --force "${fullPath}" 2>/dev/null; rm -rf "${fullPath}"`, {
              cwd: MAIN_REPO, timeout: 10_000,
            });
          } catch {}
        }
      } catch {}
    }
  } catch (err) {
    console.error('[Orchestrator] Worktree cleanup error:', err);
  }
}

/**
 * Get git diff output for resource limits check
 */
async function getDiffOutput(worktreePath: string, baseCommit: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff ${baseCommit} --no-color`, {
      cwd: worktreePath, timeout: 10_000,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Main orchestration loop
 */
async function main(): Promise<void> {
  const startTime = Date.now();

  // Parse args
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("Usage: bun run src/task/orchestrate.ts <taskplan.json>");
    process.exit(1);
  }

  // Load env and init
  await loadEnv();
  initReporter();

  // === PID Exclusive Lock ===
  try {
    const existingPidStr = await readFile(PID_FILE, "utf-8");
    const existingPid = parseInt(existingPidStr.trim(), 10);
    if (existingPid) {
      try {
        process.kill(existingPid, 0); // throws if not alive
        console.error(`[Orchestrator] ABORT: Another instance running (PID ${existingPid})`);
        process.exit(1);
      } catch (e: any) {
        if (e.code !== "ESRCH") {
          console.error(`[Orchestrator] ABORT: PID check failed:`, e);
          process.exit(1);
        }
        console.log("[Orchestrator] Stale PID file found, cleaning up");
      }
    }
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      console.error(`[Orchestrator] ABORT: PID file read failed:`, e);
      process.exit(1);
    }
  }
  await writeFile(PID_FILE, String(process.pid));

  // Clean stop file from previous run
  try { await unlink(STOP_FILE); } catch {}

  // Worktree cleanup (Phase 2a)
  try {
    await execAsync("git worktree prune", { cwd: MAIN_REPO, timeout: 10_000 });
    await cleanOldWorktrees(WORKTREE_BASE, 24 * 60 * 60 * 1000); // 24h
    console.log("[Orchestrator] Worktree cleanup done");
  } catch (err) {
    console.warn("[Orchestrator] Worktree cleanup warning:", err);
  }

  // Read TaskPlan
  let plan: TaskPlan;
  try {
    plan = loadJsonFile<TaskPlan>(planPath);
  } catch (err) {
    console.error("[Orchestrator] Failed to read TaskPlan:", err);
    process.exit(1);
  }

  console.log(`[Orchestrator] Plan: ${plan.plan_id} | ${plan.title} | ${plan.micro_tasks.length} tasks`);

  // Health Check (Phase 2a)
  if (plan.on_failure === 'retry_then_stop') {
    console.log('[Orchestrator] Running health check...');
    const healthResult = runHealthCheck();
    if (!healthResult.passed) {
      console.error('[Orchestrator] Health check failed:', healthResult.errors);
      await notifyHealthCheckFailed(healthResult);
      throw new Error(`Health check failed: ${healthResult.errors.join(', ')}`);
    }
    console.log(`[Orchestrator] Health check passed: Claude ${healthResult.claudeVersion}`);
  }

  // === Docker Availability Check ===
  const dockerCheck = checkDockerAvailable();
  const validatorMode: ValidatorMode = dockerCheck.available ? 'docker' : 'host';
  if (dockerCheck.available) {
    console.log("[Orchestrator] Docker sandbox available - using Three-Tier Validator (Tier 3 skipped)");
  } else {
    console.log(`[Orchestrator] Docker unavailable (${dockerCheck.reason}) - using strict Host mode (all tiers active)`);
  }

  // === Run Logger ===
  const runLogger = new RunLogger(plan.plan_id);
  runLogger.logEvent("run_start", {
    plan_id: plan.plan_id,
    title: plan.title,
    task_count: plan.micro_tasks.length,
  });
  console.log(`[Orchestrator] RunID: ${runLogger.runId}`);

  await notifyOrchestratorStarted(plan, runLogger.runId);

  // Create worktree
  let worktreePath: string;
  let baseCommit = "";
  try {
    const wt = await createWorktree(plan.plan_id);
    worktreePath = wt.path;
    baseCommit = wt.baseCommit;
  } catch (err) {
    console.error("[Orchestrator] Worktree creation failed:", err);
    process.exit(1);
  }

  const mainRepoPath = resolve(MAIN_REPO);
  const results: TaskResult[] = [];
  let consecutiveFailures = 0;

  // === Main Loop ===
  for (let i = 0; i < plan.micro_tasks.length; i++) {
    const task = plan.micro_tasks[i];
    if (!task) continue;

    // Check /stop
    if (isStopRequested()) {
      console.log("[Orchestrator] Stop requested, aborting...");
      runLogger.logEvent("run_stopped", { reason: "/stop before task" });
      await notifyOrchestratorStopped(plan, runLogger.runId);
      break;
    }

    // Inject previous changes summary
    if (task.depends_on) {
      const prev = results.find((r) => r.task_id === task.depends_on);
      if (prev?.changes_summary) {
        task.previous_changes_summary = prev.changes_summary;
      }
    }

    console.log(`[Orchestrator] Task ${i + 1}/${plan.micro_tasks.length}: ${task.id} - ${task.goal}`);
    await notifyTaskStarted(plan, task, i, plan.micro_tasks.length, runLogger.runId);

    const taskStart = Date.now();
    runLogger.logEvent("task_start", {
      task_id: task.id,
      goal: task.goal,
      index: i,
      total: plan.micro_tasks.length,
    });

    // Execute
    const execResult = await executeMicroTask(
      task,
      worktreePath,
      abortController.signal,
    );

    console.log(`[Orchestrator] Exec done: exit=${execResult.exit_code} timeout=${execResult.timed_out}`);
    runLogger.logEvent("task_exec_done", {
      task_id: task.id,
      exit_code: execResult.exit_code,
      timed_out: execResult.timed_out,
      stdout_len: execResult.stdout.length,
      stderr_preview: maskSecrets(execResult.stderr.slice(0, 300)),
    });
    console.log(`[Orchestrator] STDOUT (last 1000): ${maskSecrets(execResult.stdout.slice(-1000))}`);
    if (execResult.stderr) {
      console.log(`[Orchestrator] STDERR: ${maskSecrets(execResult.stderr.slice(0, 500))}`);
    }

    // Build task result
    const taskResult: TaskResult = {
      task_id: task.id,
      status: "failed",
      validation: null,
      duration_seconds: (Date.now() - taskStart) / 1000,
      exit_code: execResult.exit_code,
      changes_summary: "",
    };

    // Timeout → failed
    if (execResult.timed_out) {
      taskResult.status = "timeout";
      await rollback(worktreePath);
      consecutiveFailures++;
      runLogger.logEvent("task_rollback", { task_id: task.id, reason: "timeout" });
      await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
    } else if (isStopRequested()) {
      taskResult.status = "blocked";
      await rollback(worktreePath);
      runLogger.logEvent("run_stopped", { task_id: task.id, reason: "/stop" });
      await notifyOrchestratorStopped(plan, runLogger.runId);
      runLogger.logEvent("task_done", {
      task_id: task.id,
      status: taskResult.status,
      duration_seconds: taskResult.duration_seconds,
      exit_code: taskResult.exit_code,
    });
    results.push(taskResult);
      break;
    } else {
      // Validate
      let validation = await validate(task, plan, worktreePath, mainRepoPath, baseCommit, validatorMode);
      taskResult.validation = validation;

      console.log(`[Orchestrator] Validation: passed=${validation.passed} files=${validation.changed_files.length} violations=${validation.violations.join('; ')}`);
      runLogger.logEvent("task_validation", {
        task_id: task.id,
        passed: validation.passed,
        changed_files: validation.changed_files,
        violations: validation.violations,
      });

      // Resource limits check (Phase 2a)
      if (validation.passed) {
        const limits = plan.resource_limits ?? DEFAULT_RESOURCE_LIMITS;
        const diffOutput = await getDiffOutput(worktreePath, baseCommit);
        const resourceChecks = checkAllLimits({
          changedFiles: validation.changed_files,
          diffOutput,
          startTime: taskStart,
          limits,
        });
        const resourceFailed = resourceChecks.find(r => !r.passed);
        if (resourceFailed) {
          const violation = `リソース上限超過: ${resourceFailed.check} (${resourceFailed.actual}/${resourceFailed.limit})`;
          validation = {
            ...validation,
            passed: false,
            violations: [...validation.violations, violation],
          };
          taskResult.validation = validation;
          console.log(`[Orchestrator] Resource limit exceeded: ${violation}`);
          runLogger.logEvent("resource_limit_exceeded", {
            task_id: task.id,
            check: resourceFailed.check,
            actual: resourceFailed.actual,
            limit: resourceFailed.limit,
          });
        }
      }

      if (validation.passed) {
        taskResult.status = "success";
        await gitCommit(worktreePath, task.id, task.goal);
        // Update baseCommit so next task's diff is per-task, not cumulative
        baseCommit = (await execAsync("git rev-parse HEAD", { cwd: worktreePath })).stdout.trim();
        taskResult.changes_summary = await generateChangesSummary(worktreePath);
        consecutiveFailures = 0;
        runLogger.logEvent("task_committed", {
          task_id: task.id,
          changed_files: validation.changed_files,
        });
        await notifyTaskPassed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
      } else if (plan.on_failure === "retry_then_stop") {
        // Phase 2a: 1回リトライ
        const failureReason = summarizeFailureReason("failed", validation.violations, execResult.exit_code);
        console.log(`[Orchestrator] Retrying: ${failureReason}`);
        runLogger.logEvent("task_retry_start", {
          task_id: task.id,
          failure_reason: failureReason,
        });

        await rollback(worktreePath);

        const retryPrompt = buildRetryPrompt(
          task.prompt,
          failureReason,
          validation.violations,
          validation.test_output,
        );
        const retryTask = { ...task, prompt: retryPrompt };

        const retryExecResult = await executeMicroTask(retryTask, worktreePath, abortController.signal);

        if (!retryExecResult.timed_out && !isStopRequested()) {
          let retryValidation = await validate(retryTask, plan, worktreePath, mainRepoPath, baseCommit, validatorMode);

          // Resource limits on retry too
          if (retryValidation.passed) {
            const limits = plan.resource_limits ?? DEFAULT_RESOURCE_LIMITS;
            const retryDiff = await getDiffOutput(worktreePath, baseCommit);
            const retryResourceChecks = checkAllLimits({
              changedFiles: retryValidation.changed_files,
              diffOutput: retryDiff,
              startTime: taskStart,
              limits,
            });
            const retryResourceFailed = retryResourceChecks.find(r => !r.passed);
            if (retryResourceFailed) {
              retryValidation = {
                ...retryValidation,
                passed: false,
                violations: [...retryValidation.violations, `リソース上限超過: ${retryResourceFailed.check} (${retryResourceFailed.actual}/${retryResourceFailed.limit})`],
              };
            }
          }

          if (retryValidation.passed) {
            taskResult.status = "success";
            taskResult.validation = retryValidation;
            await gitCommit(worktreePath, task.id, task.goal);
            // Update baseCommit so next task's diff is per-task, not cumulative
            baseCommit = (await execAsync("git rev-parse HEAD", { cwd: worktreePath })).stdout.trim();
            taskResult.changes_summary = await generateChangesSummary(worktreePath);
            consecutiveFailures = 0;
            runLogger.logEvent("task_retry_success", { task_id: task.id });
            await notifyTaskPassed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
          } else {
            taskResult.status = "failed";
            taskResult.validation = retryValidation;
            await rollback(worktreePath);
            consecutiveFailures++;
            runLogger.logEvent("task_retry_failed", {
              task_id: task.id,
              violations: retryValidation.violations,
            });
            await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
          }
        } else {
          taskResult.status = retryExecResult.timed_out ? "timeout" : "blocked";
          await rollback(worktreePath);
          consecutiveFailures++;
          runLogger.logEvent("task_retry_failed", {
            task_id: task.id,
            reason: retryExecResult.timed_out ? "timeout" : "stopped",
          });
          await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
        }
      } else {
        // Phase 1: 即停止
        taskResult.status = "failed";
        consecutiveFailures++;
        runLogger.logEvent("task_rollback", {
          task_id: task.id,
          reason: "validation_failed",
          violations: validation.violations,
        });
        await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length, runLogger.runId);
      }
    }

    runLogger.logEvent("task_done", {
      task_id: task.id,
      status: taskResult.status,
      duration_seconds: taskResult.duration_seconds,
      exit_code: taskResult.exit_code,
    });
    results.push(taskResult);

    // Stop conditions
    if (consecutiveFailures >= 2) {
      console.log("[Orchestrator] 2 consecutive failures, stopping.");
      runLogger.logEvent("consecutive_failure_stop", {
        task_id: task.id,
        consecutive_failures: consecutiveFailures,
      });
      break;
    }
    if (plan.on_failure === "stop" && taskResult.status !== "success") {
      console.log("[Orchestrator] on_failure=stop, halting after failure.");
      break;
    }
  }

  // === Completion Report ===
  const passed = results.filter((r) => r.status === "success").length;
  const report: CompletionReport = {
    plan_id: plan.plan_id,
    run_id: runLogger.runId,
    title: plan.title,
    results,
    total_duration_seconds: (Date.now() - startTime) / 1000,
    final_status:
      passed === plan.micro_tasks.length ? "all_passed" :
      passed > 0 ? "partial" : "failed",
  };

  // Write persistent log summary
  runLogger.logEvent("run_complete", {
    final_status: report.final_status,
    passed,
    total: plan.micro_tasks.length,
    duration_seconds: report.total_duration_seconds,
  });
  runLogger.writeSummary({
    plan_id: plan.plan_id,
    title: plan.title,
    final_status: report.final_status,
    total_tasks: plan.micro_tasks.length,
    passed_tasks: passed,
    failed_tasks: plan.micro_tasks.length - passed,
    total_duration_seconds: report.total_duration_seconds,
    task_results: results.map((r) => ({
      task_id: r.task_id,
      status: r.status,
      duration_seconds: r.duration_seconds,
      exit_code: r.exit_code,
      violations: r.validation?.violations || [],
      changed_files: r.validation?.changed_files || [],
    })),
  });

  await sendCompletionReport(report);

  // Log summary
  console.log(`[Orchestrator] Done: ${report.final_status} | ${passed}/${plan.micro_tasks.length} passed | ${Math.round(report.total_duration_seconds)}s | RunID: ${runLogger.runId}`);
  console.log(`[Orchestrator] Worktree preserved: ${worktreePath}`);
  console.log(`[Orchestrator] To merge: cd ${MAIN_REPO} && git merge --ff-only $(cd ${worktreePath} && git rev-parse HEAD)`);

  // Cleanup PID file
  try { await unlink(PID_FILE); } catch {}
}

main().catch(async (err) => {
  console.error("[Orchestrator] Fatal:", err);
  try { await unlink(PID_FILE); } catch {}
  process.exit(1);
});
