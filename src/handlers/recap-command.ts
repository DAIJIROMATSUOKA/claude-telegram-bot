/**
 * /recap command — Daily summary
 * Usage: /recap              (today)
 *        /recap 2026-04-03   (specific date)
 * Summarizes: messages sent/received, escalations, completed tasks, git commits, triage actions.
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { escapeHtml } from "../formatting";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function handleRecap(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const arg = text.replace(/^\/recap\s*/i, "").trim();

  // Parse date: arg or today
  let targetDate: string;
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    targetDate = arg;
  } else if (arg) {
    await ctx.reply("使い方: /recap または /recap 2026-04-03");
    return;
  } else {
    targetDate = new Date().toISOString().substring(0, 10);
  }

  const statusMsg = await ctx.reply(`📊 <b>${targetDate}</b> のサマリーを生成中...`, { parse_mode: "HTML" });

  try {
    const dayStart = `${targetDate} 00:00:00`;
    const dayEnd = `${targetDate} 23:59:59`;

    // Parallel D1 queries
    const [msgRes, escalationRes, taskRes, triageRes] = await Promise.all([
      // Messages sent/received
      gatewayQuery(
        `SELECT COUNT(*) as cnt FROM jarvis_chat_history WHERE created_at BETWEEN ? AND ?`,
        [dayStart, dayEnd]
      ),
      // Escalations
      gatewayQuery(
        `SELECT COUNT(*) as cnt FROM triage_items WHERE action = 'escalate' AND created_at BETWEEN ? AND ?`,
        [dayStart, dayEnd]
      ),
      // Completed tasks
      gatewayQuery(
        `SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND updated_at BETWEEN ? AND ?`,
        [dayStart, dayEnd]
      ),
      // Triage actions breakdown
      gatewayQuery(
        `SELECT action, COUNT(*) as cnt FROM triage_items WHERE created_at BETWEEN ? AND ? GROUP BY action`,
        [dayStart, dayEnd]
      ),
    ]);

    const msgCount = msgRes?.results?.[0]?.cnt ?? 0;
    const escalations = escalationRes?.results?.[0]?.cnt ?? 0;
    const completedTasks = taskRes?.results?.[0]?.cnt ?? 0;

    // Triage breakdown
    let triageSummary = "なし";
    if (triageRes?.results && triageRes.results.length > 0) {
      triageSummary = triageRes.results
        .map((r: any) => `${r.action}=${r.cnt}`)
        .join(", ");
    }

    // Git commits for the day
    let gitCommits = "0";
    try {
      const { stdout } = await execAsync(
        `git -C "${process.env.HOME}/claude-telegram-bot" log --oneline --after="${targetDate} 00:00:00" --before="${targetDate} 23:59:59" 2>/dev/null | wc -l`,
        { timeout: 10_000 }
      );
      gitCommits = stdout.trim();
    } catch {
      gitCommits = "?";
    }

    const lines = [
      `📊 <b>Daily Recap: ${targetDate}</b>`,
      ``,
      `💬 メッセージ: <b>${msgCount}</b>`,
      `🚨 エスカレーション: <b>${escalations}</b>`,
      `✅ 完了タスク: <b>${completedTasks}</b>`,
      `🔀 Git commits: <b>${gitCommits}</b>`,
      `📥 Triage: ${escapeHtml(triageSummary)}`,
    ];

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      lines.join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${escapeHtml(err.message?.substring(0, 200) || "不明なエラー")}`,
      { parse_mode: "HTML" }
    );
  }
}
