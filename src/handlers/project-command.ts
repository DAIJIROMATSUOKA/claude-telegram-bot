/**
 * /project command handler
 * Usage: /project M1314
 * Queries Access DB for project details via agent-bridge.sh
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const AGENT_BRIDGE = `${process.env.HOME}/claude-telegram-bot/scripts/agent-bridge.sh`;

export async function handleProject(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const arg = text.replace(/^\/project\s*/i, "").trim();

  if (!arg) {
    await ctx.reply("使い方: /project M1314");
    return;
  }

  const mNum = arg.toUpperCase();
  if (!/^M\d{4}/.test(mNum)) {
    await ctx.reply("⚠️ M番号の形式で入力してください（例: M1314）");
    return;
  }

  const statusMsg = await ctx.reply(`🔍 ${mNum} の案件情報を検索中...`);

  try {
    const prompt = `Access DBから案件番号 ${mNum} の情報を取得してください。顧客名、案件名、金額、ステータス、納期を含めてください。`;
    const encoded = Buffer.from(prompt).toString("base64");
    const { stdout } = await execAsync(
      `bash "${AGENT_BRIDGE}" "${encoded}" read 60`,
      { timeout: 70_000 }
    );

    // Strip status line ([OK] turns=... etc)
    const lines = stdout.trim().split("\n");
    const result = lines.filter(l => !l.startsWith("[OK]") && !l.startsWith("[WARN]") && !l.startsWith("ERROR:")).join("\n").trim();

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      result || `${mNum} の情報が見つかりませんでした。`,
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
