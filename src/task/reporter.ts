/**
 * Jarvis Task Orchestrator - Reporter
 *
 * Sends progress and completion notifications directly to Telegram API.
 * No Grammy dependency (runs as standalone script).
 */

import type {
  MicroTask,
  TaskPlan,
  TaskResult,
  CompletionReport,
} from "./types";

let BOT_TOKEN = "";
let CHAT_ID = "";

/**
 * Initialize reporter with env vars
 */
export function initReporter(): void {
  BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
  CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("[Reporter] WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS not set");
  }
}

/**
 * Mask secrets in text
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
      text = text.replaceAll(val, `[***]`);
    }
  }
  return text;
}

const TELEGRAM_MAX = 4000;

/**
 * Send message to Telegram (with secret masking + long message splitting)
 */
async function send(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  text = maskSecrets(text);

  // If short enough, send directly
  if (text.length <= TELEGRAM_MAX) {
    await sendRaw(text);
    return;
  }

  // Long message: head + tail + truncation notice
  const HEAD = 1800;
  const TAIL = 1600;
  const truncated =
    text.slice(0, HEAD) +
    "\n\n⚠️ <i>...中略 (全文: /tmp/jarvis-orchestrator.log)...</i>\n\n" +
    text.slice(-TAIL);
  await sendRaw(truncated.slice(0, TELEGRAM_MAX));
}

async function sendRaw(text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("[Reporter] Send failed:", err);
  }
}

/**
 * Notify task started
 */
export async function notifyTaskStarted(
  plan: TaskPlan,
  task: MicroTask,
  index: number,
  total: number,
): Promise<void> {
  await send(
    `🔄 <b>MicroTask ${index + 1}/${total}:</b> ${escHtml(task.goal)} — 開始\n` +
    `📋 Plan: ${escHtml(plan.title)}`,
  );
}

/**
 * Notify task completed (success)
 */
export async function notifyTaskPassed(
  task: MicroTask,
  result: TaskResult,
  index: number,
  total: number,
): Promise<void> {
  const files = result.validation?.changed_files.length ?? 0;
  const dur = Math.round(result.duration_seconds);
  await send(
    `✅ <b>MicroTask ${index + 1}/${total}:</b> ${escHtml(task.goal)}\n` +
    `📝 ${files}ファイル変更 | ⏱️ ${dur}秒`,
  );
}

/**
 * Notify task failed
 */
export async function notifyTaskFailed(
  task: MicroTask,
  result: TaskResult,
  index: number,
  total: number,
): Promise<void> {
  const violations = result.validation?.violations.slice(0, 3).join("\n• ") || "unknown";
  await send(
    `❌ <b>MicroTask ${index + 1}/${total}:</b> ${escHtml(task.goal)}\n` +
    `⚠️ ${escHtml(result.status)}\n• ${escHtml(violations)}\n` +
    `↩️ 自動rollback済み`,
  );
}

/**
 * Send final Completion Report
 */
export async function sendCompletionReport(
  report: CompletionReport,
): Promise<void> {
  const statusEmoji =
    report.final_status === "all_passed" ? "✅" :
    report.final_status === "partial" ? "⚠️" : "❌";

  const passed = report.results.filter((r) => r.status === "success").length;
  const total = report.results.length;
  const dur = Math.round(report.total_duration_seconds);

  let msg =
    `📋 <b>Task ${statusEmoji}: ${escHtml(report.title)}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📊 結果: ${passed}/${total} MicroTask成功\n` +
    `⏱️ 所要時間: ${dur}秒\n`;

  // File changes summary
  const allFiles = new Set<string>();
  for (const r of report.results) {
    if (r.validation) {
      for (const f of r.validation.changed_files) allFiles.add(f);
    }
  }
  if (allFiles.size > 0) {
    msg += `🔧 変更ファイル:\n`;
    for (const f of allFiles) {
      msg += `  • ${escHtml(f)}\n`;
    }
  }

  // Failures
  const failures = report.results.filter((r) => r.status !== "success");
  if (failures.length > 0) {
    msg += `\n⚠️ 失敗:\n`;
    for (const f of failures) {
      const v = f.validation?.violations[0] || f.status;
      msg += `  • ${f.task_id}: ${escHtml(v)}\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━`;

  await send(msg);
}

/**
 * Notify orchestrator started
 */
export async function notifyOrchestratorStarted(plan: TaskPlan): Promise<void> {
  await send(
    `🚀 <b>Task Orchestrator開始</b>\n` +
    `📋 ${escHtml(plan.title)}\n` +
    `📦 ${plan.micro_tasks.length}個のMicroTask\n` +
    `⏱️ 各タスク最大${plan.micro_tasks[0]?.max_time_seconds || 900}秒`,
  );
}

/**
 * Notify orchestrator stopped by /stop
 */
export async function notifyOrchestratorStopped(plan: TaskPlan): Promise<void> {
  await send(`🛑 <b>Task Orchestrator停止</b> (/stop)\n📋 ${escHtml(plan.title)}`);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
