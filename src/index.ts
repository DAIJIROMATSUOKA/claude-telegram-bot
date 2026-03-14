// Global error handlers - prevent CLI crashes from killing the bot
process.on("uncaughtException", (err) => {
  console.error("[GLOBAL] Uncaught exception (bot continues):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[GLOBAL] Unhandled rejection (bot continues):", reason);
});


/**
 * Claude Telegram Bot - TypeScript/Bun Edition
 *
 * Control Claude Code from your phone via Telegram.
 */

import { Bot } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { TELEGRAM_TOKEN, WORKING_DIR, ALLOWED_USERS, RESTART_FILE, PENDING_TASK_FILE } from "./config";
import { unlinkSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  handleStart,
  handleNew,
  handleStop,
  handleStatus,
  handleResume,
  handleRestart,
  handleRetry,
  handleText,
  handleDocument,
  handleCallback,
  handleWhy,
  handleCroppyHelp,
  handleCroppyEnable,
  handleCroppyDisable,
  handleCroppyStatus,
  handleTaskStart,
  handleTaskStop,
  handleTaskPause,
  handleFocus,
  handleTodoist,
  handleAlarm,
  handleReminder,
  handleRecall,
  handleCroppyDispatch } from "./handlers";
import {
  handleDebate,
  handleAskGPT,
  handleAskGemini,
} from "./handlers/council";
import { handleAISession } from "./handlers/ai-session";
import { handleBridgeCommand } from "./handlers/croppy-bridge";
import { handleChatCommand, handlePostCommand, handleChatsCommand } from "./handlers/claude-chat";
import { handleAsk, handleFindChat, handleAskUuid } from "./handlers/claude-chat-api";
import { handleCode } from "./handlers/code-command";
import { handleScout } from "./handlers/scout-command";
import { handleManual } from "./handlers/manual-command";
import { handleSearch } from "./handlers/search-command";
import { registerMediaCommands } from "./handlers/media-commands";
import { handleCal } from "./handlers/cal-command";
import { handleTaskCommand, handleStopCommand as handleOrchestratorStop, handleTaskStatusCommand } from "./task/task-command";
import { handleTaskLogCommand } from "./task/tasklog-command";
import { handleMemory, handleForget, handleRemember } from "./handlers/memory-commands";
import { runVectorGC, runPendingGC, runSummaryGC } from "./services/jarvis-memory";
import { ensureLearnedMemoryTable } from './utils/learned-memory';
import { ensureSessionSummaryTable } from './utils/session-summary';
import { startMemoryGCScheduler } from './utils/memory-gc';
import { getPendingTask, clearPendingTask } from './utils/pending-task';
import { handleMailSend } from './handlers/mail-send';
import { handleImsgSend } from './handlers/imsg-send';
import { handleLinePost } from './handlers/line-post';
import { handleLineSchedule } from './handlers/line-schedule';
import { handleJarvisNotif, initNotifTable } from './handlers/jarvisnotif-command';
import { handleTimeTimer, initTimerTable } from './handlers/timetimer-command';
import { handleFileMessage } from './handlers/file-message';
import { getWorkState, formatWorkStateForContext, updateWorkStateSessionId, isWorkComplete } from './utils/work-state';
import { session } from './session';
import { convertMarkdownToHtml } from './formatting';
import { startSnoozeChecker } from "./services/snooze";
import { startInboxTriage } from "./services/inbox-triage";

// ============== Global Context ==============
// Bot起動時にCLAUDE.mdを読み込んでグローバルに保持
export let AGENTS_MD_CONTENT = "";

function loadAgentsMarkdown(): void {
  const agentsPath = "/Users/daijiromatsuokam1/claude-telegram-bot/CLAUDE.md";
  try {
    if (existsSync(agentsPath)) {
      AGENTS_MD_CONTENT = readFileSync(agentsPath, "utf-8");
      console.log(`✅ Loaded CLAUDE.md (${AGENTS_MD_CONTENT.length} chars)`);
    } else {
      console.warn("⚠️ CLAUDE.md not found at:", agentsPath);
      AGENTS_MD_CONTENT = "";
    }
  } catch (error) {
    console.error("Failed to load CLAUDE.md:", error);
    AGENTS_MD_CONTENT = "";
  }
}

// Load CLAUDE.md at startup
loadAgentsMarkdown();

// ============== 409 Conflict Prevention ==============
// PID lockファイルで二重起動を防止
const PID_LOCK_FILE = "/tmp/jarvis-bot.pid";
try {
  if (existsSync(PID_LOCK_FILE)) {
    const oldPidStr = readFileSync(PID_LOCK_FILE, "utf-8").trim();
    const oldPid = parseInt(oldPidStr, 10);
    if (!isNaN(oldPid) && oldPid > 0) {
      try {
        process.kill(oldPid, 0); // 0 = check if process exists
        // Process exists — wait for it to die (up to 10s)
        console.warn(`[409 Prevention] Old process ${oldPid} still running. Waiting for it to exit...`);
        let waited = 0;
        while (waited < 10000) {
          try {
            process.kill(oldPid, 0);
            Bun.sleepSync(500);
            waited += 500;
          } catch {
            break; // Process died
          }
        }
        // If still alive after 10s, abort to prevent 409
        try {
          process.kill(oldPid, 0);
          console.error(`[409 Prevention] Old process ${oldPid} won't die. Aborting to prevent 409 Conflict.`);
          // process.exit(1); // TEMP: bypass 409 check
        } catch {
          // Good, it's dead
        }
      } catch {
        // Process doesn't exist, safe to continue
      }
    }
  }
  // Write our PID
  writeFileSync(PID_LOCK_FILE, String(process.pid));
} catch (e) {
  console.warn("[409 Prevention] Lock check failed (non-fatal):", e);
}

// Create bot instance
const bot = new Bot(TELEGRAM_TOKEN, {
  client: {
    // Increase timeout for large file uploads (FLUX PNG 1-3MB)
    // Default is too short and causes SIGTERM during /edit uploads
    timeoutSeconds: 300,
  },
});

// ── Global: append 🗑 delete button to every outgoing message ──
bot.api.config.use((prev, method, payload, signal) => {
  if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') {
    const p = payload as any;
    let markup = p.reply_markup ? (typeof p.reply_markup === 'string' ? JSON.parse(p.reply_markup) : p.reply_markup) : null;

    const delBtn = { text: '🗑', callback_data: 'ib:del:sys' };

    if (markup?.inline_keyboard) {
      // Check if 🗑 already exists
      const hasDelBtn = markup.inline_keyboard.some((row: any[]) => 
        row.some((btn: any) => btn.callback_data?.startsWith('ib:del'))
      );
      if (!hasDelBtn) {
        // Append 🗑 to the last row if it has space, otherwise new row
        const lastRow = markup.inline_keyboard[markup.inline_keyboard.length - 1];
        if (lastRow.length < 4) {
          lastRow.push(delBtn);
        } else {
          markup.inline_keyboard.push([delBtn]);
        }
      }
    } else if (!markup || !markup.keyboard) {
      // No markup at all → add 🗑 button
      markup = { inline_keyboard: [[delBtn]] };
    }

    p.reply_markup = JSON.stringify(markup);
  }
  return prev(method, payload, signal);
});

// Sequentialize non-command messages per user (prevents race conditions)
// Commands bypass sequentialization so they work immediately
bot.use(
  sequentialize((ctx) => {
    // Commands are not sequentialized - they work immediately
    if (ctx.message?.text?.startsWith("/")) {
      return undefined;
    }
    // Messages with ! prefix bypass queue (interrupt)
    if (ctx.message?.text?.startsWith("!")) {
      return undefined;
    }
    // Callback queries (button clicks) are not sequentialized
    if (ctx.callbackQuery) {
      return undefined;
    }
    // Other messages are sequentialized per chat
    return ctx.chat?.id.toString();
  })
);

// ============== Command Handlers ==============

bot.command("start", handleStart);
bot.command("new", handleNew);
bot.command("stop", handleStop);
bot.command("status", handleStatus);
bot.command("resume", handleResume);
bot.command("restart", handleRestart);
bot.command("retry", handleRetry);
bot.command("why", handleWhy);
bot.command("task_start", handleTaskStart);
bot.command("task_stop", handleTaskStop);
bot.command("task_pause", handleTaskPause);
bot.command("focus", handleFocus);
bot.command("todoist", handleTodoist);
bot.command("cal", handleCal);
bot.command("mail", handleMailSend);
bot.command("imsg", handleImsgSend);
bot.command("lineschedule", handleLineSchedule);
bot.command("line", handleLinePost);
bot.command("jarvisnotif", handleJarvisNotif);
bot.command("timetimer", handleTimeTimer);
bot.command("alarm", handleAlarm);
bot.command("reminder", handleReminder);
bot.command("recall", handleRecall);
bot.command("memory", handleMemory);
bot.command("forget", handleForget);
bot.command("remember", handleRemember);

// Meta-Agent commands

// Task Orchestrator commands
bot.command("task", handleTaskCommand);
bot.command("taskstop", handleOrchestratorStop);
bot.command("taskstatus", handleTaskStatusCommand);
bot.command("tasklog", handleTaskLogCommand);

// Croppy auto-approval commands
bot.command("croppy", async (ctx) => {
  const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === "enable") {
    await handleCroppyEnable(ctx);
  } else if (subcommand === "disable") {
    await handleCroppyDisable(ctx);
  } else if (subcommand === "status") {
    await handleCroppyStatus(ctx);
  } else {
    await handleCroppyHelp(ctx);
  }
});

// ============== Message Handlers ==============

// Text messages

// Council Debate commands (3AI)
bot.command("debate", handleDebate);
bot.command("gpt", handleAskGPT);
bot.command("gem", handleAskGemini);

// AI Session Bridge
bot.command("ai", handleAISession);
bot.command("code", handleCode);

// Nightshift — 夜間バッチモード

// Autopilot — 自動タスク実行エンジン

registerMediaCommands(bot);
bot.command("timer", handleCroppyDispatch);
bot.command("git", handleCroppyDispatch);
bot.command("scout", handleScout);
bot.command("bridge", handleBridgeCommand);
bot.command("workers", handleBridgeCommand);
bot.command("chat", handleChatCommand);
bot.command("post", handlePostCommand);
bot.command("chats", handleChatsCommand);
bot.command("ask", handleAsk);
bot.command("findchat", handleFindChat);
bot.command("askuuid", handleAskUuid);
bot.command("manual", handleManual);
bot.command("search", handleSearch);
bot.command("help", handleCroppyDispatch);
// Auto-delete "X pinned" service messages
bot.on("message:pinned_message", async (ctx) => { try { await ctx.deleteMessage(); } catch {} });

bot.on("message:text", handleText);

// Voice messages


// Photo messages (store as pending attachment)
bot.on("message:photo", handleFileMessage);

// Document messages
bot.on("message:document", handleDocument);

// ============== Callback Queries ==============

bot.on("callback_query:data", handleCallback);

// ============== Error Handler ==============

bot.catch((err) => {
  console.error("Bot error:", err);
});

// ============== Startup ==============

console.log("=".repeat(50));
console.log("Claude Telegram Bot - TypeScript Edition");
console.log("=".repeat(50));
console.log(`Working directory: ${WORKING_DIR}`);
console.log(`Allowed users: ${ALLOWED_USERS.length}`);
console.log("Starting bot...");

// Get bot info first
const botInfo = await bot.api.getMe();
console.log(`Bot started: @${botInfo.username}`);

// Check for pending restart message to update
if (existsSync(RESTART_FILE)) {
  try {
    const data = JSON.parse(readFileSync(RESTART_FILE, "utf-8"));
    const age = Date.now() - data.timestamp;

    // Only update if restart was recent (within 30 seconds)
    if (age < 30000 && data.chat_id && data.message_id) {
      await bot.api.editMessageText(
        data.chat_id,
        data.message_id,
        "✅ Bot restarted"
      );
    }
    unlinkSync(RESTART_FILE);
  } catch (e) {
    console.warn("Failed to update restart message:", e);
    try { unlinkSync(RESTART_FILE); } catch {}
  }
}


// Clear stale Telegram long polling (prevents 409 conflict after restart)
async function clearStalePolling(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=0&offset=-1`
      );
      const data = (await res.json()) as any;
      if (data.ok) {
        console.log("[Startup] Telegram polling cleared");
        return;
      }
      if (data.error_code === 409) {
        console.log(`[Startup] Stale polling detected, clearing... (${i + 1}/10)`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return; // Other error, proceed anyway
    } catch {
      return; // Network error, proceed anyway
    }
  }
  console.warn("[Startup] Could not clear stale polling after 10 retries, proceeding anyway");
}

await clearStalePolling();

// Start with concurrent runner (commands work immediately)
const runner = run(bot);

// Start task poller for remote execution
// Initialize memory tables (non-blocking)
  Promise.all([
    ensureLearnedMemoryTable(),
    ensureSessionSummaryTable(),
  ]).then(() => {
    console.log('✅ Memory tables initialized');
    // Inbox Zero: snooze re-notification checker
    try { startSnoozeChecker(bot); } catch(e) { console.error("[Snooze] Init failed:", e); }
    try { startInboxTriage(bot, ALLOWED_USERS[0] || 0); } catch(e) { console.error("[Triage] Init failed:", e); }
    try { initNotifTable(); } catch(e) { console.error("[Notif] Table init failed:", e); }
  }).catch((e) => console.error('[Memory] Init failed:', e));

console.log('[JARVIS] Bot started successfully');
await runner;
