/**
 * Triage Callback Handlers - Batch queue, snooze, and action logging for inbox.
 */

import { logger } from "../utils/logger";
import { archiveToObsidian } from "../services/obsidian-writer";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";
import { gatewayQuery } from "../services/gateway-db";
import type { Context } from "grammy";

const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || "";
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || "";

// ============================================================
// Batch Action Queue - 3s debounce for all destructive actions
// ============================================================
export interface BatchEntry {
  action: string;
  msgId: number;
  sourceId: string;
  msgText: string;
  msgDate?: number;
  replyToMsgId?: number;
  replyMarkup?: string;
  hours?: number;
}
interface BatchQueue {
  entries: BatchEntry[];
  timer: ReturnType<typeof setTimeout>;
  botApi: any;
}
const batchQueue = new Map<number, BatchQueue>();
const BATCH_DELAY = 3000;

export function queueBatchAction(chatId: number, entry: BatchEntry, botApi: any): number {
  let q = batchQueue.get(chatId);
  if (q) {
    clearTimeout(q.timer);
    q.entries.push(entry);
  } else {
    q = { entries: [entry], timer: null as any, botApi };
    batchQueue.set(chatId, q);
  }
  q.timer = setTimeout(() => executeBatch(chatId), BATCH_DELAY);
  return q.entries.length;
}

async function executeBatch(chatId: number): Promise<void> {
  const q = batchQueue.get(chatId);
  if (!q) return;
  batchQueue.delete(chatId);
  const count = q.entries.length;
  logger.info("inbox", "Executing batch actions", { count, chatId });

  for (const e of q.entries) {
    try {
      switch (e.action) {
        case "del":
          await q.botApi.deleteMessage(chatId, e.msgId);
          break;

        case "delmemo":
          await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          if (e.replyToMsgId) await q.botApi.deleteMessage(chatId, e.replyToMsgId).catch(() => {});
          break;

        case "archive":
        case "trash": {
          const url = `${GAS_GMAIL_URL}?action=${e.action}&gmail_id=${e.sourceId}&key=${GAS_GMAIL_KEY}`;
          const res = await fetchWithTimeout(url, { redirect: "follow" });
          const result: any = await res.json();
          if (result.ok) {
            logInboxAction(e.action, e.sourceId, "gmail", e.msgDate);
            await archiveToObsidian(e.msgId, chatId, "in", "gmail", e.msgText, e.action);
            await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          } else {
            logger.error("inbox", `Batch ${e.action} failed`, { sourceId: e.sourceId });
          }
          break;
        }

        case "untrash": {
          const untrashUrl = `${GAS_GMAIL_URL}?action=untrash&gmail_id=${e.sourceId}&key=${GAS_GMAIL_KEY}`;
          const untrashRes = await fetchWithTimeout(untrashUrl, { redirect: "follow" });
          const untrashResult: any = await untrashRes.json();
          if (untrashResult.ok) {
            logInboxAction("untrash", e.sourceId, "gmail", e.msgDate);
            if (e.msgId) await q.botApi.editMessageText(chatId, e.msgId, "📥 受信トレイに戻しました").catch(() => {});
          } else {
            logger.error("inbox", "Untrash failed", { sourceId: e.sourceId });
          }
          break;
        }

        case "snz1h":
        case "snz3h":
        case "snzam": {
          const hours = e.action === "snz1h" ? 1 : e.action === "snz3h" ? 3 : 0;
          const until = hours > 0
            ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
            : (() => { const t = new Date(); t.setHours(t.getHours() + 9); t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0); return new Date(t.getTime() - 9 * 60 * 60 * 1000).toISOString(); })();

          logInboxAction("snooze", e.sourceId, "gmail", e.msgDate);
          try {
            let mappingId: number | null = null;
            const existing = await gatewayQuery(
              "SELECT id FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
              [e.msgId, chatId]
            );
            if (existing?.results?.[0]) {
              mappingId = existing.results[0].id as number;
              await gatewayQuery("UPDATE message_mappings SET snoozed_until = ? WHERE id = ?", [until, mappingId]);
            } else {
              const ins = await gatewayQuery(
                "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, snoozed_until) VALUES (?, ?, 'gmail', ?, ?) RETURNING id",
                [e.msgId, chatId, e.sourceId, until]
              );
              mappingId = ins?.results?.[0]?.id as number;
            }
            await gatewayQuery(
              "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
              [mappingId || 0, JSON.stringify({ text: e.msgText, reply_markup: e.replyMarkup }), until]
            );
          } catch (err) {
            console.error("[Batch] Snooze store error:", err);
          }
          await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          break;
        }
      }
    } catch (err) {
      console.error("[Batch] Action error:", e.action, err);
    }
  }
}

/**
 * Log inbox action to D1 for learning/scoring (non-blocking)
 */
export async function logInboxAction(
  action: string,
  sourceId: string,
  source: string = "gmail",
  msgDate?: number
): Promise<void> {
  try {
    const mapping = await gatewayQuery(
      "SELECT source_detail FROM message_mappings WHERE source = ? AND source_id = ? LIMIT 1",
      [source, sourceId]
    );
    const detail = mapping?.results?.[0]?.source_detail;
    const parsed = detail ? JSON.parse(String(detail)) : {};
    const from = parsed.from || parsed.sender_name || "";
    const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
    const email = emailMatch ? emailMatch[1] : from;
    const domain = email.match(/@(.+)/)?.[1] || "";
    const responseSec = msgDate ? Math.floor(Date.now() / 1000 - msgDate) : null;

    await gatewayQuery(
      "INSERT INTO inbox_actions (source, sender_email, sender_domain, action, response_seconds, gmail_msg_id) VALUES (?, ?, ?, ?, ?, ?)",
      [source, email, domain, action, responseSec, sourceId]
    );
  } catch (e) {
    console.error("[Inbox] Action log error:", e);
  }
}

/**
 * Snooze: delete now, re-notify later
 */
export async function handleSnooze(
  ctx: Context,
  gmailId: string,
  msgId?: number,
  chatId?: number,
  hours: number = 1
): Promise<void> {
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const msgText = ctx.callbackQuery?.message?.text || "(no text)";
  const originalMsg = ctx.callbackQuery?.message;

  logInboxAction("snooze", gmailId, "gmail", ctx.callbackQuery?.message?.date);

  try {
    let mappingId: number | null = null;
    if (msgId && chatId) {
      const existing = await gatewayQuery(
        "SELECT id FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
        [msgId, chatId]
      );
      if (existing?.results?.[0]) {
        mappingId = existing.results[0].id as number;
      }
    }

    if (!mappingId) {
      const ins = await gatewayQuery(
        "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, snoozed_until) VALUES (?, ?, 'gmail', ?, ?) RETURNING id",
        [msgId || 0, chatId || 0, gmailId, until]
      );
      mappingId = ins?.results?.[0]?.id as number;
    } else {
      await gatewayQuery(
        "UPDATE message_mappings SET snoozed_until = ? WHERE id = ?",
        [until, mappingId]
      );
    }

    const replyMarkup = JSON.stringify(
      originalMsg && "reply_markup" in originalMsg
        ? (originalMsg as any).reply_markup
        : null
    );

    await gatewayQuery(
      "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
      [mappingId || 0, JSON.stringify({ text: msgText, reply_markup: replyMarkup }), until]
    );
  } catch (e) {
    console.error("[Inbox] Snooze store error:", e);
  }

  await ctx.answerCallbackQuery({ text: `⏰ ${hours}h後に再通知` });

  if (msgId && chatId) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch (e) {
      console.log("[Inbox] Snooze delete failed:", e);
    }
  }
}

/**
 * Snooze until next morning (7:00 JST)
 */
export async function handleSnoozeNextMorning(
  ctx: Context,
  gmailId: string,
  msgId?: number,
  chatId?: number
): Promise<void> {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const tomorrow = new Date(jst);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  const untilUTC = new Date(tomorrow.getTime() - 9 * 60 * 60 * 1000);

  const hours = (untilUTC.getTime() - now.getTime()) / (60 * 60 * 1000);
  await handleSnooze(ctx, gmailId, msgId, chatId, Math.ceil(hours));

  await ctx.answerCallbackQuery({ text: "⏰ 明朝7:00に再通知" }).catch(() => {});
}
