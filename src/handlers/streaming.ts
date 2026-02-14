/**
 * Shared streaming callback for Claude Telegram Bot handlers.
 *
 * Provides a reusable status callback for streaming Claude responses.
 */

import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { InlineKeyboard } from "grammy";
import type { StatusCallback } from "../types";
import { convertMarkdownToHtml } from "../formatting";
import {
  TELEGRAM_MESSAGE_LIMIT,
  TELEGRAM_SAFE_LIMIT,
  STREAMING_THROTTLE_MS,
  BUTTON_LABEL_MAX_LENGTH,
} from "../config";
import { getSessionIdFromContext } from "../utils/session-helper.js";
import { updateStatus } from "../utils/control-tower-helper.js";
import { controlTowerDB } from "../utils/control-tower-db.js";
import { setClaudeStatus } from "../utils/tower-renderer.js";

/**
 * Create inline keyboard for ask_user options.
 */
export function createAskUserKeyboard(requestId: string, options: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let idx = 0; idx < options.length; idx++) {
    const option = options[idx]!;
    // Truncate long options for button display
    const display =
      option.length > BUTTON_LABEL_MAX_LENGTH
        ? option.slice(0, BUTTON_LABEL_MAX_LENGTH) + "..."
        : option;
    const callbackData = `askuser:${requestId}:${idx}`;
    keyboard.text(display, callbackData).row();
  }
  return keyboard;
}

/**
 * Check for pending ask-user requests and send inline keyboards.
 */
export async function checkPendingAskUserRequests(
  ctx: Context,
  chatId: number
): Promise<boolean> {
  const glob = new Bun.Glob("ask-user-*.json");
  let buttonsSent = false;

  for await (const filename of glob.scan({ cwd: "/tmp", absolute: false })) {
    const filepath = `/tmp/${filename}`;
    try {
      const file = Bun.file(filepath);
      const text = await file.text();
      const data = JSON.parse(text);

      // Only process pending requests for this chat
      if (data.status !== "pending") continue;
      if (String(data.chat_id) !== String(chatId)) continue;

      const question = data.question || "Please choose:";
      const options = data.options || [];
      const requestId = data.request_id || "";

      if (options.length > 0 && requestId) {
        const keyboard = createAskUserKeyboard(requestId, options);
        await ctx.reply(`❓ ${question}`, { reply_markup: keyboard });
        buttonsSent = true;

        // Mark as sent
        data.status = "sent";
        await Bun.write(filepath, JSON.stringify(data));
      }
    } catch (error) {
      console.warn(`Failed to process ask-user file ${filepath}:`, error);
    }
  }

  return buttonsSent;
}

/**
 * Tracks state for streaming message updates.
 */
export class StreamingState {
  textMessages = new Map<number, Message>(); // segment_id -> telegram message
  toolMessages: Message[] = []; // ephemeral tool status messages
  lastEditTimes = new Map<number, number>(); // segment_id -> last edit time
  lastContent = new Map<number, string>(); // segment_id -> last sent content
  actionTraceIds = new Map<string, number>(); // action_key -> trace_id for tracking
  headerSent = false; // Jarvisヘッダーを送信済みか
  replyToMessageId?: number; // 元メッセージへのreply用
}

/**
 * Create a status callback for streaming updates.
 */
export function createStatusCallback(ctx: Context, state: StreamingState): StatusCallback {
  return async (statusType: string, content: string, segmentId?: number) => {
    try {
      // Get session ID for D1 tracking
      const sessionId = getSessionIdFromContext(ctx);

      if (statusType === "thinking") {
        // Log thinking (no Telegram notification)
        const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
        console.log(`🧠 Thinking: ${preview}`);
        setClaudeStatus('processing', 'thinking');

        // Record to D1
        if (sessionId) {
          await updateStatus(sessionId, 'thinking', null, preview, ctx);

          // Start action trace for thinking
          const traceId = controlTowerDB.startActionTrace({
            session_id: sessionId,
            action_type: 'thinking',
            action_name: 'Claude thinking',
            inputs_redacted: preview,
          });
          state.actionTraceIds.set('thinking', traceId);
        }
      } else if (statusType === "tool") {
        // Log tool execution (no Telegram notification)
        console.log(`🔧 Tool: ${content}`);
        setClaudeStatus('tool', content);

        // Record to D1
        if (sessionId) {
          await updateStatus(sessionId, 'tool', null, content, ctx);

          // Start action trace for tool
          const traceId = controlTowerDB.startActionTrace({
            session_id: sessionId,
            action_type: 'tool',
            action_name: content,
            inputs_redacted: content,
          });
          state.actionTraceIds.set(`tool:${content}`, traceId);
        }
      } else if (statusType === "text" && segmentId !== undefined) {
        const now = Date.now();
        const lastEdit = state.lastEditTimes.get(segmentId) || 0;

        // Record to D1
        if (sessionId) {
          await updateStatus(sessionId, 'text', null, `Segment ${segmentId}`, ctx);
        }

        if (!state.textMessages.has(segmentId)) {
          // New segment - create message
          let display =
            content.length > TELEGRAM_SAFE_LIMIT
              ? content.slice(0, TELEGRAM_SAFE_LIMIT) + "..."
              : content;
          // 最初のセグメントにJarvisヘッダーを付けて投稿の境界を明確にする
          let formatted = convertMarkdownToHtml(display);
          if (!state.headerSent) {
            formatted = `<b>🤖 Jarvis</b>\n${formatted}`;
            state.headerSent = true;
          }
          // 最初のセグメントは元メッセージへのreplyとして送信
          const replyOpts: any = { parse_mode: "HTML" };
          if (segmentId === 0 && state.replyToMessageId) {
            replyOpts.reply_parameters = { message_id: state.replyToMessageId };
          }
          try {
            const msg = await ctx.reply(formatted, replyOpts);
            state.textMessages.set(segmentId, msg);
            state.lastContent.set(segmentId, formatted);
          } catch (htmlError) {
            // HTML parse failed, fall back to plain text
            console.debug("HTML reply failed, using plain text:", htmlError);
            const plainOpts: any = {};
            if (segmentId === 0 && state.replyToMessageId) {
              plainOpts.reply_parameters = { message_id: state.replyToMessageId };
            }
            const msg = await ctx.reply(formatted, plainOpts);
            state.textMessages.set(segmentId, msg);
            state.lastContent.set(segmentId, formatted);
          }
          state.lastEditTimes.set(segmentId, now);
        } else if (now - lastEdit > STREAMING_THROTTLE_MS) {
          // Update existing segment message (throttled)
          const msg = state.textMessages.get(segmentId)!;
          const display =
            content.length > TELEGRAM_SAFE_LIMIT
              ? content.slice(0, TELEGRAM_SAFE_LIMIT) + "..."
              : content;
          const formatted = convertMarkdownToHtml(display);
          // Skip if content unchanged
          if (formatted === state.lastContent.get(segmentId)) {
            return;
          }
          try {
            await ctx.api.editMessageText(msg.chat.id, msg.message_id, formatted, {
              parse_mode: "HTML",
            });
            state.lastContent.set(segmentId, formatted);
          } catch (htmlError) {
            console.debug("HTML edit failed, trying plain text:", htmlError);
            try {
              await ctx.api.editMessageText(msg.chat.id, msg.message_id, formatted);
              state.lastContent.set(segmentId, formatted);
            } catch (editError) {
              console.debug("Edit message failed:", editError);
            }
          }
          state.lastEditTimes.set(segmentId, now);
        }
      } else if (statusType === "segment_end" && segmentId !== undefined) {
        // If message was never created during streaming (short response), create it now
        if (!state.textMessages.has(segmentId) && content) {
          let formatted = convertMarkdownToHtml(content);
          if (!state.headerSent) {
            formatted = `<b>🤖 Jarvis</b>\n${formatted}`;
            state.headerSent = true;
          }
          const replyOpts: any = { parse_mode: "HTML" };
          if (segmentId === 0 && state.replyToMessageId) {
            replyOpts.reply_parameters = { message_id: state.replyToMessageId };
          }
          try {
            const msg = await ctx.reply(formatted, replyOpts);
            state.textMessages.set(segmentId, msg);
            state.lastContent.set(segmentId, formatted);
          } catch (htmlError) {
            console.debug("HTML reply failed at segment_end, using plain text:", htmlError);
            const plainOpts: any = {};
            if (segmentId === 0 && state.replyToMessageId) {
              plainOpts.reply_parameters = { message_id: state.replyToMessageId };
            }
            const msg = await ctx.reply(content, plainOpts);
            state.textMessages.set(segmentId, msg);
            state.lastContent.set(segmentId, content);
          }
          return;
        }
        if (state.textMessages.has(segmentId) && content) {
          const msg = state.textMessages.get(segmentId)!;
          // 最初のセグメントの最終テキストにもヘッダーを維持
          const formatted = segmentId === 0
            ? `<b>🤖 Jarvis</b>\n${convertMarkdownToHtml(content)}`
            : convertMarkdownToHtml(content);

          // Skip if content unchanged
          if (formatted === state.lastContent.get(segmentId)) {
            return;
          }

          if (formatted.length <= TELEGRAM_MESSAGE_LIMIT) {
            try {
              await ctx.api.editMessageText(msg.chat.id, msg.message_id, formatted, {
                parse_mode: "HTML",
              });
            } catch (error) {
              console.debug("Failed to edit final message:", error);
            }
          } else {
            // Too long - delete and split
            try {
              await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
            } catch (error) {
              console.debug("Failed to delete message for splitting:", error);
            }
            for (let i = 0; i < formatted.length; i += TELEGRAM_SAFE_LIMIT) {
              const chunk = formatted.slice(i, i + TELEGRAM_SAFE_LIMIT);
              try {
                await ctx.reply(chunk, { parse_mode: "HTML" });
              } catch (htmlError) {
                console.debug("HTML chunk failed, using plain text:", htmlError);
                await ctx.reply(chunk);
              }
            }
          }
        }
      } else if (statusType === "done") {
        setClaudeStatus('idle');
        // Record to D1
        if (sessionId) {
          await updateStatus(sessionId, 'done', null, null, ctx);

          // Complete all pending action traces
          const now = Math.floor(Date.now() / 1000);
          for (const [key, traceId] of state.actionTraceIds.entries()) {
            try {
              const trace = controlTowerDB.getActionTraces(sessionId, 1000).find(t => t.id === traceId);
              if (trace && trace.status === 'started') {
                const duration = now - trace.started_at;
                controlTowerDB.completeActionTrace({
                  id: traceId,
                  status: 'completed',
                  completed_at: now,
                  duration_ms: duration * 1000,
                  outputs_summary: 'Completed successfully',
                });
              }
            } catch (error) {
              console.error(`Failed to complete action trace ${traceId}:`, error);
            }
          }
          state.actionTraceIds.clear();
        }

        // Delete tool messages - text messages stay
        for (const toolMsg of state.toolMessages) {
          try {
            await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
          } catch (error) {
            console.debug("Failed to delete tool message:", error);
          }
        }

        // Append footer separator to last text segment
        if (state.textMessages.size > 0) {
          const lastSegmentId = Math.max(...state.textMessages.keys());
          const lastMsg = state.textMessages.get(lastSegmentId)!;
          const lastContent = state.lastContent.get(lastSegmentId) || "";
          const footer = "\n━━━━━━━━━━━━━━━";
          const updated = lastContent + footer;
          if (updated.length <= TELEGRAM_MESSAGE_LIMIT) {
            try {
              await ctx.api.editMessageText(lastMsg.chat.id, lastMsg.message_id, updated, {
                parse_mode: "HTML",
              });
            } catch (error) {
              console.debug("Failed to append footer separator:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Status callback error:", error);
    }
  };
}
