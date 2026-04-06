/**
 * /alias command — Store and execute command shortcuts
 * Usage:
 *   /alias gs git status --short   → saves alias "gs" → "git status --short"
 *   /alias                         → lists all aliases
 *   /gs                            → executes the alias (checked in text.ts via resolveAlias)
 *
 * Stored in D1 table: aliases (name TEXT PRIMARY KEY, command TEXT, created_at TEXT)
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { gatewayQuery } from "../services/gateway-db";
import { escapeHtml } from "../formatting";

/** Ensure aliases table exists */
async function ensureAliasTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS aliases (
      name TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
}

export async function handleAlias(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  await ensureAliasTable();

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/alias\s*/i, "").trim();

  // No args → list all aliases
  if (!args) {
    const res = await gatewayQuery(`SELECT name, command FROM aliases ORDER BY name`);
    if (!res?.results || res.results.length === 0) {
      await ctx.reply("エイリアスが登録されていません。\n使い方: /alias gs git status --short");
      return;
    }
    const lines = res.results.map(
      (r: any) => `<code>/${escapeHtml(r.name)}</code> → <code>${escapeHtml(r.command)}</code>`
    );
    await ctx.reply(`📋 <b>エイリアス一覧</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    return;
  }

  // Split: first token = alias name, rest = command
  const spaceIdx = args.indexOf(" ");
  if (spaceIdx === -1) {
    // Single token: show or delete?
    const name = args.toLowerCase();
    const res = await gatewayQuery(`SELECT command FROM aliases WHERE name = ?`, [name]);
    if (res?.results?.[0]) {
      await ctx.reply(
        `<code>/${escapeHtml(name)}</code> → <code>${escapeHtml(res.results[0].command)}</code>`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(`エイリアス /${escapeHtml(name)} は見つかりません。`);
    }
    return;
  }

  const name = args.substring(0, spaceIdx).toLowerCase().replace(/^\//, "");
  const command = args.substring(spaceIdx + 1).trim();

  if (!name || !command) {
    await ctx.reply("使い方: /alias 名前 コマンド\n例: /alias gs git status --short");
    return;
  }

  await gatewayQuery(
    `INSERT OR REPLACE INTO aliases (name, command, created_at) VALUES (?, ?, ?)`,
    [name, command, new Date().toISOString()]
  );

  await ctx.reply(
    `✅ エイリアス登録: <code>/${escapeHtml(name)}</code> → <code>${escapeHtml(command)}</code>`,
    { parse_mode: "HTML" }
  );
}

/**
 * Resolve a potential alias from a message.
 * Returns the expanded command string if an alias is found, null otherwise.
 *
 * Call this from text.ts or handleText when message starts with "/".
 */
export async function resolveAlias(message: string): Promise<string | null> {
  const match = message.match(/^\/([a-z0-9_]+)(\s+.*)?$/i);
  if (!match) return null;

  const name = match[1]!.toLowerCase();
  const rest = match[2]?.trim() || "";

  try {
    await ensureAliasTable();
    const res = await gatewayQuery(`SELECT command FROM aliases WHERE name = ?`, [name]);
    if (res?.results?.[0]?.command) {
      const cmd = String(res.results[0].command);
      return rest ? `${cmd} ${rest}` : cmd;
    }
  } catch {
    // Alias lookup failure is non-fatal
  }
  return null;
}
