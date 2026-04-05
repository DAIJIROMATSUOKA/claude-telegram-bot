/**
 * /bulkdel N — Delete last N bot messages in current chat (max 100).
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";

const MAX_DELETE = 100;
const RATE_LIMIT_MS = 35; // ~28/sec to stay under Telegram's 30/sec

export async function handleBulkDelete(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const text = (ctx.message?.text || "").replace(/^\/bulkdel\s*/, "").trim();
  const n = parseInt(text);

  if (!n || n < 1) {
    await ctx.reply("Usage: /bulkdel N (1-100)");
    return;
  }

  const count = Math.min(n, MAX_DELETE);
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const statusMsg = await ctx.reply(`🗑 Deleting last ${count} bot messages...`);

  // Get recent messages via getChat history isn't available in Bot API.
  // Instead we track message IDs: delete from current message backwards.
  // Bot API deleteMessage works with message IDs — try recent IDs.
  const currentMsgId = ctx.message?.message_id || 0;
  let deleted = 0;
  let errors = 0;

  for (let msgId = currentMsgId - 1; msgId > currentMsgId - count * 3 && deleted < count; msgId--) {
    if (msgId <= 0) break;
    try {
      await ctx.api.deleteMessage(chatId, msgId);
      deleted++;
    } catch {
      errors++;
      // Skip messages that don't exist or aren't ours
      if (errors > count * 2) break;
    }
    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  try {
    await ctx.api.editMessageText(chatId, statusMsg.message_id, `🗑 Deleted ${deleted} messages.`);
    // Auto-delete status message after 5s
    setTimeout(() => ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {}), 5000);
  } catch {}
}
