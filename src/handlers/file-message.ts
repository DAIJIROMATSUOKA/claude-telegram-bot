/**
 * file-message.ts
 * Called when user sends a photo or document to the bot.
 * Stores the file in pending attachment store and prompts for destination.
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { extractFileInfo, formatFileSize } from "../utils/tg-file";
import { setPendingAttach } from "../utils/attach-pending";

export async function handleFileMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;
  if (!userId) return;

  const info = extractFileInfo(ctx);
  if (!info) return;

  setPendingAttach(userId, info);

  const sizeStr = formatFileSize(info.size);
  const icon = info.mimeType.startsWith("image/") ? "🖼" : "📎";

  await ctx.reply(
    `${icon} <b>${info.filename}</b> (${sizeStr}) を保留しました。\n\n` +
    `次のコマンドで送信先を指定してください（10分で期限切れ）:\n` +
    `<code>/mail 宛先 件名 // 本文</code>\n` +
    `<code>/imsg 番号またはID メッセージ</code>\n` +
    `<code>/line グループ番号 メッセージ</code>`,
    { parse_mode: "HTML" }
  );
}
