/**
 * file-message.ts
 * Called when user sends a photo or document to the bot.
 * Stores the file in pending attachment store and prompts for destination.
 * If photo caption contains M-number (M\d{4}), auto-saves to Dropbox project folder.
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS, TELEGRAM_TOKEN } from "../config";
import { extractFileInfo, formatFileSize, downloadTgFile } from "../utils/tg-file";
import { setPendingAttach } from "../utils/attach-pending";
import { existsSync, mkdirSync, writeFileSync } from "fs";

const DROPBOX_PROJECTS = `${process.env.HOME}/Library/CloudStorage/Dropbox-Machinelab/Matsuoka Daijiro/案件`;

async function autoSortPhoto(ctx: Context, mNumber: string): Promise<string | null> {
  try {
    const info = extractFileInfo(ctx);
    if (!info) return null;

    const fileData = await downloadTgFile(info, TELEGRAM_TOKEN);
    const photoDir = `${DROPBOX_PROJECTS}/${mNumber}/写真`;

    if (!existsSync(photoDir)) {
      mkdirSync(photoDir, { recursive: true });
    }

    const filename = `photo_${Date.now()}.jpg`;
    const savePath = `${photoDir}/${filename}`;
    writeFileSync(savePath, fileData.buffer);

    return savePath;
  } catch (err: any) {
    console.error("[FileMessage] autoSortPhoto error:", err.message);
    return null;
  }
}

export async function handleFileMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;
  if (!userId) return;

  // Check for M-number in caption (photos only)
  const caption = ctx.message?.caption || "";
  const mMatch = caption.match(/\b(M\d{4})\b/i);
  if (mMatch && ctx.message?.photo) {
    const mNumber = mMatch[1]!.toUpperCase();
    const savePath = await autoSortPhoto(ctx, mNumber);
    if (savePath) {
      await ctx.reply(`📁 ${mNumber} の写真フォルダに保存しました\n<code>${savePath}</code>`, { parse_mode: "HTML" });
      return;
    }
  }

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
