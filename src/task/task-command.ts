/**
 * Jarvis Task Orchestrator - Telegram Command Handlers
 *
 * /task <json_path_or_inline> — Start orchestrator with TaskPlan
 * /stop — Kill running orchestrator (process group kill)
 * /taskstatus — Check orchestrator status
 */

import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../utils/config-loader";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Context } from "grammy";

const execAsync = promisify(exec);

const PID_FILE = "/tmp/jarvis-orchestrator.pid";
const STOP_FILE = "/tmp/jarvis-orchestrator-stop";
const BUN_PATH = `${process.env.HOME}/.bun/bin/bun`;
const TASK_DIR = `${process.env.HOME}/claude-telegram-bot/src/task`;

/**
 * /task handler
 *
 * Usage:
 *   /task /tmp/taskplan.json          — Run from file
 *   /task                             — Show usage
 */
export async function handleTaskCommand(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").trim();
  const args = text.replace(/^\/task\s*/, "").trim();

  if (!args) {
    await ctx.reply(
      "📋 <b>Task Orchestrator</b>\n\n" +
      "使い方: <code>/task /tmp/taskplan.json</code>\n\n" +
      "TaskPlan JSONをクロッピーが生成 → exec bridgeでM1に書込み → /task で実行",
      { parse_mode: "HTML" },
    );
    return;
  }

  // Check if orchestrator is already running
  if (isOrchestratorRunning()) {
    await ctx.reply("⚠️ Orchestratorが既に実行中です。/stop で停止してから再実行してください。");
    return;
  }

  // Validate JSON path
  const planPath = args;
  if (!existsSync(planPath)) {
    await ctx.reply(`❌ ファイルが見つかりません: ${planPath}`);
    return;
  }

  // Validate JSON content
  try {
    const plan = loadConfig<{ micro_tasks?: unknown[]; [key: string]: unknown }>(planPath);
    if (!plan.micro_tasks || !Array.isArray(plan.micro_tasks)) {
      await ctx.reply("❌ TaskPlan JSONにmicro_tasksがありません");
      return;
    }
    if (plan.micro_tasks.length === 0) {
      await ctx.reply("❌ micro_tasksが空です");
      return;
    }
  } catch (err) {
    await ctx.reply(`❌ JSON parse error: ${err}`);
    return;
  }

  // Launch orchestrator (detached, background)
  await ctx.reply("🚀 Task Orchestrator起動中...");

  try {
    const cmd =
      `cd ${process.env.HOME}/claude-telegram-bot && ` +
      `nohup caffeinate -i -s ${BUN_PATH} run ${TASK_DIR}/orchestrate.ts "${planPath}" ` +
      `>> /tmp/jarvis-orchestrator.log 2>&1 &`;

    await execAsync(cmd, { timeout: 5000 });
    await ctx.reply("✅ Orchestrator起動完了。進捗はTelegramに通知されます。");
  } catch (err) {
    await ctx.reply(`❌ 起動失敗: ${err}`);
  }
}

/**
 * /stop handler — Kill running orchestrator
 */
export async function handleStopCommand(ctx: Context): Promise<void> {
  if (!isOrchestratorRunning()) {
    await ctx.reply("ℹ️ Orchestratorは実行中ではありません。");
    return;
  }

  // Create stop file (orchestrator checks this)
  try {
    await execAsync(`touch "${STOP_FILE}"`);
  } catch {}

  // Also send SIGTERM to orchestrator process (positive PID, not group)
  // orchestrate.ts SIGTERM handler → abortController → kills Claude CLI group
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (pid) {
      process.kill(pid, "SIGTERM");  // Positive PID: orchestrator only
      await ctx.reply(`🛑 Orchestrator停止中... (PID: ${pid})`);
    }
  } catch {
    // PID file might be stale
    await ctx.reply("🛑 停止シグナル送信済み。");
  }
}

/**
 * /taskstatus handler — Check orchestrator status
 */
export async function handleTaskStatusCommand(ctx: Context): Promise<void> {
  if (!isOrchestratorRunning()) {
    await ctx.reply("ℹ️ Orchestratorは実行中ではありません。");
    return;
  }

  try {
    const pid = readFileSync(PID_FILE, "utf-8").trim();
    const logTail = await getLogTail();
    await ctx.reply(
      `📊 <b>Orchestrator Status</b>\n` +
      `PID: ${pid}\n\n` +
      `最新ログ:\n<code>${escHtml(logTail)}</code>`,
      { parse_mode: "HTML" },
    );
  } catch {
    await ctx.reply("⚠️ ステータス取得失敗");
  }
}

/**
 * Check if orchestrator PID is alive
 */
function isOrchestratorRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0); // signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}

/**
 * Get last 10 lines of orchestrator log
 */
async function getLogTail(): Promise<string> {
  try {
    const { stdout } = await execAsync("tail -10 /tmp/jarvis-orchestrator.log", {
      timeout: 3000,
    });
    return stdout.slice(0, 2000);
  } catch {
    return "(ログなし)";
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
