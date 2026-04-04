/**
 * Callback query handler for Claude Telegram Bot.
 *
 * Handles inline keyboard button presses (ask_user MCP integration).
 */

import type { Context } from "grammy";
import { unlinkSync } from "fs";
import { session } from "../session";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { auditLog, startTypingIndicator } from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";
import { handleInboxCallback } from "./inbox";
import { handleTriageCallback } from "../services/inbox-triage";
import { handleHelpCategoryCallback, handleHelpBackCallback } from "./commands";
import { handleQuickCallback } from "./quick-command";
import { handleTaskCallback as handleTodoCallback } from "./task-command";
import { gatewayQuery } from "../services/gateway-db";

/**
 * Handle callback queries from inline keyboards.
 */
export async function handleCallback(ctx: Context): Promise<void> {
  // === Global delete button handler ===
  const cbData = ctx.callbackQuery?.data || '';
  if (cbData === 'ib:del:sys') {
    try {
      await ctx.deleteMessage();
    } catch (e) { /* already deleted */ }
    try {
      await ctx.answerCallbackQuery();
    } catch (e) {}
    return;
  }
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  const callbackData = ctx.callbackQuery?.data;

  if (!userId || !chatId || !callbackData) {
    await ctx.answerCallbackQuery();
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.answerCallbackQuery({ text: "Unauthorized" });
    return;
  }

  // 2. Handle resume callbacks: resume:{session_id}
  if (callbackData.startsWith("resume:")) {
    await handleResumeCallback(ctx, callbackData);
    return;
  }

  // 3. Parse callback data: askuser:{request_id}:{option_index}
  // 2.4 Inbox Triage callback routing
  // Task management callbacks
  if (callbackData.startsWith("task:")) {
    const handled = await handleTodoCallback(ctx);
    if (handled) { await ctx.answerCallbackQuery().catch(() => {}); return; }
  }

  if (callbackData.startsWith("triage:")) {
    const handled = await handleTriageCallback(
      ctx.callbackQuery,
      (opts) => ctx.answerCallbackQuery(opts)
    );
    if (handled) {
      // answerCallbackQuery already called in handleTriageCallback for batch actions
      // For non-batch actions, call it here as fallback
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
  }

  // Morning Triage callbacks
  if (callbackData.startsWith("mt:restore:")) {
    const date = callbackData.split(":")[2];
    if (date) {
      const { execSync } = require("child_process");
      try {
        execSync(`zsh ~/scripts/morning-triage-wrapper.sh --restore ${date}`, { timeout: 15000 });
        await ctx.answerCallbackQuery({ text: "📋 復元しました" });
      } catch (e) {
        await ctx.answerCallbackQuery({ text: "❌ 復元失敗" });
      }
    }
    try { await ctx.deleteMessage(); } catch (e) {}
    return;
  }

  // 2.5 Inbox Zero callback routing
  if (callbackData.startsWith("ib:")) {
    const handled = await handleInboxCallback(ctx);
    if (handled) return;
  }

  // Time Timer: done button — unpin + stop + delete message
  if (callbackData.startsWith("tt_done:")) {
    const timerId = callbackData.split(":")[1];
    await gatewayQuery("UPDATE jarvis_timetimers SET done = 1 WHERE id = ?", [timerId]);
    try {
      await ctx.api.raw.unpinChatMessage({
        chat_id: ctx.chat!.id,
        message_id: ctx.callbackQuery!.message!.message_id,
      });
    } catch (e) {}
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.answerCallbackQuery({ text: "✅ Timer stopped" });
    return;
  }

  // Jarvis Notif: done button — stop snooze + delete message
  if (callbackData.startsWith("jn_done:")) {
    const notifId = callbackData.split(":")[1];
    await gatewayQuery("UPDATE jarvis_notifs SET done = 1 WHERE id = ?", [notifId]);
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.answerCallbackQuery({ text: "✅ 完了" });
    return;
  }

  // Jarvis Notif: stop button — stop snooze only, keep message visible
  if (callbackData.startsWith("jn_stop:")) {
    const notifId = callbackData.split(":")[1];
    await gatewayQuery("UPDATE jarvis_notifs SET done = 1 WHERE id = ?", [notifId]);
    // Remove buttons, keep message text
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (e) {}
    await ctx.answerCallbackQuery({ text: "⏸ スヌーズ停止" });
    return;
  }


  // Quick panel callbacks
  if (callbackData.startsWith("quick_")) {
    const handled = await handleQuickCallback(ctx);
    if (handled) return;
  }

  // Help category callbacks
  if (callbackData.startsWith("help_category_") || callbackData === "help_back") {
    const handled = callbackData.startsWith("help_category_")
      ? await handleHelpCategoryCallback(ctx)
      : await handleHelpBackCallback(ctx);
    if (handled) return;
  }

  if (!callbackData.startsWith("askuser:")) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = callbackData.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery({ text: "Invalid callback data" });
    return;
  }

  const requestId = parts[1]!;
  const optionIndex = parseInt(parts[2]!, 10);

  // 3. Load request file
  const requestFile = `/tmp/ask-user-${requestId}.json`;
  let requestData: {
    question: string;
    options: string[];
    status: string;
  };

  try {
    const file = Bun.file(requestFile);
    const text = await file.text();
    requestData = JSON.parse(text);
  } catch (error) {
    console.error(`Failed to load ask-user request ${requestId}:`, error);
    await ctx.answerCallbackQuery({ text: "Request expired or invalid" });
    return;
  }

  // 4. Get selected option
  if (optionIndex < 0 || optionIndex >= requestData.options.length) {
    await ctx.answerCallbackQuery({ text: "Invalid option" });
    return;
  }

  const selectedOption = requestData.options[optionIndex]!;

  // 5. Update the message to show selection
  try {
    await ctx.editMessageText(`✓ ${selectedOption}`);
  } catch (error) {
    console.debug("Failed to edit callback message:", error);
  }

  // 6. Answer the callback
  await ctx.answerCallbackQuery({
    text: `Selected: ${selectedOption.slice(0, 50)}`,
  });

  // 7. Delete request file
  try {
    unlinkSync(requestFile);
  } catch (error) {
    console.debug("Failed to delete request file:", error);
  }

  // 8. Send the choice to Claude as a message
  const message = selectedOption;

  // Interrupt any running query - button responses are always immediate
  if (session.isRunning) {
    console.log("[Callback] Interrupting current query for button response");
    await session.stop();
    // Small delay to ensure clean interruption
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Start typing
  const typing = startTypingIndicator(ctx);

  // Create streaming state
  const state = new StreamingState();
  const statusCallback = createStatusCallback(ctx, state);

  try {
    const response = await session.sendMessageStreaming(
      message,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );

    await auditLog(userId, username, "CALLBACK", message, response);
  } catch (error) {
    console.error("[Callback] Error processing callback:", error);

    for (const toolMsg of state.toolMessages) {
      try {
        await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
      } catch (error) {
        console.debug("Failed to delete tool message:", error);
      }
    }

    if (String(error).includes("abort") || String(error).includes("cancel")) {
      // Only show "Query stopped" if it was an explicit stop, not an interrupt from a new message
      const wasInterrupt = session.consumeInterruptFlag();
      if (!wasInterrupt) {
        await ctx.reply("🛑 Query stopped.");
      }
    } else {
      await ctx.reply(`❌ Error: ${String(error).slice(0, 200)}`);
    }
  } finally {
    typing.stop();
  }
}

/**
 * Handle resume session callback (resume:{session_id}).
 */
async function handleResumeCallback(
  ctx: Context,
  callbackData: string
): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  const sessionId = callbackData.replace("resume:", "");

  if (!sessionId || !userId || !chatId) {
    await ctx.answerCallbackQuery({ text: "ID sessione non valido" });
    return;
  }

  // Check if session is already active
  if (session.isActive) {
    await ctx.answerCallbackQuery({ text: "Sessione già attiva" });
    return;
  }

  // Resume the selected session
  const [success, message] = session.resumeSession(sessionId);

  if (!success) {
    await ctx.answerCallbackQuery({ text: message, show_alert: true });
    return;
  }

  // Update the original message to show selection
  try {
    await ctx.editMessageText(`✅ ${message}`);
  } catch (error) {
    console.debug("Failed to edit resume message:", error);
  }
  await ctx.answerCallbackQuery({ text: "Sessione ripresa!" });

  // Send a hidden recap prompt to Claude
  const recapPrompt =
    "Please write a very concise recap of where we are in this conversation, to refresh my memory. Max 2-3 sentences.";

  const typing = startTypingIndicator(ctx);
  const state = new StreamingState();
  const statusCallback = createStatusCallback(ctx, state);

  try {
    await session.sendMessageStreaming(
      recapPrompt,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );
  } catch (error) {
    console.error("[Callback] Error getting recap:", error);
    // Don't show error to user - session is still resumed, recap just failed
  } finally {
    typing.stop();
  }
}
