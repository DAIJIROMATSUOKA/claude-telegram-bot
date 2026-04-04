/**
 * Command handlers for Claude Telegram Bot.
 *
 * /start, /new, /stop, /status, /resume, /restart
 */

import type { Context } from "grammy";
import { Keyboard } from "grammy";
import { session } from "../session";
import { WORKING_DIR, ALLOWED_USERS, RESTART_FILE } from "../config";
import { isAuthorized } from "../security";
import { getChatHistory } from "../utils/chat-history";
import { saveSessionSummary } from "../utils/session-summary";
import { callMemoryGateway } from "./ai-router";
import { escapeHtml } from "../formatting";
import { exec, execSync } from "child_process";
import { notifyError } from "../utils/error-notify";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";

const execAsync = promisify(exec);
import { join } from "path";

// Task tracker file (shared with tower-renderer for pin display)
const TASK_TRACKER_PATH = join(homedir(), ".task-tracker.json");

function readTaskTracker(): Record<string, string> {
  try {
    if (!existsSync(TASK_TRACKER_PATH)) return {};
    return JSON.parse(readFileSync(TASK_TRACKER_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeTaskTracker(data: Record<string, string>): void {
  writeFileSync(TASK_TRACKER_PATH, JSON.stringify(data, null, 2));
}

// Project root directory (resolve from this file's location, not WORKING_DIR)
const PROJECT_ROOT = join(import.meta.dir, "..", "..");
import {
  enableFocusMode,
  disableFocusMode,
  deliverBufferedNotifications,
  isFocusModeEnabled,
} from "../utils/focus-mode";
import { formatMetricsForStatus } from "../utils/metrics";
import { getUptime } from "../utils/uptime";
import { memoryGatewayBreaker, geminiBreaker } from "../utils/circuit-breaker";
import { getBgTaskSummary } from "../utils/bg-task-manager";
import { updateTower } from "../utils/tower-manager";
import type { TowerIdentifier } from "../types/control-tower";

/**
 * /start - Show welcome message and status.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  const status = session.isActive ? "Active session" : "No active session";
  const workDir = WORKING_DIR;

  const keyboard = new Keyboard()
    .text("/ai").text("/imagine").row()
    .text("/debate").text("/status")
    .resized().persistent();

  await ctx.reply(
    `🤖 <b>Claude Telegram Bot</b>\n\n` +
      `Status: ${status}\n` +
      `Working directory: <code>${workDir}</code>\n\n` +
      `<b>Commands:</b>\n` +
      `/new - Start fresh session\n` +
      `/stop - Stop current query\n` +
      `/status - Show detailed status\n` +
      `/resume - Resume last session\n` +
      `/retry - Retry last message\n` +
      `/restart - Restart the bot\n\n` +
      `<b>Tips:</b>\n` +
      `• Prefix with <code>!</code> to interrupt current query\n` +
      `• Use "think" keyword for extended reasoning\n` +
      `• Send photos, voice, or documents`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

/**
 * /new - Start a fresh session.
 * セッション終了前にGeminiで会話要約を生成・保存。
 */
export async function handleNew(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Stop any running query
  if (session.isRunning) {
    const result = await session.stop();
    if (result) {
      await Bun.sleep(100);
      session.clearStopRequested();
    }
  }

  // セッション終了前に会話要約を生成・保存（非同期、ブロックしない）
  if (session.isActive && userId) {
    const sessionId = session.sessionId || 'unknown';
    // バックグラウンドで要約保存（ユーザーを待たせない）
    getChatHistory(userId, 50).then(async (history) => {
      if (history.length >= 3) {
        await saveSessionSummary(userId, sessionId, history);
        console.log('[/new] Session summary saved in background');
      }
    }).catch((err) => {
      console.error('[/new] Failed to save session summary:', err);
    });
  }

  // Clear session
  await session.kill();

  await ctx.reply("🆕 Session cleared. Next message starts fresh.");
}

/**
 * /stop - Stop the current query (silently).
 */
export async function handleStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  if (session.isRunning) {
    const result = await session.stop();
    if (result) {
      // Wait for the abort to be processed, then clear stopRequested so next message can proceed
      await Bun.sleep(100);
      session.clearStopRequested();
    }
    // Silent stop - no message shown
  }
  // If nothing running, also stay silent
}

/**
 * /status - Show detailed status.
 */
export async function handleStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const lines: string[] = ["📊 <b>Bot Status</b>\n"];

  // Uptime
  lines.push(`⏳ Uptime: ${getUptime()}`);

  // Session status
  if (session.isActive) {
    lines.push(`✅ Session: Active (${session.sessionId?.slice(0, 8)}...)`);
  } else {
    lines.push("⚪ Session: None");
  }

  // Query status
  if (session.isRunning) {
    const elapsed = session.queryStarted
      ? Math.floor((Date.now() - session.queryStarted.getTime()) / 1000)
      : 0;
    lines.push(`🔄 Query: Running (${elapsed}s)`);
    if (session.currentTool) {
      lines.push(`   └─ ${session.currentTool}`);
    }
  } else {
    lines.push("⚪ Query: Idle");
    if (session.lastTool) {
      lines.push(`   └─ Last: ${session.lastTool}`);
    }
  }

  // Last activity
  if (session.lastActivity) {
    const ago = Math.floor(
      (Date.now() - session.lastActivity.getTime()) / 1000
    );
    lines.push(`\n⏱️ Last activity: ${ago}s ago`);
  }

  // Usage stats
  if (session.lastUsage) {
    const usage = session.lastUsage;
    lines.push(
      `\n📈 Last query usage:`,
      `   Input: ${usage.input_tokens?.toLocaleString() || "?"} tokens`,
      `   Output: ${usage.output_tokens?.toLocaleString() || "?"} tokens`
    );
    if (usage.cache_read_input_tokens) {
      lines.push(
        `   Cache read: ${usage.cache_read_input_tokens.toLocaleString()}`
      );
    }
  }

  // Error status
  if (session.lastError) {
    const ago = session.lastErrorTime
      ? Math.floor((Date.now() - session.lastErrorTime.getTime()) / 1000)
      : "?";
    lines.push(`\n⚠️ Last error (${ago}s ago):`, `   ${session.lastError}`);
  }

  // Working directory
  lines.push(`\n📁 Working dir: <code>${WORKING_DIR}</code>`);

  // Circuit Breaker status
  const mgStatus = memoryGatewayBreaker.getStatus();
  const gmStatus = geminiBreaker.getStatus();
  lines.push(`\n🔌 Circuit Breakers:`);
  lines.push(`   MemoryGW: ${mgStatus.state} (成功率${mgStatus.successRate}%)`);
  lines.push(`   Gemini: ${gmStatus.state} (成功率${gmStatus.successRate}%)`);

  // Background task summary
  const bgSummary = getBgTaskSummary();
  if (bgSummary.total > 0) {
    lines.push(`\n⚙️ BG Tasks: ${bgSummary.successes}/${bgSummary.total} OK`);
    if (bgSummary.recentFailures.length > 0) {
      for (const f of bgSummary.recentFailures.slice(-3)) {
        lines.push(`   ❌ ${f.name}: ${f.error?.slice(0, 60)}`);
      }
    }
  }

  // Performance metrics
  lines.push(`\n${formatMetricsForStatus(1)}`);

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

// Bot start timestamp for uptime calculation
const BOT_START_TIME = Date.now();

// Simple message counter
let messageCount = 0;
/** Increment the global message counter for /stats. */
export function incrementMessageCount(): void {
  messageCount++;
}

/**
 * /stats - Show bot statistics (message count, uptime).
 */
export async function handleStats(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const uptimeMs = Date.now() - BOT_START_TIME;
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;

  const sessionStatus = session.isActive ? "Active" : "Inactive";
  const queryStatus = session.isRunning ? "Running" : "Idle";

  const lines: string[] = [
    "📊 <b>Bot Stats</b>\n",
    `💬 Messages processed: ${messageCount}`,
    `⏱️ Uptime: ${uptimeStr}`,
    `🔗 Session: ${sessionStatus}`,
    `⚙️ Query: ${queryStatus}`,
  ];

  if (session.lastUsage) {
    const totalInput = session.lastUsage.input_tokens || 0;
    const totalOutput = session.lastUsage.output_tokens || 0;
    lines.push(`\n📈 Last query tokens: ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

/**
 * /resume - Show list of sessions to resume with inline keyboard.
 */
export async function handleResume(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  if (session.isActive) {
    await ctx.reply("Sessione già attiva. Usa /new per iniziare da capo.");
    return;
  }

  // Get saved sessions
  const sessions = session.getSessionList();

  if (sessions.length === 0) {
    await ctx.reply("❌ Nessuna sessione salvata.");
    return;
  }

  // Build inline keyboard with session list
  const buttons = sessions.map((s) => {
    // Format date: "18/01 10:30"
    const date = new Date(s.saved_at);
    const dateStr = date.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
    });
    const timeStr = date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Truncate title for button (max ~40 chars to fit)
    const titlePreview =
      s.title.length > 35 ? s.title.slice(0, 32) + "..." : s.title;

    return [
      {
        text: `📅 ${dateStr} ${timeStr} - "${titlePreview}"`,
        callback_data: `resume:${s.session_id}`,
      },
    ];
  });

  await ctx.reply("📋 <b>Sessioni salvate</b>\n\nSeleziona una sessione da riprendere:", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

/**
 * /restart - Restart the bot process.
 */
export async function handleRestart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const msg = await ctx.reply("🔄 Restarting bot...");

  // Save message info so we can update it after restart
  if (chatId && msg.message_id) {
    try {
      await Bun.write(
        RESTART_FILE,
        JSON.stringify({
          chat_id: chatId,
          message_id: msg.message_id,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.warn("Failed to save restart info:", e);
    }
  }

  // Give time for the message to send
  await Bun.sleep(500);

  // Exit - launchd will restart us
  process.exit(0);
}

/**
 * /retry - Retry the last message (resume session and re-send).
 */
export async function handleRetry(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Check if there's a message to retry
  if (!session.lastMessage) {
    await ctx.reply("❌ No message to retry.");
    return;
  }

  // Check if something is already running
  if (session.isRunning) {
    await ctx.reply("⏳ A query is already running. Use /stop first.");
    return;
  }

  const message = session.lastMessage;
  await ctx.reply(`🔄 Retrying: "${message.slice(0, 50)}${message.length > 50 ? "..." : ""}"`);

  // Simulate sending the message again by emitting a fake text message event
  // We do this by directly calling the text handler logic
  const { handleText } = await import("./text");

  // Create a modified context with the last message
  const fakeCtx = {
    ...ctx,
    message: {
      ...ctx.message,
      text: message,
    },
  } as Context;

  await handleText(fakeCtx);
}

/**
 * /task_start - Start time tracking for a task.
 */
export async function handleTaskStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Extract task name from message (format: /task_start Task Name)
  const text = ctx.message?.text || "";
  const taskName = text.replace(/^\/task_start\s*/, "").trim() || "Unnamed Task";

  // Write to task-tracker.json (used by tower-renderer for pin display)
  const tracker = readTaskTracker();
  tracker[taskName] = new Date().toISOString();
  writeTaskTracker(tracker);

  // ピン更新
  try {
    const chatId = ctx.chat?.id;
    if (chatId) {
      const towerIdent: TowerIdentifier = { tenantId: 'telegram-bot', userId: String(userId), chatId: String(chatId) };
      await updateTower(ctx, towerIdent, { status: 'running', currentStep: taskName });
    }
  } catch (e) { console.debug('[Tower] update failed:', e); }

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" START "${taskName}"`, { encoding: "utf-8" });
  } catch (error: any) {
    console.error("[task_start] Timer sync failed (non-fatal):", error.message);
  }

  await ctx.reply(`⏱ タスク開始: ${taskName}`);
}

/**
 * /task_stop - Stop time tracking for a task.
 */
export async function handleTaskStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Extract task name from message (format: /task_stop Task Name)
  const text = ctx.message?.text || "";
  const taskName = text.replace(/^\/task_stop\s*/, "").trim() || "Unnamed Task";

  // Remove from task-tracker.json
  const trackerStop = readTaskTracker();
  delete trackerStop[taskName];
  writeTaskTracker(trackerStop);

  // ピン更新
  try {
    const chatId = ctx.chat?.id;
    if (chatId) {
      const towerIdent: TowerIdentifier = { tenantId: 'telegram-bot', userId: String(userId), chatId: String(chatId) };
      await updateTower(ctx, towerIdent, { status: 'idle' });
    }
  } catch (e) { console.debug('[Tower] update failed:', e); }

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" STOP "${taskName}"`, { encoding: "utf-8" });
  } catch (error: any) {
    console.error("[task_stop] Timer sync failed (non-fatal):", error.message);
  }

  await ctx.reply(`⏹ タスク停止: ${taskName}`);
}

/**
 * /task_pause - Pause time tracking for a task.
 */
export async function handleTaskPause(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Extract task name from message (format: /task_pause Task Name)
  const text = ctx.message?.text || "";
  const taskName = text.replace(/^\/task_pause\s*/, "").trim() || "Unnamed Task";

  // Remove from task-tracker.json (paused = not active)
  const trackerPause = readTaskTracker();
  delete trackerPause[taskName];
  writeTaskTracker(trackerPause);

  // ピン更新
  try {
    const chatId = ctx.chat?.id;
    if (chatId) {
      const towerIdent: TowerIdentifier = { tenantId: 'telegram-bot', userId: String(userId), chatId: String(chatId) };
      await updateTower(ctx, towerIdent, { status: 'idle' });
    }
  } catch (e) { console.debug('[Tower] update failed:', e); }

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" PAUSE "${taskName}"`, { encoding: "utf-8" });
  } catch (error: any) {
    console.error("[task_pause] Timer sync failed (non-fatal):", error.message);
  }

  await ctx.reply(`⏸ タスク一時停止: ${taskName}`);
}

/**
 * /todoist - Todoist task management
 * Usage:
 *   /todoist              → Show today's tasks
 *   /todoist add タスク名  → Add a new task (due today)
 *   /todoist done タスクID → Complete a task
 *   /todoist reschedule [YYYY-MM-DD] → Move all overdue tasks to date (default: +7 days)
 */
export async function handleTodoist(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  // Load API token from jarvis_config.json
  const os = await import("os");
  const fs = await import("fs");
  const configPath = join(os.homedir(), ".claude", "jarvis_config.json");

  let apiToken: string;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    apiToken = config.rules?.todoist?.api_token;
    if (!apiToken) throw new Error("Token not found");
  } catch {
    await ctx.reply("❌ Todoist APIトークンが見つからない (~/.claude/jarvis_config.json)");
    return;
  }

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/todoist\s*/, "").trim();
  const subcommand = args.split(/\s+/)[0]?.toLowerCase() || "";

  if (subcommand === "help" || subcommand === "?") {
    await ctx.reply(
      `<b>📋 /todoist コマンド一覧</b>\n\n` +
      `<b>タスク一覧（今日）:</b>\n` +
      `  /todoist\n\n` +
      `<b>タスク追加:</b>\n` +
      `  /todoist add 買い物に行く\n` +
      `  /todoist add 田中さんにメール送る\n` +
      `  /todoist add レポート提出 p1\n\n` +
      `<b>タスク完了:</b>\n` +
      `  /todoist done 1234567890\n` +
      `  (タスクIDは一覧表示で確認)\n\n` +
      `<b>期限切れリスケ:</b>\n` +
      `  /todoist reschedule          → 7日後に移動\n` +
      `  /todoist reschedule 2026-04-10 → 指定日に移動\n\n` +
      `<b>ヘルプ:</b>\n` +
      `  /todoist help`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (subcommand === "add") {
    // Add task
    const taskContent = args.replace(/^add\s+/, "").trim();
    if (!taskContent) {
      await ctx.reply("使い方: /todoist add タスク名");
      return;
    }

    try {
      const res = await fetch("https://api.todoist.com/api/v1/tasks", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: taskContent,
          due_datetime: (() => {
            const now = new Date();
            const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
            const y = jst.getUTCFullYear();
            const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
            const d = String(jst.getUTCDate()).padStart(2, "0");
            return `${y}-${mo}-${d}T23:59:00+09:00`;
          })(),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const task = await res.json() as { id: string; content: string };
      await ctx.reply(`✅ タスク追加: ${task.content}\nID: ${task.id}`);
    } catch (e: any) {
      await ctx.reply(`❌ タスク追加失敗: ${e.message}`);
    }

  } else if (subcommand === "done") {
    // Complete task
    const taskId = args.replace(/^done\s+/, "").trim();
    if (!taskId) {
      await ctx.reply("使い方: /todoist done タスクID");
      return;
    }

    try {
      const res = await fetch(`https://api.todoist.com/api/v1/tasks/${taskId}/close`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await ctx.reply(`✅ タスク完了 (ID: ${taskId})`);
    } catch (e: any) {
      await ctx.reply(`❌ タスク完了失敗: ${e.message}`);
    }

  } else if (subcommand === "reschedule") {
    // Reschedule all overdue tasks to a target date (default: 1 week from today)
    const dateArg = args.replace(/^reschedule\s*/, "").trim();
    let targetDate: string;
    let targetLabel: string;

    if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      targetDate = dateArg;
      targetLabel = dateArg;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      targetDate = d.toISOString().slice(0, 10);
      targetLabel = `${targetDate}` + "(\uFF0B1\u9031\u9593)";
    }

    await ctx.reply("\u23F3 Overdue \u30BF\u30B9\u30AF\u3092 " + targetLabel + " \u306B\u79FB\u52D5\u4E2D...");

    try {
      // Collect all overdue tasks with pagination
      const allTasks: Array<{ id: string; content: string; due?: { date?: string } }> = [];
      let cursor: string | null = null;
      const apiBase = "https://api.todoist.com/api/v1";

      do {
        const params = new URLSearchParams({ query: "overdue" });
        if (cursor) params.set("cursor", cursor);
        const r = await fetch(`${apiBase}/tasks/filter?${params}`, {
          headers: { "Authorization": `Bearer ${apiToken}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as any;
        allTasks.push(...(data.results || []));
        cursor = data.next_cursor || null;
      } while (cursor);

      if (allTasks.length === 0) {
        await ctx.reply("\u2705 Overdue\u30BF\u30B9\u30AF\u306A\u3057");
        return;
      }

      let updated = 0;
      let errors = 0;

      for (const t of allTasks) {
        const dueStr = t.due?.date || "";
        const hasTime = dueStr.includes("T");
        let payload: Record<string, string>;

        if (hasTime) {
          const timePart = dueStr.split("T")[1] || "00:00:00Z";
          payload = { due_datetime: `${targetDate}T${timePart}` };
        } else {
          payload = { due_date: targetDate };
        }

        try {
          const r = await fetch(`${apiBase}/tasks/${t.id}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          updated++;
        } catch {
          errors++;
        }
      }

      const lines = ["\u2705 Reschedule\u5B8C\u4E86: " + updated + "/" + allTasks.length + "\u4EF6 \u2192 " + targetLabel];
      if (errors > 0) lines.push("\u26A0\uFE0F " + errors + "\u4EF6\u30A8\u30E9\u30FC");
      await ctx.reply(lines.join("\n"));
    } catch (e: any) {
      await ctx.reply("\u274C Reschedule\u5931\u6557: " + e.message);
    }

    } else {
    // List today's tasks (default)
    try {
      const res = await fetch("https://api.todoist.com/api/v1/tasks/filter?query=today", {
        headers: { "Authorization": `Bearer ${apiToken}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as any;
      const tasks: Array<{ id: string; content: string; priority: number; due?: { date?: string; datetime?: string } }> =
        Array.isArray(raw) ? raw : (raw.results || []);

      if (tasks.length === 0) {
        await ctx.reply("📋 今日のタスクはない");
        return;
      }

      // Sort: priority high first, then by time
      tasks.sort((a, b) => b.priority - a.priority);

      const lines = [`📋 <b>今日のタスク</b> (${tasks.length}件)\n`];
      for (const t of tasks.slice(0, 30)) {
        const p = t.priority === 4 ? "🔴" : t.priority === 3 ? "🟠" : t.priority === 2 ? "🟡" : "⚪";
        const time = t.due?.datetime
          ? new Date(t.due.datetime).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
          : "";
        lines.push(`${p} ${time ? time + " " : ""}${t.content}`);
        lines.push(`   <code>${t.id}</code>`);
      }

      if (tasks.length > 30) {
        lines.push(`\n... 他${tasks.length - 30}件`);
      }

      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } catch (e: any) {
      await ctx.reply(`❌ タスク取得失敗: ${e.message}`);
    }
  }
}

/**
 * /focus - Toggle focus mode or check status
 */
export async function handleFocus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1); // Remove "/focus"

  // No args → show status
  if (args.length === 0) {
    const isEnabled = await isFocusModeEnabled(userId!);
    await ctx.reply(isEnabled ? '🔇 Focus Mode: ON' : '🔔 Focus Mode: OFF');
    return;
  }

  const command = args[0]!.toLowerCase();

  if (command === 'on') {
    await enableFocusMode(userId!);
    await ctx.reply('🔇 Focus Mode有効化\n通知はバッファに保存されます');
  } else if (command === 'off') {
    await disableFocusMode(userId!);
    await ctx.reply('🔔 Focus Mode解除\nバッファされた通知を配信します...');
    await deliverBufferedNotifications(ctx, userId!);
  } else {
    await ctx.reply('使い方:\n/focus → 状態確認\n/focus on → 有効化\n/focus off → 解除');
  }
}

/**
 * /alarm - Set iPhone alarm via iMessage
 * Usage: /alarm 7時半 エサ
 */

/**
 * Parse alarm time from message (e.g., "7時半 エサ", "17:30 テスト")
 */
function parseAlarmMessage(message: string): { time: string; label: string } | null {
  let content = message.startsWith("アラーム") ? message.slice(4) : message;
  content = content
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ":")
    .replace(/\u3000/g, " ")
    .trim();

  const m1 = content.match(/^(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*(.*)$/);
  if (m1 && m1[1] && m1[2]) {
    return { time: `${m1[1].padStart(2, "0")}:${m1[2].padStart(2, "0")}`, label: (m1[3] ?? "").trim() || "アラーム" };
  }
  const m2 = content.match(/^(\d{1,2})\s*時\s*半\s*(.*)$/);
  if (m2 && m2[1]) {
    return { time: `${m2[1].padStart(2, "0")}:30`, label: (m2[2] ?? "").trim() || "アラーム" };
  }
  const m3 = content.match(/^(\d{1,2})\s*:\s*(\d{2})\s*(.*)$/);
  if (m3 && m3[1] && m3[2]) {
    return { time: `${m3[1].padStart(2, "0")}:${m3[2]}`, label: (m3[3] ?? "").trim() || "アラーム" };
  }
  const m4 = content.match(/^(\d{1,2})\s*時\s*(.*)$/);
  if (m4 && m4[1]) {
    return { time: `${m4[1].padStart(2, "0")}:00`, label: (m4[2] ?? "").trim() || "アラーム" };
  }
  return null;
}

/** /alarm <time> [label] -- Set a one-time alarm notification. */
export async function handleAlarm(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const args = (ctx.message?.text || "").replace(/^\/alarm\s*/, "").trim();
  if (!args) {
    await ctx.reply("使い方: /alarm 7時半 エサ\n例: /alarm 19時エサ, /alarm 5:30起床, /alarm 5（5分後）");
    return;
  }

  // Normalize fullwidth digits to halfwidth
  const normalizedArgs = args.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );

  // 相対時間パターン: 数字のみ or 数字+分 → N分後
  const relativeMatch = normalizedArgs.match(/^(\d+)\s*分?\s*(.*)$/);
  let time: string;
  let label: string;

  if (relativeMatch && relativeMatch[1] && !normalizedArgs.includes("時") && !normalizedArgs.includes(":")) {
    // 相対時間: /alarm 5 → 5分後
    const minutes = parseInt(relativeMatch[1], 10);
    if (minutes <= 0 || minutes > 1440) {
      await ctx.reply("❌ 1〜1440分の範囲で指定してね");
      return;
    }
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);
    const hour = now.getHours().toString().padStart(2, "0");
    const minute = now.getMinutes().toString().padStart(2, "0");
    time = `${hour}:${minute}`;
    label = relativeMatch[2]?.trim() || `${minutes}分タイマー`;
  } else {
    // 絶対時間パターン（既存ロジック）
    const parsed = parseAlarmMessage(args);
    if (!parsed) {
      await ctx.reply("❌ 形式が不正。例: /alarm 19時エサ, /alarm 7時半起床, /alarm 5（5分後）");
      return;
    }
    time = parsed.time;
    label = parsed.label;
  }
  const iMessageFormat = `${time}|${label}`;

  try {
    await execAsync(
      `osascript -e 'tell application "Messages" to send "${iMessageFormat}" to buddy "+818065560713"'`
    );
    // Auto-delete command + confirmation after 3s
    const confirmMsg = await ctx.reply(`⏰ ${time}のアラーム（${label}）をセットした`);
    const autoDeleteAlarm = async () => {
      await new Promise(r => setTimeout(r, 3000));
      try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}
      try { await ctx.api.deleteMessage(ctx.chat!.id, confirmMsg.message_id); } catch {}
    };
    autoDeleteAlarm();
  } catch (error) {
    await notifyError(ctx, "alarm", error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * /recall - 過去の会話・決定・学習内容を横断検索
 * Usage: /recall キーワード
 */

/**
 * /reminder - 緊急リマインダー（至急フラグ付き）を作成
 * Usage: /reminder 9時 テスト or /reminder 9:00 テスト or /reminder 5 買い物（5分後）
 */
/**
 * Parse date+time for /reminder
 * Supports: 明日の5時, 明後日の9時半, 4月20日の5時, 4/20 5:00, 3月14日 9:00, etc.
 * Returns { dateTime: "YYYY-MM-DD HH:MM" or "HH:MM", label: string } or null
 */
function parseReminderDateTime(input: string): { dateTime: string; label: string } | null {
  let content = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ":")
    .replace(/\u3000/g, " ")
    .trim();

  // --- Relative minutes: just a number (no 時 or :) ---
  const relMatch = content.match(/^(\d+)\s*分?\s*(.*)$/);
  if (relMatch && relMatch[1] && !content.includes("時") && !content.includes(":") && !content.includes("月") && !content.includes("明日") && !content.includes("明後日") && !content.includes("/")) {
    const minutes = parseInt(relMatch[1], 10);
    if (minutes <= 0 || minutes > 1440) return null;
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);
    const y = now.getFullYear();
    const mo = (now.getMonth() + 1).toString().padStart(2, "0");
    const d = now.getDate().toString().padStart(2, "0");
    const h = now.getHours().toString().padStart(2, "0");
    const mi = now.getMinutes().toString().padStart(2, "0");
    return { dateTime: `${y}-${mo}-${d} ${h}:${mi}`, label: relMatch[2]?.trim() || `${minutes}分リマインダー` };
  }

  // --- Extract date part ---
  let datePart = "";
  let rest = content;

  // 明日の / 明後日の
  const ashitaMatch = rest.match(/^(明日|明後日)\s*の?\s*/);
  if (ashitaMatch) {
    const now = new Date();
    const offset = ashitaMatch[1] === "明日" ? 1 : 2;
    now.setDate(now.getDate() + offset);
    datePart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
    rest = rest.slice(ashitaMatch[0].length);
  }

  // M月D日の / M/D
  if (!datePart) {
    const mdMatch = rest.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*の?\s*/);
    if (mdMatch && mdMatch[1] && mdMatch[2]) {
      const now = new Date();
      let year = now.getFullYear();
      const month = parseInt(mdMatch[1], 10);
      const day = parseInt(mdMatch[2], 10);
      // If the date is in the past, assume next year
      const candidate = new Date(year, month - 1, day);
      if (candidate < now) year++;
      datePart = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      rest = rest.slice(mdMatch[0].length);
    }
  }
  if (!datePart) {
    const slashMatch = rest.match(/^(\d{1,2})\/(\d{1,2})\s*/);
    if (slashMatch && slashMatch[1] && slashMatch[2]) {
      const now = new Date();
      let year = now.getFullYear();
      const month = parseInt(slashMatch[1], 10);
      const day = parseInt(slashMatch[2], 10);
      const candidate = new Date(year, month - 1, day);
      if (candidate < now) year++;
      datePart = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      rest = rest.slice(slashMatch[0].length);
    }
  }

  // --- Extract time part (reuse parseAlarmMessage logic) ---
  const timeParsed = parseAlarmMessage(rest);
  if (!timeParsed) return null;

  if (datePart) {
    return { dateTime: `${datePart} ${timeParsed.time}`, label: timeParsed.label };
  } else {
    return { dateTime: timeParsed.time, label: timeParsed.label };
  }
}

/** /reminder <time> <label> -- Schedule a reminder notification. */
export async function handleReminder(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const args = (ctx.message?.text || "").replace(/^\/reminder\s*/, "").trim();
  if (!args) {
    await ctx.reply("使い方: /reminder 9時 テスト\n例: /reminder 9:00 買い物, /reminder 明日の5時 納品書, /reminder 4月20日の9時 会議, /reminder 5 電話（5分後）");
    return;
  }

  const parsed = parseReminderDateTime(args);
  if (!parsed) {
    await ctx.reply("❌ 形式が不正。例: /reminder 9時 テスト, /reminder 明日の5時 納品書, /reminder 4/20 9:00 会議, /reminder 5（5分後）");
    return;
  }

  const { dateTime, label } = parsed;

  try {
    const input = `${dateTime}\n${label}`;
    const { stderr } = await execAsync(
      `printf '${input}' | shortcuts run '緊急リマインダー'`,
      { timeout: 15000 }
    );
    if (stderr && stderr.includes("Error")) {
      await ctx.reply(`❌ リマインダー設定エラー: ${stderr}`);
      return;
    }
    const confirmMsg = await ctx.reply(`🔔 ${dateTime} 緊急リマインダー: ${label}`);
    // Auto-delete after 3s
    const autoDelete = async () => {
      await new Promise(r => setTimeout(r, 3000));
      try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}
      try { await ctx.api.deleteMessage(ctx.chat!.id, confirmMsg.message_id); } catch {}
    };
    autoDelete();
  } catch (error) {
    await notifyError(ctx, "reminder", error instanceof Error ? error : new Error(String(error)));
  }
}

/** /recall <keyword> -- Search memory facts, summaries, and vectors. */
export async function handleRecall(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const keyword = (ctx.message?.text || "").replace(/^\/recall\s*/, "").trim();
  if (!keyword) {
    await ctx.reply("使い方: /recall キーワード\n例: /recall outpaint, /recall 従量課金");
    return;
  }

  await ctx.reply(`🔍 "${keyword}" を検索中...`);

  const userIdStr = String(userId);
  const sections: string[] = [];
  sections.push(`🔍 "<b>${escapeHtml(keyword)}</b>" の検索結果:\n`);

  // A) jarvis_chat_history — FULLTEXT検索
  try {
    const chatRes = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT role, content, timestamp FROM jarvis_chat_history
            WHERE user_id = ? AND content LIKE ?
            ORDER BY timestamp DESC LIMIT 3`,
      params: [userIdStr, `%${keyword}%`],
    });
    const chatResults = chatRes.data?.results || [];
    if (chatResults.length > 0) {
      sections.push(`📝 <b>会話履歴</b> (${chatResults.length}件)`);
      for (const r of chatResults) {
        const date = (r.timestamp || '').slice(0, 10);
        const role = r.role === 'user' ? 'DJ' : 'Jarvis';
        const snippet = truncate(r.content, 100);
        sections.push(`  [${date}] ${role}: ${escapeHtml(snippet)}`);
      }
      sections.push('');
    }
  } catch (e) {
    console.error('[Recall] chat_history search error:', e);
  }

  // B) jarvis_session_summaries — 要約・トピック・決定事項を検索
  try {
    const sumRes = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT summary, topics, key_decisions, created_at FROM jarvis_session_summaries
            WHERE user_id = ? AND (summary LIKE ? OR topics LIKE ? OR key_decisions LIKE ?)
            ORDER BY created_at DESC LIMIT 3`,
      params: [userIdStr, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`],
    });
    const sumResults = sumRes.data?.results || [];
    if (sumResults.length > 0) {
      sections.push(`📊 <b>セッション要約</b> (${sumResults.length}件)`);
      for (const r of sumResults) {
        const date = (r.created_at || '').slice(0, 10);
        const snippet = truncate(r.summary, 100);
        sections.push(`  [${date}] ${escapeHtml(snippet)}`);
      }
      sections.push('');
    }
  } catch (e) {
    console.error('[Recall] session_summaries search error:', e);
  }

  // C) jarvis_learned_memory — 学習記憶を検索
  try {
    const memRes = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT category, content, created_at FROM jarvis_learned_memory
            WHERE user_id = ? AND active = 1 AND content LIKE ?
            ORDER BY created_at DESC LIMIT 3`,
      params: [userIdStr, `%${keyword}%`],
    });
    const memResults = memRes.data?.results || [];
    if (memResults.length > 0) {
      sections.push(`🧠 <b>学習記憶</b> (${memResults.length}件)`);
      for (const r of memResults) {
        const date = (r.created_at || '').slice(0, 10);
        const cat = r.category || 'unknown';
        const snippet = truncate(r.content, 100);
        sections.push(`  [${date}] (${cat}) ${escapeHtml(snippet)}`);
      }
      sections.push('');
    }
  } catch (e) {
    console.error('[Recall] learned_memory search error:', e);
  }

  // D) git log --grep — コミットメッセージ検索
  try {
    const { stdout } = await execAsync(
      `git log --grep="${keyword.replace(/"/g, '\\"')}" --format="%ad|%s" --date=short -3`,
      { cwd: WORKING_DIR, timeout: 5000 }
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      sections.push(`📦 <b>Git</b> (${lines.length}件)`);
      for (const line of lines) {
        const [date, ...msgParts] = line.split('|');
        const msg = msgParts.join('|');
        sections.push(`  [${date}] ${escapeHtml(truncate(msg, 100))}`);
      }
      sections.push('');
    }
  } catch (e) {
    // git grepで何もヒットしないとexit code 1になるので、それは無視
    const stderr = (e as any)?.stderr || '';
    if (stderr.trim().length > 0) {
      console.error('[Recall] git log error:', e);
    }
  }

  // 結果なしの場合
  if (sections.length <= 1) {
    await ctx.reply(`🔍 "${keyword}" — 該当なし`);
    return;
  }

  await ctx.reply(sections.join('\n'), { parse_mode: "HTML" });
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  const oneLine = s.replace(/\n/g, ' ');
  return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
}

// escapeHtml imported from ../formatting

/**
 * Generic handler for croppy-dispatch.sh commands (/timer, /git, /help).
 * Routes Telegram slash commands to the dispatch script, preventing
 * fallthrough to the AI text handler (dual-response bug).
 */
export async function handleCroppyDispatch(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const text = (ctx.message?.text || "").trim();
  if (!text) return;

  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout, stderr } = await execAsync(
      `bash scripts/croppy-dispatch.sh ${JSON.stringify(text)}`,
      {
        cwd: process.env.REPO_DIR || "/Users/daijiromatsuokam1/claude-telegram-bot",
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
        },
      }
    );

    const output = (stdout || "").trim() || (stderr || "").trim() || "（出力なし）";
    // Split long output for Telegram 4096 char limit
    const chunks = output.match(/[\s\S]{1,4000}/g) || [output];
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (error: any) {
    await notifyError(ctx, "dispatch", error instanceof Error ? error : new Error(error?.stderr || error?.message || String(error)));
  }
}

// ============================================================
// /help — Rich categorized command help with InlineKeyboard
// ============================================================

const HELP_CATEGORIES: Record<string, { label: string; commands: Array<{ cmd: string; desc: string }> }> = {
  gyoumu: {
    label: "💼 業務",
    commands: [
      { cmd: "/spec", desc: "DJ仕様書管理" },
      { cmd: "/decide", desc: "決定事項を記録" },
      { cmd: "/decisions", desc: "決定事項一覧" },
      { cmd: "/todoist", desc: "Todoist連携" },
      { cmd: "/todo", desc: "Todoを追加" },
      { cmd: "/todos", desc: "Todo一覧" },
    ],
  },
  ai: {
    label: "🤖 AI",
    commands: [
      { cmd: "/debate", desc: "3AI評議会ディベート" },
      { cmd: "/gpt", desc: "ChatGPT直接質問" },
      { cmd: "/gem", desc: "Gemini直接質問" },
      { cmd: "/croppy", desc: "クロッピー自動承認モード" },
      { cmd: "/ai", desc: "AIセッションブリッジ" },
      { cmd: "/code", desc: "Claude Codeタスク" },
    ],
  },
  system: {
    label: "⚙️ システム",
    commands: [
      { cmd: "/status", desc: "Bot詳細ステータス" },
      { cmd: "/dashboard", desc: "ダッシュボード" },
      { cmd: "/quick", desc: "クイックパネル" },
      { cmd: "/new", desc: "セッションリセット" },
      { cmd: "/restart", desc: "Bot再起動" },
      { cmd: "/stop", desc: "クエリ停止" },
    ],
  },
  tools: {
    label: "🔧 ツール",
    commands: [
      { cmd: "/code", desc: "コードタスク実行" },
      { cmd: "/search", desc: "Web検索" },
      { cmd: "/cal", desc: "カレンダー" },
      { cmd: "/mail", desc: "メール送信" },
      { cmd: "/line", desc: "LINEメッセージ" },
      { cmd: "/morning", desc: "朝のブリーフィング" },
    ],
  },
};

/**
 * /help — Show categorized command menu with InlineKeyboard category buttons.
 */
export async function handleHelp(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💼 業務", callback_data: "help_category_gyoumu" },
        { text: "🤖 AI", callback_data: "help_category_ai" },
      ],
      [
        { text: "⚙️ システム", callback_data: "help_category_system" },
        { text: "🔧 ツール", callback_data: "help_category_tools" },
      ],
    ],
  };

  await ctx.reply(
    "❓ <b>JARVIS コマンドヘルプ</b>\n\nカテゴリを選んでください:",
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

/**
 * Handle help_category_NAME callback — show commands for that category.
 */
export async function handleHelpCategoryCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("help_category_")) return false;

  const categoryKey = data.replace("help_category_", "");
  const category = HELP_CATEGORIES[categoryKey];

  if (!category) {
    await ctx.answerCallbackQuery({ text: "不明なカテゴリ" });
    return true;
  }

  const lines = category.commands.map((c) => `${c.cmd} — ${c.desc}`);
  const text = `${category.label} コマンド一覧\n\n` + lines.join("\n");

  try {
    await ctx.editMessageText(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ 戻る", callback_data: "help_back" }],
        ],
      },
    });
  } catch {
    await ctx.reply(text);
  }
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

/**
 * Handle help_back callback — return to category list.
 */
export async function handleHelpBackCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== "help_back") return false;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💼 業務", callback_data: "help_category_gyoumu" },
        { text: "🤖 AI", callback_data: "help_category_ai" },
      ],
      [
        { text: "⚙️ システム", callback_data: "help_category_system" },
        { text: "🔧 ツール", callback_data: "help_category_tools" },
      ],
    ],
  };

  try {
    await ctx.editMessageText(
      "❓ <b>JARVIS コマンドヘルプ</b>\n\nカテゴリを選んでください:",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    // ignore edit errors
  }
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}
