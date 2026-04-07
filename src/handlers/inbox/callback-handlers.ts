/**
 * Individual callback handler functions for inbox actions.
 * Each handler implements one callback action type.
 */

import type { Context } from "grammy";
import { fetchWithTimeout } from "../../utils/fetch-with-timeout";

export interface CallbackContext {
  ctx: Context;
  action: string;
  sourceId: string;
  msgId?: number;
  chatId?: number;
  queueBatchAction: (chatId: number, entry: any, botApi: any) => number;
  handleFullText: (ctx: Context, sourceId: string) => Promise<void>;
  handleAttachments: (ctx: Context, sourceId: string) => Promise<void>;
  handleReplyPrompt: (ctx: Context, sourceId: string, msgId?: number) => Promise<void>;
  handleLineReplyPrompt: (ctx: Context, sourceId: string, msgId?: number) => Promise<void>;
  handleImessageReplyPrompt: (ctx: Context, sourceId: string, msgId?: number) => Promise<void>;
  handleAiDraft: (ctx: Context, sourceId: string, msgId?: number) => Promise<void>;
}

export async function handleArchiveCallback(cc: CallbackContext): Promise<void> {
  const { ctx, sourceId, msgId, chatId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, { action: "archive", msgId, sourceId, msgText: ctx.callbackQuery?.message?.text || "", msgDate: ctx.callbackQuery?.message?.date }, ctx.api);
    try { await ctx.answerCallbackQuery({ text: "✉ アーカイブ予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleTrashCallback(cc: CallbackContext): Promise<void> {
  const { ctx, sourceId, msgId, chatId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, { action: "trash", msgId, sourceId, msgText: ctx.callbackQuery?.message?.text || "", msgDate: ctx.callbackQuery?.message?.date }, ctx.api);
    try { await ctx.answerCallbackQuery({ text: "🗑 ゴミ箱予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleDelCallback(cc: CallbackContext): Promise<void> {
  const { ctx, sourceId, msgId, chatId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, { action: "del", msgId, sourceId, msgText: "" }, ctx.api);
    try { await ctx.answerCallbackQuery({ text: "🗑 削除予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleDelmemoCallback(cc: CallbackContext): Promise<void> {
  const { ctx, sourceId, msgId, chatId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const replyTo = ctx.callbackQuery?.message?.reply_to_message?.message_id;
    const count = queueBatchAction(chatId, { action: "delmemo", msgId, sourceId, msgText: "", replyToMsgId: replyTo }, ctx.api);
    try { await ctx.answerCallbackQuery({ text: "🗑 削除予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleTodoCallback(cc: CallbackContext): Promise<void> {
  const { ctx, msgId, chatId } = cc;
  try {
    const msgText = ctx.callbackQuery?.message?.text || "";
    const taskContent = msgText || "Telegram task";

    const now = new Date();
    const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const jst = new Date(jstMs);
    const min = jst.getUTCMinutes();
    if (min < 30) {
      jst.setUTCMinutes(30, 0, 0);
    } else {
      jst.setUTCMinutes(0, 0, 0);
      jst.setUTCHours(jst.getUTCHours() + 1);
    }
    const y = jst.getUTCFullYear();
    const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const h = String(jst.getUTCHours()).padStart(2, "0");
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");
    const dueString = `${y}-${mo}-${d} ${h}:${mi}`;

    const os = await import("os");
    const { join } = await import("path");
    const { loadJsonFile: loadJson } = await import("../../utils/json-loader");
    const configPath = join(os.homedir(), ".claude", "jarvis_config.json");
    const config = loadJson<any>(configPath);
    const apiToken = config.rules?.todoist?.api_token;
    if (!apiToken) throw new Error("Todoist token not found");

    const res = await fetchWithTimeout("https://api.todoist.com/api/v1/tasks", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: taskContent, due_datetime: dueString.replace(" ", "T") + ":00+09:00" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (chatId && msgId) {
      try { await ctx.api.deleteMessage(chatId, msgId); } catch {}
    }
    await ctx.answerCallbackQuery({ text: `\u{1F4CB} ${h}:${mi} \u30BF\u30B9\u30AF\u5316`, show_alert: false });
  } catch (e: unknown) {
    await ctx.answerCallbackQuery({ text: `\u274C ${e instanceof Error ? e.message : "\u30BF\u30B9\u30AF\u5316\u5931\u6557"}`, show_alert: true });
  }
}

function buildSnoozeEntry(cc: CallbackContext, action: string, hours?: number) {
  const { ctx, sourceId, msgId } = cc;
  const origMsg = ctx.callbackQuery?.message;
  const rm = origMsg && "reply_markup" in origMsg ? JSON.stringify((origMsg as any).reply_markup) : null;
  return { action, msgId: msgId!, sourceId, msgText: origMsg?.text || "", msgDate: origMsg?.date, replyMarkup: rm || undefined, hours };
}

export async function handleSnz1hCallback(cc: CallbackContext): Promise<void> {
  const { ctx, chatId, msgId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, buildSnoozeEntry(cc, "snz1h", 1), ctx.api);
    try { await ctx.answerCallbackQuery({ text: "⏰ 1hスヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleSnz3hCallback(cc: CallbackContext): Promise<void> {
  const { ctx, chatId, msgId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, buildSnoozeEntry(cc, "snz3h", 3), ctx.api);
    try { await ctx.answerCallbackQuery({ text: "⏰ 3hスヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}

export async function handleSnzamCallback(cc: CallbackContext): Promise<void> {
  const { ctx, chatId, msgId, queueBatchAction } = cc;
  if (chatId && msgId) {
    const count = queueBatchAction(chatId, buildSnoozeEntry(cc, "snzam"), ctx.api);
    try { await ctx.answerCallbackQuery({ text: "⏰ 明朝スヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
  }
}
