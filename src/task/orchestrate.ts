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

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
} from "./reporter";

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
function loadEnv(): void {
  const envPath = join(MAIN_REPO, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
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
function createWorktree(planId: string): string {
  const worktreePath = join(WORKTREE_BASE, planId);
  // Clean up any stale worktree (previous run, crash, etc.)
  try {
    execSync(`git worktree remove --force "${worktreePath}" 2>/dev/null; rm -rf "${worktreePath}"; git worktree prune`, {
      cwd: MAIN_REPO,
      timeout: 10_000,
    });
  } catch {}

  mkdirSync(WORKTREE_BASE, { recursive: true });

  // Create worktree from current branch
  execSync(`git worktree add "${worktreePath}" HEAD`, {
    cwd: MAIN_REPO,
    timeout: 30_000,
  });

  // Symlink node_modules from main repo (worktree doesn't include .gitignored dirs)
  const nmMain = join(MAIN_REPO, "node_modules");
  const nmWorktree = join(worktreePath, "node_modules");
  try {
    execSync(`ln -s "${nmMain}" "${nmWorktree}"`, { timeout: 5_000 });
    console.log(`[Orchestrator] node_modules symlinked`);
  } catch {}

  // Record base commit for validator (Claude CLI may auto-commit)
  let baseCommit = "";
  try {
    baseCommit = execSync("git rev-parse HEAD", { cwd: worktreePath, encoding: "utf-8", timeout: 5_000 }).trim();
    console.log(`[Orchestrator] Base commit: ${baseCommit.slice(0, 8)}`);
  } catch {}

  console.log(`[Orchestrator] Worktree created: ${worktreePath}`);
  return { path: worktreePath, baseCommit };
}

/**
 * Git commit in worktree
 */
function gitCommit(worktreePath: string, taskId: string, goal: string): void {
  try {
    execSync("git add -A", { cwd: worktreePath, timeout: 10_000 });
    execSync(
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
function generateChangesSummary(
  worktreePath: string,
): string {
  try {
    const stat = execSync("git diff HEAD~1 --stat", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    const diff = execSync("git diff HEAD~1 --no-color", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    // Keep summary short for context injection
    return `変更概要:\n${stat.trim()}\n\n主な変更:\n${diff.slice(0, 3000)}`;
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
  loadEnv();
  initReporter();

  // === PID Exclusive Lock ===
  if (existsSync(PID_FILE)) {
    try {
      const existingPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (existingPid) {
        process.kill(existingPid, 0); // throws if not alive
        console.error(`[Orchestrator] ABORT: Another instance running (PID ${existingPid})`);
        process.exit(1);
      }
    } catch (e: any) {
      if (e.code !== "ESRCH") {
        // ESRCH = process not found = stale PID, safe to continue
        console.error(`[Orchestrator] ABORT: PID check failed:`, e);
        process.exit(1);
      }
      console.log("[Orchestrator] Stale PID file found, cleaning up");
    }
  }
  writeFileSync(PID_FILE, String(process.pid));

  // Clean stop file from previous run
  if (existsSync(STOP_FILE)) {
    try { execSync(`rm -f "${STOP_FILE}"`); } catch {}
  }

  // Read TaskPlan
  let plan: TaskPlan;
  try {
    plan = JSON.parse(readFileSync(planPath, "utf-8"));
  } catch (err) {
    console.error("[Orchestrator] Failed to read TaskPlan:", err);
    process.exit(1);
  }

  console.log(`[Orchestrator] Plan: ${plan.plan_id} | ${plan.title} | ${plan.micro_tasks.length} tasks`);
  await notifyOrchestratorStarted(plan);

  // Create worktree
  let worktreePath: string;
  let baseCommit = "";
  try {
    const wt = createWorktree(plan.plan_id);
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

    // Check /stop
    if (isStopRequested()) {
      console.log("[Orchestrator] Stop requested, aborting...");
      await notifyOrchestratorStopped(plan);
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
    await notifyTaskStarted(plan, task, i, plan.micro_tasks.length);

    const taskStart = Date.now();

    // Execute
    const execResult = await executeMicroTask(
      task,
      worktreePath,
      abortController.signal,
    );

    console.log(`[Orchestrator] Exec done: exit=${execResult.exit_code} timeout=${execResult.timed_out}`);
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
      rollback(worktreePath);
      consecutiveFailures++;
      await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length);
    } else if (isStopRequested()) {
      taskResult.status = "blocked";
      rollback(worktreePath);
      await notifyOrchestratorStopped(plan);
      results.push(taskResult);
      break;
    } else {
      // Validate
      const validation = validate(task, plan, worktreePath, mainRepoPath, baseCommit);
      taskResult.validation = validation;

      console.log(`[Orchestrator] Validation: passed=${validation.passed} files=${validation.changed_files.length} violations=${validation.violations.join('; ')}`);
      if (validation.passed) {
        taskResult.status = "success";
        gitCommit(worktreePath, task.id, task.goal);
        taskResult.changes_summary = generateChangesSummary(worktreePath);
        consecutiveFailures = 0;
        await notifyTaskPassed(task, taskResult, i, plan.micro_tasks.length);
      } else {
        taskResult.status = "failed";
        consecutiveFailures++;
        await notifyTaskFailed(task, taskResult, i, plan.micro_tasks.length);
      }
    }

    results.push(taskResult);

    // Stop conditions
    if (consecutiveFailures >= 2) {
      console.log("[Orchestrator] 2 consecutive failures, stopping.");
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
    title: plan.title,
    results,
    total_duration_seconds: (Date.now() - startTime) / 1000,
    final_status:
      passed === plan.micro_tasks.length ? "all_passed" :
      passed > 0 ? "partial" : "failed",
  };

  await sendCompletionReport(report);

  // Log summary
  console.log(`[Orchestrator] Done: ${report.final_status} | ${passed}/${plan.micro_tasks.length} passed | ${Math.round(report.total_duration_seconds)}s`);
  console.log(`[Orchestrator] Worktree preserved: ${worktreePath}`);
  console.log(`[Orchestrator] To merge: cd ${MAIN_REPO} && git merge --ff-only $(cd ${worktreePath} && git rev-parse HEAD)`);

  // Cleanup PID file
  try { execSync(`rm -f "${PID_FILE}"`); } catch {}
}

main().catch((err) => {
  console.error("[Orchestrator] Fatal:", err);
  try { execSync(`rm -f "${PID_FILE}"`); } catch {}
  process.exit(1);
});
