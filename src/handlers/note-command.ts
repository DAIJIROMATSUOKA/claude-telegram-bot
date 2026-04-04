/**
 * /note command handler
 * Usage: /note テキスト
 * Appends to today's Obsidian daily note under ## メモ section
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const OBSIDIAN_BASE = `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian`;

function getDailyNotePath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${OBSIDIAN_BASE}/${yyyy}/${mm}/${yyyy}-${mm}-${dd}.md`;
}

function getTimestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

export async function handleNote(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const noteText = text.replace(/^\/note\s*/i, "").trim();

  if (!noteText) {
    await ctx.reply("使い方: /note メモ内容");
    return;
  }

  try {
    const notePath = getDailyNotePath();
    const dir = dirname(notePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const timestamp = getTimestamp();
    const entry = `- ${timestamp} ${noteText}`;

    if (!existsSync(notePath)) {
      // Create new daily note with memo section
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      writeFileSync(notePath, `# ${dateStr}\n\n## メモ\n${entry}\n`, "utf-8");
    } else {
      let content = readFileSync(notePath, "utf-8");

      if (content.includes("## メモ")) {
        // Append under existing ## メモ section
        content = content.replace(/(## メモ\n)([\s\S]*?)(\n## |\n$|$)/, (_, header, body, after) => {
          const trimmedBody = body.trimEnd();
          return `${header}${trimmedBody}\n${entry}\n${after}`;
        });
      } else {
        // Add ## メモ section at end
        content = content.trimEnd() + `\n\n## メモ\n${entry}\n`;
      }

      writeFileSync(notePath, content, "utf-8");
    }

    await ctx.reply(`📝 メモ追加: ${noteText}`);
  } catch (err: any) {
    await ctx.reply(`❌ メモ保存エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`);
  }
}
