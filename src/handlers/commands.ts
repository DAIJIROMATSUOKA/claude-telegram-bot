/**
 * Command handlers for Claude Telegram Bot.
 *
 * /start, /new, /stop, /status, /resume, /restart
 */

import type { Context } from "grammy";
import { session } from "../session";
import { WORKING_DIR, ALLOWED_USERS, RESTART_FILE } from "../config";
import { isAuthorized } from "../security";
import { execSync } from "child_process";
import { join } from "path";

// Project root directory (resolve from this file's location, not WORKING_DIR)
const PROJECT_ROOT = join(import.meta.dir, "..", "..");
import {
  enableFocusMode,
  disableFocusMode,
  deliverBufferedNotifications,
  isFocusModeEnabled,
} from "../utils/focus-mode";

/**
 * /start - Show welcome message and status.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  const status = session.isActive ? "Active session" : "No active session";
  const workDir = WORKING_DIR;

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
    { parse_mode: "HTML" }
  );
}

/**
 * /new - Start a fresh session.
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

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" START "${taskName}"`, { encoding: "utf-8" });
    await ctx.reply(`⏱ タスク開始: ${taskName}`);
  } catch (error: any) {
    console.error("[task_start] Timer sync failed:", error.message);
    await ctx.reply(`⚠️ タイマー同期失敗: ${error.message}`);
  }
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

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" STOP "${taskName}"`, { encoding: "utf-8" });
    await ctx.reply(`⏹ タスク停止: ${taskName}`);
  } catch (error: any) {
    console.error("[task_stop] Timer sync failed:", error.message);
    await ctx.reply(`⚠️ タイマー同期失敗: ${error.message}`);
  }
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

  try {
    const scriptPath = join(PROJECT_ROOT, "scripts", "timer-sync.sh");
    execSync(`"${scriptPath}" PAUSE "${taskName}"`, { encoding: "utf-8" });
    await ctx.reply(`⏸ タスク一時停止: ${taskName}`);
  } catch (error: any) {
    console.error("[task_pause] Timer sync failed:", error.message);
    await ctx.reply(`⚠️ タイマー同期失敗: ${error.message}`);
  }
}

/**
 * /todoist - Todoist task management
 * Usage:
 *   /todoist              → Show today's tasks
 *   /todoist add タスク名  → Add a new task (due today)
 *   /todoist done タスクID → Complete a task
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

  if (subcommand === "add") {
    // Add task
    const taskContent = args.replace(/^add\s+/, "").trim();
    if (!taskContent) {
      await ctx.reply("使い方: /todoist add タスク名");
      return;
    }

    try {
      const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: taskContent,
          due_string: "today",
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
      const res = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}/close`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await ctx.reply(`✅ タスク完了 (ID: ${taskId})`);
    } catch (e: any) {
      await ctx.reply(`❌ タスク完了失敗: ${e.message}`);
    }

  } else {
    // List today's tasks (default)
    try {
      const res = await fetch("https://api.todoist.com/rest/v2/tasks?filter=today", {
        headers: { "Authorization": `Bearer ${apiToken}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tasks = await res.json() as Array<{ id: string; content: string; priority: number; due?: { datetime?: string } }>;

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

  const command = args[0].toLowerCase();

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
