/**
 * /customer command handler
 * Usage: /customer 伊藤ハム
 * Queries Access DB for all projects by customer via agent-bridge.sh
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const AGENT_BRIDGE = `${process.env.HOME}/claude-telegram-bot/scripts/agent-bridge.sh`;

export async function handleCustomer(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const customerName = text.replace(/^\/customer\s*/i, "").trim();

  if (!customerName) {
    await ctx.reply("使い方: /customer 顧客名（例: /customer 伊藤ハム）");
    return;
  }

  const statusMsg = await ctx.reply(`🔍 ${customerName} の案件一覧を検索中...`);

  try {
    const prompt = `Access DBから顧客名「${customerName}」に関連する全案件を取得してください。案件番号、案件名、金額、ステータス、納期のリストと、合計金額および最新案件を含めてください。`;
    const encoded = Buffer.from(prompt).toString("base64");
    const { stdout } = await execAsync(
      `bash "${AGENT_BRIDGE}" "${encoded}" read 60`,
      { timeout: 70_000 }
    );

    const lines = stdout.trim().split("\n");
    const result = lines.filter(l => !l.startsWith("[OK]") && !l.startsWith("[WARN]") && !l.startsWith("ERROR:")).join("\n").trim();

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      result || `${customerName} の案件が見つかりませんでした。`,
      { parse_mode: "HTML" }
    );
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ 検索エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`
    );
  }
}
