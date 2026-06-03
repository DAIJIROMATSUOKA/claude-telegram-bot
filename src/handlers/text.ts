import { createLogger } from "../utils/logger";
const log = createLogger("text");

import { handleImsgSend } from "./imsg-send";
import { handleMailSend } from "./mail-send";
import { handleLinePost } from "./line-post";
import { handleDeadlineInput } from "./deadline-input";
import { handleAgentTask } from "./agent-task";
/**
 * Text message handler for Claude Telegram Bot.
 *
 * Pipeline:
 *   1. Auth & Rate Limit
 *   2. Routing (Croppy debug, AI Session Bridge)
 *   3. Enrichment (X summary, Web search, Croppy, Tool preload)
 *   4. Claude Session (streaming)
 *   5. Post-Process (auto-review, learned memory, session summary, auto-resume)
 */

import type { Context } from "grammy";
import { logger } from "../utils/logger";
import { session } from "../session";
import { ALLOWED_USERS } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import { auditLogRateLimit, checkInterrupt, startTypingIndicator } from "../utils";
import { sendTyping } from "../utils/typing";
import {
  hasActiveSession,
  sendToSession,
  splitTelegramMessage,
} from "../utils/session-bridge";
import { maybeEnrichWithWebSearch } from "../utils/web-search";
import { maybeEnrichWithXSummary } from "../utils/x-summary";
import { handleInboxReply } from "./inbox";

import { routeToProjectNotes } from "../services/obsidian-writer";




/**
 * Handle incoming text messages.
 */
export async function handleText(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  let message = ctx.message?.text;

  if (!userId || !message || !chatId) {
    return;
  }

  // ── Reply context: リプライ元メッセージをClaudeに渡す ──
  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg) {
    const replyText = "text" in replyMsg ? replyMsg.text : undefined;
    const replyCaption = "caption" in replyMsg ? replyMsg.caption : undefined;
    const replyContent = replyText || replyCaption;
    if (replyContent) {
      const replyFrom = replyMsg.from?.first_name || replyMsg.from?.username || "unknown";
      message = `[返信元メッセージ（${replyFrom}）]\n${replyContent}\n[/返信元]\n\n${message}`;
    }
  }

  // ── Auto-delete bot message on reply ──
  if (replyMsg?.from?.is_bot) {
    try { await ctx.api.deleteMessage(chatId, replyMsg.message_id); } catch {}
  }

  // ── Stage 1: Auth & Rate Limit ──
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }
  sendTyping(ctx);



    // === Agent Task: [AGENT] prefix triggers Agent SDK execution ===
    if (message.startsWith('[AGENT]')) {
      const taskPrompt = message.replace(/^\[AGENT\]\s*/, '').trim();
      if (taskPrompt) {
        // Fire and forget - don't block other message handling
        handleAgentTask(taskPrompt, chatId, ctx.api).catch((e: any) =>
          logger.error("text", "Agent Task unhandled error", e)
        );
        return;
      }
    }

    // === Deadline input: M1300の納期3/31 ===
    if (await handleDeadlineInput(ctx)) return;

    // === Project routing: detect M-numbers in DJ messages ===
    try {
      await routeToProjectNotes(message, "telegram");
    } catch (e) {
      // Non-fatal: never break message flow
    }

    // === Inbox Zero: quote-replies to inbox sources (MUST run BEFORE domain routing) ===
    if (ctx.message?.reply_to_message) {
      try {
        const handled = await handleInboxReply(ctx);
        if (handled) {
          return;  // No stopProcessing needed - session not started yet
        }
      } catch (e) {
        logger.error("text", "Inbox reply error", e);
      }
    }

    // [Phase4-B 2026-06-04] claude.ai Chrome relay routing removed (domain reply / direct send / orchestrator / INBOX relay / chat+bridge reply). AI relay discontinued.

  // ── Memo mode: 。で始まるメッセージはJarvisスルー、🗑ボタンのみ ──
  if (ctx.message?.text?.startsWith('。')) {
    const memoText = ctx.message.text.substring(1).trim();
    // Delete user's original message
    try { await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {}
    // Append to Obsidian daily note
    if (memoText) {
      try {
        const { appendMemo } = await import("../services/obsidian-writer");
        await appendMemo(memoText);
      } catch (e) { log.error('[Memo] Obsidian write failed:', e); }
    }
    // Brief confirmation, then auto-delete
    const memoConfirm = await ctx.api.sendMessage(chatId, '📝 ✓');
    setTimeout(() => { ctx.api.deleteMessage(chatId, memoConfirm.message_id).catch(() => {}); }, 2000);
    return;
  }

  // ── Task mode: 、で始まるメッセージはObsidianタスクに追加 ──
  if (ctx.message?.text?.startsWith('、')) {
    const taskText = ctx.message.text.substring(1).trim();
    try { await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {}
    if (taskText) {
      try {
        const { appendTask } = await import('../services/obsidian-writer');
        await appendTask(taskText);
      } catch (e) { log.error('[Task] Obsidian write failed:', e); }
    }
    // Brief confirmation, then auto-delete
    const taskConfirm = await ctx.api.sendMessage(chatId, '☑️ ✓');
    setTimeout(() => { ctx.api.deleteMessage(chatId, taskConfirm.message_id).catch(() => {}); }, 2000);
    return;
  }

  // ── Stage 2: Routing ──
  if (message.trim().toLowerCase() === 'croppy: debug') {
    const { formatCroppyDebugOutput } = await import("../utils/croppy-context");
    const debugOutput = await formatCroppyDebugOutput(userId);
    await ctx.reply(debugOutput, { parse_mode: 'HTML' });
    return;
  }

  message = await checkInterrupt(message);
  if (!message.trim()) {
    return;
  }

  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(`⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`);
    return;
  }

  const stopProcessing = session.startProcessing();

  // LINE schedule command (must check before /line)
  if (message.startsWith("/line_schedule") || message.startsWith("/lineschedule")) {
    stopProcessing();
    const { handleLineSchedule } = await import("./line-schedule");
    await handleLineSchedule(ctx);
    return;
  }

  // LINE group post command
  if (message.startsWith("/line")) {
    stopProcessing();
    await handleLinePost(ctx);
    return;
  }

  if (message.startsWith("/mail")) {
    stopProcessing();
    await handleMailSend(ctx);
    return;
  }

  if (message.startsWith("/imsg")) {
    stopProcessing();
    await handleImsgSend(ctx);
    return;
  }

  // AI Session Bridge: bypass Jarvis when session is active
  if (hasActiveSession(userId)) {
    const _sbTyping = startTypingIndicator(ctx);
    const _replyParams = ctx.message?.message_id
      ? { reply_parameters: { message_id: ctx.message.message_id } }
      : {};
    try {
      let enrichedMessage = await maybeEnrichWithXSummary(message);
      if (enrichedMessage === message) {
        enrichedMessage = await maybeEnrichWithWebSearch(message);
      }
      const aiResponse = await sendToSession(userId, enrichedMessage);
      _sbTyping.stop();
      const chunks = splitTelegramMessage(aiResponse);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.reply(chunks[i]!, i === 0 ? _replyParams : {});
      }
    } catch (e) {
      _sbTyping.stop();
      const errMsg = e instanceof Error ? e.message : String(e);
      await ctx.reply("\u274C AI Session Error: " + errMsg, _replyParams);
    }
    return;
  }


  // ── [Phase4-B] plain-text AI relay discontinued. TG = notifications + commands only. ──
  stopProcessing();
  await ctx.reply("🦞 平文のAI中継は廃止しました。AIはClaude Code（/code 等）へ。コマンドは /help");
  return;
}

