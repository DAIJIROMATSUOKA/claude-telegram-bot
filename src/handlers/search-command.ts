/**
 * /search command handler
 * Search Claude chatlog archive via search-chatlogs.py
 * Usage: /search <keywords>
 * Example: /search JARVIS
 * Example: /search 見積
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const SEARCH_SCRIPT = `${process.env.HOME}/scripts/search-chatlogs.py`;
const MAX_RESULTS = 10;
import { MAX_MSG_LEN } from "../constants";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SearchResult {
  filename: string;
  title: string;
  url: string;
  date: string;
}

function parseResults(output: string): { total: number; results: SearchResult[] } {
  const lines = output.trim().split("\n");
  if (lines.length === 0) return { total: 0, results: [] };

  // First line: "Found N matches for: keyword"
  const headerMatch = lines[0]!.match(/Found (\d+) matches/);
  const total = headerMatch ? parseInt(headerMatch[1]!, 10) : 0;

  const results: SearchResult[] = [];
  for (let i = 1; i < lines.length && results.length < MAX_RESULTS; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    // Format: "filename.md  |  [title](url)"
    const pipeIdx = line.indexOf("|");
    if (pipeIdx < 0) continue;

    const filename = line.substring(0, pipeIdx).trim();
    const linkPart = line.substring(pipeIdx + 1).trim();

    // Extract [title](url)
    const linkMatch = linkPart.match(/\[(.+?)\]\((.+?)\)/);
    if (!linkMatch) continue;

    // Extract date from filename (YYYY-MM-DD_HHMM_...)
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_/);
    const date = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}:${dateMatch[3]}` : "";

    results.push({
      filename,
      title: linkMatch[1]!,
      url: linkMatch[2]!,
      date,
    });
  }

  return { total, results };
}

function formatResults(query: string, total: number, results: SearchResult[]): string {
  if (results.length === 0) {
    return `🔍 「${query}」の検索結果: なし`;
  }

  const lines: string[] = [`🔍 「${escHtml(query)}」 — ${total}件ヒット\n`];
  let totalLen = lines[0]!.length;

  for (const r of results) {
    const entry = `📄 <b>${escHtml(r.title)}</b>\n   ${r.date}  <a href="${r.url}">開く</a>`;
    if (totalLen + entry.length + 2 > MAX_MSG_LEN) {
      lines.push("\n⚠️ 表示上限に達しました");
      break;
    }
    lines.push(entry);
    totalLen += entry.length + 1;
  }

  if (total > results.length) {
    lines.push(`\n… 他 ${total - results.length}件`);
  }

  return lines.join("\n");
}

/** /search <keywords> -- Search Claude chatlog archive. */
export async function handleSearch(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/search\s*/, "").trim();

  if (!args) {
    await ctx.reply(
      "🔍 使い方: /search <キーワード>\n" +
      "例: /search JARVIS\n" +
      "例: /search 見積\n" +
      "例: /search Claude Code"
    );
    return;
  }

  try {
    // Shell-escape the query
    const safeQuery = args.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `python3 "${SEARCH_SCRIPT}" '${safeQuery}' --list`,
      { timeout: 15000, encoding: "utf-8" }
    );

    const { total, results } = parseResults(stdout);
    const msg = formatResults(args, total, results);
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (err: any) {
    const errMsg = err.message || String(err);
    if (errMsg.includes("ENOENT")) {
      await ctx.reply("⚠️ search-chatlogs.py が見つかりません");
    } else {
      console.error("[Search] Error:", errMsg);
      await ctx.reply(`⚠️ 検索エラー: ${errMsg.substring(0, 200)}`);
    }
  }
}
