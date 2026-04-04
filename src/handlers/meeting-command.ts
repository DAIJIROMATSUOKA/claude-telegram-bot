/**
 * /meeting command handler
 * Usage: /meeting 田中部長
 * Searches D1 contact_log for recent interactions and returns meeting prep summary
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const AGENT_BRIDGE = `${process.env.HOME}/claude-telegram-bot/scripts/agent-bridge.sh`;
const RECENT_CONTACTS = 5;

export async function handleMeeting(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const contactName = text.replace(/^\/meeting\s*/i, "").trim();

  if (!contactName) {
    await ctx.reply("使い方: /meeting 田中部長");
    return;
  }

  const statusMsg = await ctx.reply(`📋 ${contactName} のミーティング準備中...`);

  try {
    // Query D1 for recent contact history
    const result = await gatewayQuery(
      `SELECT source, direction, timestamp, summary
       FROM contact_log
       WHERE customer_id LIKE ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [`%${contactName}%`, RECENT_CONTACTS]
    );

    let contactHistory = "";
    if (result && result.results.length > 0) {
      const lines = result.results.map((r: any) => {
        const date = r.timestamp ? r.timestamp.substring(0, 10) : "不明";
        const dir = r.direction === "inbound" ? "受信" : "送信";
        const summary = r.summary ? ` — ${r.summary}` : "";
        return `• ${date} [${r.source}/${dir}]${summary}`;
      });
      contactHistory = `\n\n直近の連絡履歴:\n${lines.join("\n")}`;
    }

    // Use agent-bridge to get broader context
    const prompt = `${contactName} との次回ミーティングの準備サマリーを作成してください。Access DBから関連する案件情報も確認してください。${contactHistory}`;
    const encoded = Buffer.from(prompt).toString("base64");

    const { stdout } = await execAsync(
      `bash "${AGENT_BRIDGE}" "${encoded}" read 60`,
      { timeout: 70_000 }
    );

    const lines = stdout.trim().split("\n");
    const agentResult = lines
      .filter(l => !l.startsWith("[OK]") && !l.startsWith("[WARN]") && !l.startsWith("ERROR:"))
      .join("\n")
      .trim();

    const msg = agentResult || `${contactName} の情報が見つかりませんでした。${contactHistory}`;
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg, { parse_mode: "HTML" });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`
    );
  }
}
