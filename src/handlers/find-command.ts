/**
 * /find command — Search D1 tables for keyword matches
 * Usage: /find keyword
 * Searches: inbox_triage_queue, message_mappings, tasks
 * Returns top 10 results with timestamps and context.
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { escapeHtml } from "../formatting";

function extractReadable(raw: string, maxLen = 80): string {
  // Try to parse JSON and extract meaningful text
  try {
    const obj = JSON.parse(raw);
    // LINE message format
    if (obj.group_name || obj.user_name) {
      const parts: string[] = [];
      if (obj.group_name) parts.push(obj.group_name);
      if (obj.user_name) parts.push(obj.user_name);
      if (obj.text) parts.push(obj.text);
      return parts.join(" | ").substring(0, maxLen);
    }
    // Gmail format
    if (obj.from || obj.subject) {
      const parts: string[] = [];
      if (obj.from) parts.push(obj.from);
      if (obj.subject) parts.push(obj.subject);
      return parts.join(" | ").substring(0, maxLen);
    }
    // Generic: try common fields
    const text = obj.text || obj.summary || obj.title || obj.subject || obj.content || "";
    if (text) return String(text).substring(0, maxLen);
  } catch {
    // Not JSON, use as-is
  }
  return raw.substring(0, maxLen);
}

export async function handleFind(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const keyword = text.replace(/\/find\s*/i, "").trim();

  if (!keyword) {
    await ctx.reply("使い方: /find キーワード\n例: /find 伊藤ハム");
    return;
  }

  const statusMsg = await ctx.reply(`🔍 <b>${escapeHtml(keyword)}</b> を検索中...`, { parse_mode: "HTML" });

  try {
    const like = `%${keyword}%`;
    const results: Array<{ source: string; content: string; created_at: string }> = [];

    // Search inbox_triage_queue
    const triageRes = await gatewayQuery(
      `SELECT 'triage' as source, subject as content, created_at FROM inbox_triage_queue WHERE subject LIKE ? OR body LIKE ? ORDER BY created_at DESC LIMIT 5`,
      [like, like]
    );
    if (triageRes?.results) {
      for (const row of triageRes.results) {
        results.push({ source: "triage", content: String(row.content || ""), created_at: String(row.created_at || "") });
      }
    }

    // Search message_mappings
    const mappingRes = await gatewayQuery(
      `SELECT 'message' as source, source_detail as content, created_at FROM message_mappings WHERE source_detail LIKE ? ORDER BY created_at DESC LIMIT 5`,
      [like]
    );
    if (mappingRes?.results) {
      for (const row of mappingRes.results) {
        results.push({ source: "message", content: String(row.content || ""), created_at: String(row.created_at || "") });
      }
    }

    // Search tasks
    const taskRes = await gatewayQuery(
      `SELECT 'task' as source, title as content, created_at FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT 5`,
      [like, like]
    );
    if (taskRes?.results) {
      for (const row of taskRes.results) {
        results.push({ source: "task", content: String(row.content || ""), created_at: String(row.created_at || "") });
      }
    }

    if (results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `🔍 <b>${escapeHtml(keyword)}</b> — 結果なし`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Sort by created_at desc, take top 10
    results.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    const top10 = results.slice(0, 10);

    const sourceIcon: Record<string, string> = { triage: "📥", message: "💬", task: "📋" };
    const lines = top10.map((r) => {
      const icon = sourceIcon[r.source] || "📄";
      const ts = r.created_at ? r.created_at.substring(0, 16).replace("T", " ") : "";
      const readable = extractReadable(r.content);
      const snippet = escapeHtml(readable);
      return `${icon} <code>${ts}</code> ${snippet}`;
    });

    const reply =
      `🔍 <b>${escapeHtml(keyword)}</b> — ${results.length} 件ヒット (上位10件)\n\n` +
      lines.join("\n");

    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, reply, { parse_mode: "HTML" });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ 検索エラー: ${escapeHtml(err.message?.substring(0, 200) || "不明なエラー")}`,
      { parse_mode: "HTML" }
    );
  }
}
