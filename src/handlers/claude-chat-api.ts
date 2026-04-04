/**
 * claude-chat-api.ts - API-based posting to past Claude.ai chats
 * No Chrome tabs required. Uses sessionKey + internal API via Python script.
 *
 * Commands:
 *   /ask <keyword> <message>  - Search past chats, post to best match
 *   /findchat <keyword>       - List matching past chats
 *   /askuuid <uuid> <message> - Post to specific chat by UUID
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { Context } from "grammy";
import { escapeHtml } from "../formatting";

const execAsync = promisify(exec);
const HOME = process.env.HOME || "/Users/daijiromatsuokam1";
const SCRIPT = `${HOME}/scripts/claude-chat-post.py`;

async function runScript(args: string, timeoutMs = 200000): Promise<any> {
  const { stdout } = await execAsync(`python3 "${SCRIPT}" ${args}`, {
    timeout: timeoutMs,
    shell: "/bin/zsh",
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    },
  });
  return JSON.parse(stdout.trim());
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + "…" : text;
}

/**
 * /findchat <keyword> — List matching past chats
 */
export async function handleFindChat(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const keyword = text.replace(/^\/findchat\s*/, "").trim();

  if (!keyword) {
    await ctx.reply("Usage: /findchat <keyword>\n例: /findchat OpenClaw");
    return;
  }

  try {
    const kw = keyword.replace(/'/g, "'\\''");
    const result = await runScript(`search '${kw}'`, 20000);

    if (!result.ok) {
      await ctx.reply(`❌ ${result.error || "検索失敗"}`);
      return;
    }

    const matches: Array<{ filename: string; title: string; uuid: string }> = result.matches || [];
    if (matches.length === 0) {
      await ctx.reply(`🔍 「${keyword}」に一致するチャットなし`);
      return;
    }

    const lines = matches.slice(0, 10).map((m, i) => {
      const shortUuid = m.uuid.substring(0, 8);
      return `${i + 1}. <code>${shortUuid}</code> ${escapeHtml(m.title)}`;
    });

    const header = `🔍 「${escapeHtml(keyword)}」${matches.length}件:`;
    const footer = matches.length > 10 ? `\n…他${matches.length - 10}件` : "";
    await ctx.reply(`${header}\n\n${lines.join("\n")}${footer}\n\n💡 <code>/askuuid UUID メッセージ</code> で投稿`, {
      parse_mode: "HTML",
    });
  } catch (e: any) {
    await ctx.reply(`❌ ${e.message || String(e)}`);
  }
}

/**
 * /ask <keyword> <message> — Search and post to best matching chat
 */
export async function handleAsk(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.replace(/^\/ask\s*/, "").trim();
  const spaceIdx = args.indexOf(" ");

  if (spaceIdx === -1 || !args) {
    await ctx.reply("Usage: /ask <keyword> <message>\n例: /ask OpenClaw 前回の続き教えて");
    return;
  }

  const keyword = args.substring(0, spaceIdx).trim();
  const message = args.substring(spaceIdx + 1).trim();

  const statusMsg = await ctx.reply(`🔍 「${keyword}」を検索中...`);

  try {
    // Write message to tmp file to avoid shell escaping issues
    const b64 = Buffer.from(message).toString("base64");
    const tmpFile = `/tmp/ask-msg-${Date.now()}.txt`;
    await execAsync(`echo '${b64}' | base64 -d > '${tmpFile}'`, { shell: "/bin/zsh" });

    const kw = keyword.replace(/'/g, "'\\''");
    const result = await runScript(`post '${kw}' "$(cat '${tmpFile}')"`, 200000);
    await execAsync(`rm -f '${tmpFile}'`);

    if (!result.ok) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `❌ ${result.error || "投稿失敗"}`);
      return;
    }

    const chatTitle = result.target_chat?.title || result.chat_title || "?";
    const response = result.response || "(空の応答)";
    const model = result.model || "?";

    const header = `💬 <b>${escapeHtml(truncate(chatTitle, 40))}</b> (${escapeHtml(model)})`;
    const djLine = `&gt; DJ: ${escapeHtml(truncate(message, 100))}`;
    const body = truncate(response, 3800 - header.length - djLine.length);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `${header}\n${djLine}\n\n${body}`,
      { parse_mode: "HTML" }
    );
  } catch (e: any) {
    const errMsg = e.message || String(e);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ ${escapeHtml(truncate(errMsg, 300))}`
    ).catch(() => {});
  }
}

/**
 * /askuuid <uuid> <message> — Post to specific chat by UUID
 */
export async function handleAskUuid(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.replace(/^\/askuuid\s*/, "").trim();
  const spaceIdx = args.indexOf(" ");

  if (spaceIdx === -1 || !args) {
    await ctx.reply("Usage: /askuuid <uuid> <message>\n例: /askuuid 81be8d7f こんにちは");
    return;
  }

  const uuidInput = args.substring(0, spaceIdx).trim();
  const message = args.substring(spaceIdx + 1).trim();

  // Resolve short UUID from state.json
  let fullUuid = uuidInput;
  if (uuidInput.length < 36) {
    try {
      // grep state.json directly
      const { stdout } = await execAsync(
        `python3 -c "import json,os; s=json.load(open(os.path.expanduser('~/.claude-chatlog-state.json'))); [print(k) for k in s if k.startswith('${uuidInput}')]"`,
        { timeout: 5000, shell: "/bin/zsh" }
      );
      const candidates = stdout.trim().split("\n").filter(Boolean);
      if (candidates.length === 1) {
        fullUuid = candidates[0]!;
      } else if (candidates.length > 1) {
        await ctx.reply(`⚠️ 複数候補:\n${candidates.map(c => `<code>${c}</code>`).join("\n")}`, { parse_mode: "HTML" });
        return;
      } else {
        await ctx.reply(`❌ UUID not found: ${uuidInput}`);
        return;
      }
    } catch {
      // Fall through with original input
    }
  }

  const statusMsg = await ctx.reply("⏳ 投稿中...");

  try {
    const b64 = Buffer.from(message).toString("base64");
    const tmpFile = `/tmp/askuuid-msg-${Date.now()}.txt`;
    await execAsync(`echo '${b64}' | base64 -d > '${tmpFile}'`, { shell: "/bin/zsh" });

    const result = await runScript(`post-uuid '${fullUuid}' "$(cat '${tmpFile}')"`, 200000);
    await execAsync(`rm -f '${tmpFile}'`);

    if (!result.ok) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `❌ ${result.error || "投稿失敗"}`);
      return;
    }

    const chatTitle = result.chat_title || fullUuid.substring(0, 8);
    const response = result.response || "(空の応答)";
    const model = result.model || "?";

    const header = `💬 <b>${escapeHtml(truncate(chatTitle, 40))}</b> (${escapeHtml(model)})`;
    const djLine = `&gt; DJ: ${escapeHtml(truncate(message, 100))}`;
    const body = truncate(response, 3800 - header.length - djLine.length);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `${header}\n${djLine}\n\n${body}`,
      { parse_mode: "HTML" }
    );
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ ${escapeHtml(truncate(e.message || String(e), 300))}`
    ).catch(() => {});
  }
}

/**
 * /newdomain <m_number> <description>
 * Create a new domain chat with Dropbox project folder injection
 */
export async function handleNewDomain(ctx: any): Promise<void> {
  const text = ctx.message?.text || "";
  const raw = text.replace(/^\/newdomain\s*/, "").trim();
  // Support: /newdomain m1322 desc  OR  /newdomain M1322_desc_here
  let domain = "";
  let desc = "";
  const m = raw.match(/^(m\d+)[_\s]+(.+)/i);
  if (m) { domain = m[1].toLowerCase(); desc = m[2].replace(/_/g, " "); }
  
  if (!domain || !desc) {
    await ctx.reply("Usage: /newdomain m1322 " + String.fromCharCode(37117,27231,24037));
    return;
  }
  
  // domain already set above
  // desc already set above
  const statusMsg = await ctx.reply("Creating domain chat: " + domain + " (" + desc + ")...");
  
  try {
    const SCRIPTS = process.env.HOME + "/claude-telegram-bot/scripts";
    const { stdout, stderr } = await execAsync(
      "python3 " + SCRIPTS + "/chat-bulk-create.py --new " + domain + " " + JSON.stringify(desc),
      { timeout: 30000, shell: "/bin/zsh", env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:" + process.env.PATH } }
    );
    const output = (stdout || "") + (stderr || "");
    const urlMatch = output.match(/https:\/\/claude\.ai\/chat\/[a-f0-9-]+/);
    if (urlMatch) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
        domain + " created\n" + urlMatch[0]);
    } else {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
        output.substring(0, 500));
    }
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
      "ERROR: " + (e.message || String(e)).substring(0, 300)).catch(() => {});
  }
}
