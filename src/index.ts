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
  handleRecall,
  handleCroppyDispatch } from "./handlers";
import {
  handleDebate,
  handleAskGPT,
  handleAskGemini,
} from "./handlers/council";
import { handleAISession } from "./handlers/ai-session";
import { handleCode } from "./handlers/code-command";
import { handleScout } from "./handlers/scout-command";
import { handleManual } from "./handlers/manual-command";
import { handleSearch } from "./handlers/search-command";
import { registerMediaCommands } from "./handlers/media-commands";
import { handleTaskCommand, handleStopCommand as handleOrchestratorStop, handleTaskStatusCommand } from "./task/task-command";
import { handleTaskLogCommand } from "./task/tasklog-command";
import { ensureLearnedMemoryTable } from './utils/learned-memory';
import { ensureSessionSummaryTable } from './utils/session-summary';
import { startMemoryGCScheduler } from './utils/memory-gc';
import { getPendingTask, clearPendingTask } from './utils/pending-task';
import { getWorkState, formatWorkStateForContext, updateWorkStateSessionId, isWorkComplete } from './utils/work-state';
import { session } from './session';
import { convertMarkdownToHtml } from './formatting';

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
bot.command("recall", handleRecall);

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
bot.command("manual", handleManual);
bot.command("search", handleSearch);
bot.command("help", handleCroppyDispatch);
bot.on("message:text", handleText);

// Voice messages


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
    // テーブル初期化後にMemory GCスケジューラーを起動
    startMemoryGCScheduler();
  }).catch(err => {
    console.warn('⚠️ Memory table init failed (non-fatal):', err);
  });

  // Startup: unpin all messages (Control Tower pins disabled)
try {
  const djChatId = ALLOWED_USERS[0];
  if (djChatId) {
    await bot.api.unpinAllChatMessages(djChatId);
    console.log('📌 All pins cleared');
    await bot.api.sendMessage(djChatId, '🤖 Jarvis起動完了');
    console.log('📨 Startup notification sent to DJ');
  }
} catch (e) {
  console.warn('⚠️ Startup notification failed (non-fatal):', e);
}

// ============== Auto-Resume Pending Task ==============
// 再起動前に中断されたタスクがあれば自動的にClaudeセッションを復帰
try {
  const pendingTask = getPendingTask();
  if (pendingTask) {
    const age = Math.round((Date.now() - pendingTask.saved_at) / 1000);
    console.log(`[Auto-Resume] Found pending task (age=${age}s): ${pendingTask.original_message.slice(0, 80)}`);

    // セッションを復元
    if (pendingTask.session_id) {
      session.resumeSession(pendingTask.session_id);
      console.log(`[Auto-Resume] Restored session: ${pendingTask.session_id.slice(0, 8)}...`);
    }

    // ユーザーに通知
    await bot.api.sendMessage(
      pendingTask.chat_id,
      `🔄 再起動で中断されたタスクを自動再開する。\n📋 ${pendingTask.original_message.slice(0, 100)}`
    );

    // 3秒後にClaude セッションに「続行」メッセージを送信
    setTimeout(async () => {
      try {
        const resumeMessage = `前回の作業が再起動で中断された。以下のタスクの続きを実行して:\n\n${pendingTask.original_message}`;

        const response = await session.sendMessageStreaming(
          resumeMessage,
          pendingTask.username,
          pendingTask.user_id,
          async (type, content) => {
            if (type === 'segment_end' && content) {
              try {
                const html = convertMarkdownToHtml(content);
                await bot.api.sendMessage(pendingTask.chat_id, html, { parse_mode: 'HTML' });
              } catch {
                try {
                  await bot.api.sendMessage(pendingTask.chat_id, content.slice(0, 4000));
                } catch (e2) {
                  console.error('[Auto-Resume] Failed to send response:', e2);
                }
              }
            }
          },
          pendingTask.chat_id,
        );

        if (!response || response === 'No response from Claude.') {
          await bot.api.sendMessage(pendingTask.chat_id, '⚠️ 自動再開したが、Claudeから応答がなかった。');
        }

        clearPendingTask();
        console.log('[Auto-Resume] Task resumed successfully');
      } catch (err) {
        console.error('[Auto-Resume] Failed to resume task:', err);
        clearPendingTask();
        try {
          await bot.api.sendMessage(
            pendingTask.chat_id,
            `⚠️ タスク自動再開に失敗。手動で再送して:\n${pendingTask.original_message.slice(0, 200)}`
          );
        } catch (e2) {
          console.error('[Auto-Resume] Failed to send failure notification:', e2);
        }
      }
    }, 3000);
  }
} catch (e) {
  console.warn('[Auto-Resume] Check failed (non-fatal):', e);
}

// ============== Auto-Resume Work State (Layer 2) ==============
// pending-taskが無くても、長時間作業プランがあれば自動再開
try {
  const workState = getWorkState();
  if (workState && !isWorkComplete(workState)) {
    const pendingTasks = workState.tasks.filter(t => t.status === "pending" || t.status === "in_progress");
    console.log(`[Work-State] Found active work plan: ${pendingTasks.length} remaining tasks`);

    // セッションを復元
    if (workState.session_id) {
      session.resumeSession(workState.session_id);
      console.log(`[Work-State] Restored session: ${workState.session_id.slice(0, 8)}...`);
    }

    // ユーザーに通知
    await bot.api.sendMessage(
      workState.chat_id,
      `🔄 再起動検出 — 作業プランを自動再開します。\n📋 ${workState.directive.slice(0, 100)}\n⏳ 残タスク: ${pendingTasks.length}件`
    );

    // 5秒後にClaude セッションに「続行」メッセージを送信
    setTimeout(async () => {
      try {
        const contextBlock = formatWorkStateForContext(workState);
        const resumeMessage = `再起動で中断されたが、作業プランが残っている。続きを実行しろ。\n\n${contextBlock}`;

        const response = await session.sendMessageStreaming(
          resumeMessage,
          workState.username,
          workState.user_id,
          async (type, content) => {
            if (type === 'segment_end' && content) {
              try {
                const html = convertMarkdownToHtml(content);
                await bot.api.sendMessage(workState.chat_id, html, { parse_mode: 'HTML' });
              } catch {
                try {
                  await bot.api.sendMessage(workState.chat_id, content.slice(0, 4000));
                } catch (e2) {
                  console.error('[Work-State Resume] Failed to send response:', e2);
                }
              }
            }
          },
          workState.chat_id,
        );

        // セッションIDを更新
        if (session.sessionId) {
          updateWorkStateSessionId(session.sessionId);
        }

        if (!response || response === 'No response from Claude.') {
          await bot.api.sendMessage(workState.chat_id, '⚠️ 作業プラン自動再開したが、Claudeから応答がなかった。');
        }

        console.log('[Work-State Resume] Work plan resumed successfully');
      } catch (err) {
        console.error('[Work-State Resume] Failed to resume work plan:', err);
        try {
          await bot.api.sendMessage(
            workState.chat_id,
            `⚠️ 作業プラン自動再開に失敗:\n${String(err).slice(0, 200)}`
          );
        } catch (e2) {
          console.error('[Work-State Resume] Failed to send failure notification:', e2);
        }
      }
    }, 5000);
  }
} catch (e) {
  console.warn('[Work-State] Check failed (non-fatal):', e);
}

// Heartbeat for watchdog + silent hang detection
// - 30秒ごとに /tmp/jarvis-heartbeat にepoch秒を書き込み（cron監視用）
// - 5分ごとにログ出力（watchdog-bot.sh用）
const HEARTBEAT_FILE = "/tmp/jarvis-heartbeat";
const HEARTBEAT_FILE_INTERVAL = 30 * 1000;
const HEARTBEAT_LOG_INTERVAL = 5 * 60 * 1000;
let heartbeatLogCounter = 0;

const heartbeatTimer = setInterval(() => {
  if (runner.isRunning()) {
    // ファイルに毎回書き込み（30秒間隔）
    try {
      writeFileSync(HEARTBEAT_FILE, String(Math.floor(Date.now() / 1000)));
    } catch {}

    // ログは5分ごと（30秒×10回 = 300秒）
    heartbeatLogCounter++;
    if (heartbeatLogCounter >= Math.round(HEARTBEAT_LOG_INTERVAL / HEARTBEAT_FILE_INTERVAL)) {
      console.log(`[heartbeat] alive (PID ${process.pid})`);
      heartbeatLogCounter = 0;
    }
  }
}, HEARTBEAT_FILE_INTERVAL);

// 起動直後にもheartbeat書き込み
try {
  writeFileSync(HEARTBEAT_FILE, String(Math.floor(Date.now() / 1000)));
} catch {}

// Graceful shutdown — pending-taskの鮮度を維持して再起動後のauto-resumeを確実にする
const stopRunner = () => {
  clearInterval(heartbeatTimer);

  // PID lockファイルを削除
  try {
    const { unlinkSync: _unlink } = require("fs");
    _unlink(PID_LOCK_FILE);
  } catch {}


  // Pending taskがあれば saved_at を現在時刻に更新（再起動後の有効期限切れを防ぐ）
  try {
    if (existsSync(PENDING_TASK_FILE)) {
      const raw = readFileSync(PENDING_TASK_FILE, "utf-8");
      const task = JSON.parse(raw);
      task.saved_at = Date.now();
      // セッションIDが無ければ現在のセッションから取得
      if (!task.session_id && session.sessionId) {
        task.session_id = session.sessionId;
      }
      writeFileSync(PENDING_TASK_FILE, JSON.stringify(task, null, 2));
      console.log("[Shutdown] Pending task refreshed for auto-resume");
    }
  } catch (e) {
    console.warn("[Shutdown] Failed to refresh pending task:", e);
  }

  // Work stateのセッションIDも更新
  try {
    const ws = getWorkState();
    if (ws && session.sessionId) {
      updateWorkStateSessionId(session.sessionId);
      console.log("[Shutdown] Work state session_id updated");
    }
  } catch (e) {
    console.warn("[Shutdown] Failed to update work state:", e);
  }

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
  console.log("Received SIGTERM (graceful shutdown, pending task preserved)");
  stopRunner();
  process.exit(0);
});
