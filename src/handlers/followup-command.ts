/**
 * /followup command handler
 * Queries D1 contact_log for contacts with last_contact older than 14 days
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";

const FOLLOWUP_DAYS = 14;

export async function handleFollowup(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const statusMsg = await ctx.reply("📋 フォローアップ対象を確認中...");

  try {
    const cutoff = new Date(Date.now() - FOLLOWUP_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const result = await gatewayQuery(
      `SELECT customer_id,
              MAX(timestamp) AS last_contact,
              CAST((julianday('now') - julianday(MAX(timestamp))) AS INTEGER) AS days_since
       FROM contact_log
       GROUP BY customer_id
       HAVING MAX(timestamp) < ?
       ORDER BY last_contact ASC
       LIMIT 20`,
      [cutoff]
    );

    if (!result || result.results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `✅ ${FOLLOWUP_DAYS}日以内に全顧客と連絡済みです`
      );
      return;
    }

    const lines = result.results.map((row: any) => {
      const date = row.last_contact ? row.last_contact.substring(0, 10) : "不明";
      return `• ${row.customer_id} — ${date}（${row.days_since}日前）`;
    });

    const msg = `⚠️ フォローアップ対象（${result.results.length}件）\n\n${lines.join("\n")}`;
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg);
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`
    );
  }
}
