/**
 * /meeting command handler
 * Usage: /meeting 田中部長
 * D1 contact_log + Access DB project lookup for meeting prep
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const CUSTOMER_SCRIPT = `${process.env.HOME}/claude-telegram-bot/scripts/access-customer-lookup.py`;
const RECENT_CONTACTS = 5;

export async function handleMeeting(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const contactName = text.replace(/\/meeting\s*/i, "").trim();

  if (!contactName) {
    await ctx.reply("使い方: /meeting 相手名（例: /meeting 伊藤ハム）");
    return;
  }

  const statusMsg = await ctx.reply(`📋 ${contactName} のミーティング準備中...`);

  try {
    // 1. D1 contact history
    let contactSection = "";
    try {
      const result = await gatewayQuery(
        `SELECT source, direction, timestamp, summary
         FROM contact_log
         WHERE customer_id LIKE ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [`%${contactName}%`, RECENT_CONTACTS]
      );

      if (result && result.results.length > 0) {
        const lines = result.results.map((r: any) => {
          const date = r.timestamp ? r.timestamp.substring(0, 10) : "不明";
          const dir = r.direction === "inbound" ? "受信" : "送信";
          const summary = r.summary ? ` — ${r.summary}` : "";
          return `  • ${date} [${r.source}/${dir}]${summary}`;
        });
        contactSection = `\n📞 直近の連絡履歴:\n${lines.join("\n")}`;
      }
    } catch {
      // D1 query failure is non-fatal
    }

    // 2. Access DB projects
    let projectSection = "";
    try {
      const { stdout } = await execAsync(
        `python3 "${CUSTOMER_SCRIPT}" "${contactName}" --limit 5`,
        { timeout: 70_000 }
      );
      const result = stdout.trim();
      if (result && !result.includes("見つかりませんでした")) {
        projectSection = `\n📂 関連案件:\n${result}`;
      }
    } catch {
      // Access DB failure is non-fatal
    }

    const msg = `🤝 ${contactName} ミーティング準備${contactSection}${projectSection}`;
    const finalMsg = msg.trim() || `${contactName} の情報が見つかりませんでした。`;

    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg);
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`
    );
  }
}
