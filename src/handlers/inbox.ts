/**
 * Inbox Handler - Telegram Inbox Zero
 * Router: delegates callback and reply handling to extracted modules.
 */

import type { Context } from "grammy";
import { logger } from "../utils/logger";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { gatewayQuery } from "../services/gateway-db";
import { dispatchInboxCallback } from "./inbox/index";
import type { CallbackContext } from "./inbox/index";
import { queueBatchAction } from "./inbox-triage-callbacks";
import {
  handleFullText,
  handleAttachments,
  handleReplyPrompt,
  handleAiDraft,
  handleGmailReply,
} from "./inbox-gmail-callbacks";
import {
  handleLineReplyPrompt,
  handleLineReply,
  handleImessageReplyPrompt,
  handleImessageReply,
  handleSlackReply,
} from "./inbox-line-callbacks";

/**
 * Handle inbox callback queries (ib:action:id)
 */
export async function handleInboxCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("ib:")) return false;

  const userId = ctx.from?.id;
  if (!userId || !isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.answerCallbackQuery({ text: "Unauthorized" });
    return true;
  }

  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: "Invalid callback" });
    return true;
  }

  const action = parts[1] as string;
  const sourceId = parts.slice(2).join(":"); // gmail_id might contain colons
  const msgId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.chat?.id;

  try {
    // Direct handler actions (not batch-queued)
    const directActions: Record<string, () => Promise<void>> = {
      full: () => handleFullText(ctx, sourceId),
      attach: () => handleAttachments(ctx, sourceId),
      reply: () => handleReplyPrompt(ctx, sourceId, msgId),
      lnrpl: () => handleLineReplyPrompt(ctx, sourceId, msgId),
      imrpl: () => handleImessageReplyPrompt(ctx, sourceId, msgId),
      draft: () => handleAiDraft(ctx, sourceId, msgId),
    };

    const directHandler = directActions[action];
    if (directHandler) {
      await directHandler();
    } else {
      // Dispatch to strategy-pattern batch/complex handlers
      const handler = dispatchInboxCallback(action);
      if (handler) {
        const cc: CallbackContext = {
          ctx, action, sourceId, msgId, chatId,
          queueBatchAction,
          handleFullText, handleAttachments, handleReplyPrompt,
          handleLineReplyPrompt, handleImessageReplyPrompt, handleAiDraft,
        };
        await handler(cc);
      } else {
        await ctx.answerCallbackQuery({ text: `Unknown action: ${action}` });
      }
    }
  } catch (error) {
    logger.error("inbox", "Callback error", error);
    await ctx.answerCallbackQuery({ text: "❌ エラー発生" });
  }

  return true;
}

/**
 * Handle quote-reply to inbox notifications → route to source
 */
export async function handleInboxReply(ctx: Context): Promise<boolean> {
  const replyTo = ctx.message?.reply_to_message;
  if (!replyTo) return false;

  const replyMsgId = replyTo.message_id;
  const chatId = ctx.chat?.id;
  const replyText = ctx.message?.text;

  if (!replyMsgId || !chatId || !replyText) return false;

  try {
    let mapping = await gatewayQuery(
      "SELECT source, source_id, source_detail FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
      [replyMsgId, chatId]
    );

    // If no mapping, check parent (prompt -> notification chain)
    const parentReply = (replyTo as any).reply_to_message;
    if (!mapping?.results?.[0] && parentReply) {
      const parentMsgId = parentReply.message_id;
      mapping = await gatewayQuery(
        "SELECT source, source_id, source_detail FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
        [parentMsgId, chatId]
      );
      console.log("[Inbox] Reply chain: prompt=" + replyMsgId + " parent=" + parentMsgId + " found=" + !!mapping?.results?.[0]);
    }

    if (!mapping?.results?.[0]) return false;

    const { source, source_id, source_detail } = mapping.results[0] as any;
    const detail = source_detail ? JSON.parse(source_detail) : {};

    if (source === "gmail") {
      return await handleGmailReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "line") {
      return await handleLineReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "slack") {
      return await handleSlackReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "imessage") {
      return await handleImessageReply(ctx, source_id, detail, replyText, replyMsgId);
    }
  } catch (e) {
    console.error("[Inbox] Reply lookup error:", e);
  }

  return false;
}
