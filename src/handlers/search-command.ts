/**
 * /search command handler
 * Search Obsidian vault via CLI
 * Usage: /search <query> [folder]
 * Example: /search JARVIS
 * Example: /search 見積 10_Projects
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const OBSIDIAN_CLI = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const MAX_RESULTS = 10;
const MAX_MSG_LEN = 4000; // Telegram message limit safety margin

interface SearchMatch {
  file: string;
  matches: Array<{ line: number; text: string }>;
}

async function obsidianSearch(
  query: string,
  folder?: string
): Promise<SearchMatch[]> {
  const pathArg = folder ? ` path='${folder}'` : "";
  const cmd = `"${OBSIDIAN_CLI}" search:context query='${query.replace(/'/g, "'\\''")}'${pathArg} limit=${MAX_RESULTS} format=json`;

  const { stdout } = await execAsync(cmd, {
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `/Applications/Obsidian.app/Contents/MacOS:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    },
  });

  return JSON.parse(stdout.trim()) as SearchMatch[];
}

function formatResults(query: string, results: SearchMatch[]): string {
  if (results.length === 0) {
    return `🔍 「${query}」の検索結果: なし`;
  }

  const lines: string[] = [`🔍 「${query}」 — ${results.length}件ヒット\n`];
  let totalLen = lines[0].length;

  for (const r of results) {
    const header = `📄 <b>${escHtml(r.file)}</b>`;
    if (totalLen + header.length > MAX_MSG_LEN) {
      lines.push("\n⚠️ 表示上限に達しました");
      break;
    }
    lines.push(header);
    totalLen += header.length;

    // Dedupe matches by line number
    const seen = new Set<number>();
    for (const m of r.matches) {
      if (seen.has(m.line)) continue;
      seen.add(m.line);
      const snippet = `  L${m.line}: ${escHtml(m.text.trim().substring(0, 120))}`;
      if (totalLen + snippet.length > MAX_MSG_LEN) break;
      lines.push(snippet);
      totalLen += snippet.length;
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function handleSearch(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/search\s*/, "").trim();

  if (!args) {
    await ctx.reply(
      "🔍 使い方: /search <キーワード> [フォルダ]\n" +
      "例: /search JARVIS\n" +
      "例: /search 見積 10_Projects\n" +
      "例: /search Claude 2026/02"
    );
    return;
  }

  // Parse: first word(s) = query, optional last word = folder if contains /
  const parts = args.split(/\s+/);
  let folder: string | undefined;
  let query: string;

  // If last part looks like a path (contains /), treat as folder filter
  if (parts.length > 1 && parts[parts.length - 1].includes("/")) {
    folder = parts.pop()!;
    query = parts.join(" ");
  } else {
    query = args;
  }

  try {
    const results = await obsidianSearch(query, folder);
    const msg = formatResults(query, results);
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (err: any) {
    const errMsg = err.message || String(err);
    if (errMsg.includes("not found") || errMsg.includes("ENOENT")) {
      await ctx.reply("⚠️ Obsidian CLIが見つかりません（v1.12+が必要）");
    } else if (errMsg.includes("pgrep") || errMsg.includes("not running")) {
      await ctx.reply("⚠️ Obsidianが起動していません（CLIにはGUIが必要）");
    } else {
      console.error("[Search] Error:", errMsg);
      await ctx.reply(`⚠️ 検索エラー: ${errMsg.substring(0, 200)}`);
    }
  }
}
