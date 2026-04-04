/**
 * /batch command — Add and manage nightly batch tasks
 * Usage:
 *   /batch <prompt>          → add task to nightly_tasks queue
 *   /batch list              → list pending/running tasks
 *   /batch cancel <id>       → cancel a pending task
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { escapeHtml } from "../formatting";

const DEFAULT_CWD = process.env.HOME
  ? `${process.env.HOME}/claude-telegram-bot`
  : "/Users/daijiromatsuokam1/claude-telegram-bot";

async function ensureBatchTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS nightly_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL DEFAULT '${DEFAULT_CWD}',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      done_at TEXT,
      result TEXT
    )`
  );
}

export async function handleBatch(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  await ensureBatchTable();

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/batch\s*/i, "").trim();

  // List tasks
  if (!args || args === "list") {
    const res = await gatewayQuery(
      `SELECT id, prompt, status, created_at FROM nightly_tasks ORDER BY created_at DESC LIMIT 10`
    );
    if (!res?.results || res.results.length === 0) {
      await ctx.reply("キューにタスクがありません。\n使い方: /batch <プロンプト>");
      return;
    }
    const statusIcon: Record<string, string> = {
      pending: "⏳",
      running: "🔄",
      done: "✅",
      failed: "❌",
    };
    const lines = res.results.map((r: any) => {
      const icon = statusIcon[r.status] || "❓";
      const snippet = escapeHtml(String(r.prompt).substring(0, 50));
      return `${icon} <code>#${r.id}</code> ${snippet}`;
    });
    await ctx.reply(`📋 <b>Nightly Tasks</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    return;
  }

  // Cancel task
  if (args.startsWith("cancel ")) {
    const idStr = args.replace(/^cancel\s+/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await ctx.reply("使い方: /batch cancel <ID番号>");
      return;
    }
    await gatewayQuery(
      `UPDATE nightly_tasks SET status='cancelled' WHERE id=? AND status='pending'`,
      [id]
    );
    await ctx.reply(`✅ タスク #${id} をキャンセルしました。`);
    return;
  }

  // Add new task
  const prompt = args;
  const res = await gatewayQuery(
    `INSERT INTO nightly_tasks (prompt, cwd, model, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now')) RETURNING id`,
    [prompt, DEFAULT_CWD, "claude-sonnet-4-5"]
  );

  const newId = res?.results?.[0]?.id;
  await ctx.reply(
    `✅ バッチタスクをキューに追加しました\n<code>#${newId}</code> ${escapeHtml(prompt.substring(0, 80))}`,
    { parse_mode: "HTML" }
  );
}
