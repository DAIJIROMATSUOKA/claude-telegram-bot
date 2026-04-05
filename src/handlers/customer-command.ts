/**
 * /customer command handler
 * Usage: /customer 伊藤ハム
 * Queries Access DB for all projects by customer via Parallels COM
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const LOOKUP_SCRIPT = `${process.env.HOME}/claude-telegram-bot/scripts/access-customer-lookup.py`;

export async function handleCustomer(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const customerName = text.replace(/\/customer\s*/i, "").trim();

  if (!customerName) {
    await ctx.reply("使い方: /customer 顧客名（例: /customer 伊藤ハム）");
    return;
  }

  const statusMsg = await ctx.reply(`🔍 ${customerName} の案件一覧を検索中...`);

  try {
    const { stdout, stderr } = await execAsync(
      `python3 "${LOOKUP_SCRIPT}" "${customerName}"`,
      { timeout: 70_000 }
    );

    const result = stdout.trim();
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      result || `${customerName} の案件が見つかりませんでした。`
    );
  } catch (err: any) {
    const msg = err.stderr?.substring(0, 200) || err.message?.substring(0, 200) || "不明なエラー";
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ 検索エラー: ${msg}`
    );
  }
}
