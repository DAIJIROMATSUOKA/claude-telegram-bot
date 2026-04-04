/**
 * /expense and /expense_report command handlers
 * Usage: /expense 1500 タクシー代
 * Usage: /expense_report  → this month totals grouped by description
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";

async function ensureExpensesTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
}

export async function handleExpense(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/expense\s*/i, "").trim();

  if (!args) {
    await ctx.reply("使い方: /expense 1500 タクシー代");
    return;
  }

  const match = args.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    await ctx.reply("⚠️ 形式エラー。例: /expense 1500 タクシー代");
    return;
  }

  const amount = parseInt(match[1]!, 10);
  const description = match[2]!.trim();
  const createdAt = new Date().toISOString();

  try {
    await ensureExpensesTable();
    const result = await gatewayQuery(
      `INSERT INTO expenses (amount, description, created_at) VALUES (?, ?, ?)`,
      [amount, description, createdAt]
    );

    if (!result) {
      await ctx.reply("❌ 記録に失敗しました");
      return;
    }

    await ctx.reply(`💰 記録しました: ¥${amount.toLocaleString()} — ${description}`);
  } catch (err: any) {
    await ctx.reply(`❌ エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`);
  }
}

export async function handleExpenseReport(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const statusMsg = await ctx.reply("📊 今月の経費を集計中...");

  try {
    await ensureExpensesTable();

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const result = await gatewayQuery(
      `SELECT description, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE created_at >= ?
       GROUP BY description
       ORDER BY total DESC`,
      [monthStart]
    );

    if (!result || result.results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "📊 今月の経費記録はありません"
      );
      return;
    }

    const grandTotal = result.results.reduce((sum: number, r: any) => sum + (r.total || 0), 0);
    const lines = result.results.map(
      (r: any) => `• ${r.description}: ¥${Number(r.total).toLocaleString()}（${r.count}件）`
    );

    const msg = `📊 今月の経費レポート\n\n${lines.join("\n")}\n\n合計: ¥${grandTotal.toLocaleString()}`;
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg);
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${err.message?.substring(0, 200) || "不明なエラー"}`
    );
  }
}
