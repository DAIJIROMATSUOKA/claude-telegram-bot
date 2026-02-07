/**
 * Claude Telegram Bot - TypeScript/Bun Edition
 *
 * Control Claude Code from your phone via Telegram.
 */

import { Bot } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { TELEGRAM_TOKEN, WORKING_DIR, ALLOWED_USERS, RESTART_FILE } from "./config";
import { unlinkSync, readFileSync, existsSync } from "fs";
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
  handleVoice,
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
  handleAlarm } from "./handlers";
import {
  handleMeta,
  handleMetaRun,
  handleMetaAudit,
  handleMetaReview,
  handleMetaGaps,
  handleMetaStop,
  handleMetaStart,
} from "./handlers/meta-commands";
import {
  handleDebate,
  handleAskGPT,
  handleAskGemini,
} from "./handlers/council";
import { handleAISession } from "./handlers/ai-session";
import { registerMediaCommands } from "./handlers/media-commands";
import { startTaskPoller } from './utils/task-poller';
import { ensureLearnedMemoryTable } from './utils/learned-memory';
import { ensureSessionSummaryTable } from './utils/session-summary';
import { startMemoryGCScheduler } from './utils/memory-gc';

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

// Create bot instance
const bot = new Bot(TELEGRAM_TOKEN);

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
bot.command("alarm", handleAlarm);

// Meta-Agent commands
bot.command("meta", handleMeta);
bot.command("meta_run", handleMetaRun);
bot.command("meta_audit", handleMetaAudit);
bot.command("meta_review", handleMetaReview);
bot.command("meta_gaps", handleMetaGaps);
bot.command("meta_stop", handleMetaStop);
bot.command("meta_start", handleMetaStart);

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

registerMediaCommands(bot);
bot.on("message:text", handleText);

// Voice messages
bot.on("message:voice", handleVoice);


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

// Start with concurrent runner (commands work immediately)
const runner = run(bot);

// Start task poller for remote execution
  startTaskPoller();

  // Initialize memory tables (non-blocking)
  Promise.all([
    ensureLearnedMemoryTable(),
    ensureSessionSummaryTable(),
  ]).then(() => {
    console.log('✅ Memory tables initialized');
    // テーブル初期化後にMemory GCスケジューラーを起動
    startMemoryGCScheduler();
  }).catch(err => {
    console.warn('⚠️ Memory table init failed (non-fatal):', err);
  });

  // Startup notification - DJに起動完了を通知
try {
  const djChatId = ALLOWED_USERS[0];
  if (djChatId) {
    await bot.api.sendMessage(djChatId, '🤖 Jarvis起動完了');
    console.log('📨 Startup notification sent to DJ');
  }
} catch (e) {
  console.warn('⚠️ Startup notification failed (non-fatal):', e);
}

// Graceful shutdown
const stopRunner = () => {
  if (runner.isRunning()) {
    console.log("Stopping bot...");
    runner.stop();
  }
};

process.on("SIGINT", () => {
  console.log("Received SIGINT");
  stopRunner();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM");
  stopRunner();
  process.exit(0);
});
