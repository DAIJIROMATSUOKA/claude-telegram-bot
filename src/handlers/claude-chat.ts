import { exec } from "child_process";
import { waitAndRelayResponse } from "./croppy-bridge";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Context } from "grammy";

const execAsync = promisify(exec);

const HOME = process.env.HOME || "/Users/daijiromatsuokam1";
const SCRIPTS_DIR = `${HOME}/claude-telegram-bot/scripts`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const CHAT_MAP_FILE = "/tmp/croppy-chat-map.json";

interface ChatEntry {
  wt: string;
  createdAt: string;   // YYYY-MM-DD_HHmm (JST)
  title: string | null; // null = not yet confirmed from claude.ai
  notifMsgId: number;  // Telegram msg id of the /chat status message
}

// telegram_msg_id -> ChatEntry
const chatReplyMap = new Map<number, ChatEntry>();

const DEFAULT_TITLE_RE = /^(Jarvis|New conversation|新しい会話|Claude|Untitled|Loading|claude\.ai|\s*)$/i;

function isDefaultTitle(t: string): boolean {
  return DEFAULT_TITLE_RE.test(t.trim());
}

function formatTitle(createdAt: string, autoTitle: string): string {
  return `${createdAt}_${autoTitle.trim()}`;
}

function loadChatMap(): void {
  try {
    if (existsSync(CHAT_MAP_FILE)) {
      const data = JSON.parse(readFileSync(CHAT_MAP_FILE, "utf-8")) as Record<string, any>;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") {
          // Legacy: string -> migrate to new format without wt/createdAt
          chatReplyMap.set(Number(k), { wt: "", createdAt: "", title: v, notifMsgId: Number(k) });
        } else {
          chatReplyMap.set(Number(k), v as ChatEntry);
        }
      }
      console.log(`[ClaudeChat] Loaded ${chatReplyMap.size} chat mappings`);
    }
  } catch (e) {
    console.warn("[ClaudeChat] Failed to load chat map:", e);
  }
}

function saveChatMap(): void {
  try {
    const obj: Record<string, ChatEntry> = {};
    for (const [k, v] of chatReplyMap) obj[String(k)] = v;
    writeFileSync(CHAT_MAP_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn("[ClaudeChat] Failed to save chat map:", e);
  }
}

loadChatMap();

async function runLocal(cmd: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      shell: "/bin/zsh",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      },
    });
    return stdout.trim();
  } catch (e: any) {
    return `ERROR: ${e.stderr || e.message || String(e)}`;
  }
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function writeTmpMsg(msg: string): Promise<string> {
  const tmp = `/tmp/croppy-chatmsg-${Date.now()}.txt`;
  const b64 = Buffer.from(msg).toString("base64");
  await runLocal(`echo \'${b64}\' | base64 -d > ${tmp}`);
  return tmp;
}

/**
 * Try to confirm title from the tab. If confirmed, update document.title and
 * edit the Telegram notification. Returns the confirmed title or null.
 */
async function tryConfirmTitle(entry: ChatEntry, chatId: number, api: any): Promise<string | null> {
  if (!entry.wt || !entry.createdAt) return null;

  const raw = await runLocal(`bash "${TAB_MANAGER}" get-title "${entry.wt}"`, 8000);
  if (!raw || raw.startsWith("ERROR") || isDefaultTitle(raw)) return null;

  const formatted = formatTitle(entry.createdAt, raw);

  // Set document.title in Chrome tab
  const escapedFormatted = formatted.replace(/\'/g, "'\''");
  await runLocal(`bash "${TAB_MANAGER}" set-title "${entry.wt}" \'${escapedFormatted}\'`, 8000);

  // Edit the original Telegram notification
  try {
    await api.editMessageText(
      chatId, entry.notifMsgId,
      `💬 <b>${escapeHtml(formatted)}</b>\n<code>${escapeHtml(entry.wt)}</code>\n\nこのメッセージにリプライで続けて投稿できます。`,
      { parse_mode: "HTML" }
    );
  } catch (_) { /* ignore if already edited */ }

  return formatted;
}

/**
 * /chat <message>
 */
export async function handleChatCommand(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const message = text.replace(/^\/chat\s*/, "").trim();

  if (!message) {
    await ctx.reply("Usage: /chat <message>\n例: /chat 新しいタスクについて話したい");
    return;
  }

  const statusMsg = await ctx.reply("💬 新しいチャットを開いています...");

  try {
    const tmp = await writeTmpMsg(message);
    const result = await runLocal(
      `bash "${TAB_MANAGER}" new-chat "$(cat ${tmp})"; rm -f ${tmp}`,
      90000
    );

    const createdAtMatch = result.match(/^CREATED_AT:\s*(.+)$/m);
    const wtMatch = result.match(/^WT:\s*(.+)$/m);

    if (!wtMatch || result.startsWith("ERROR")) {
      await ctx.api.editMessageText(
        ctx.chat!.id, statusMsg.message_id,
        `❌ チャット作成失敗\n<code>${escapeHtml(result.substring(0, 300))}</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const wt = wtMatch[1]!.trim();
    const createdAt = (createdAtMatch?.[1] || "").trim();
    const pendingTitle = createdAt ? `${createdAt}_???` : "???" ;

    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `💬 <b>${escapeHtml(pendingTitle)}</b>\n<code>${escapeHtml(wt)}</code>\n\nこのメッセージにリプライで続けて投稿できます。`,
      { parse_mode: "HTML" }
    );

    const entry: ChatEntry = { wt, createdAt, title: null, notifMsgId: statusMsg.message_id };
    chatReplyMap.set(statusMsg.message_id, entry);
    saveChatMap();
    // Relay initial response back to Telegram
    waitAndRelayResponse(ctx, wt, 180000).catch(e =>
      console.error("[ClaudeChat] initial waitAndRelayResponse error:", e)
    );
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `❌ エラー: ${escapeHtml(String(e.message || e))}`,
      { parse_mode: "HTML" }
    );
  }
}

/**
 * /post <partial_title> <message>
 */
export async function handlePostCommand(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.replace(/^\/post\s*/, "").trim();
  const spaceIdx = args.indexOf(" ");

  if (spaceIdx === -1) {
    await ctx.reply("Usage: /post <chat_name> <message>\n例: /post 設計 フォローアップのメモ");
    return;
  }

  const chatName = args.substring(0, spaceIdx).trim();
  const message = args.substring(spaceIdx + 1).trim();

  const tmp = await writeTmpMsg(message);
  const escapedName = chatName.replace(/"/g, '\\"');
  const result = await runLocal(
    `bash "${TAB_MANAGER}" inject-by-title "${escapedName}" "$(cat ${tmp})"; rm -f ${tmp}`,
    20000
  );

  if (result.includes("NOT_FOUND")) {
    await ctx.reply(
      `❌ チャットが見つかりません: <b>${escapeHtml(chatName)}</b>\n<code>/chats</code> で一覧確認`,
      { parse_mode: "HTML" }
    );
  } else if (result.includes("INSERTED:SENT")) {
    await ctx.reply(`✅ → <b>${escapeHtml(chatName)}</b>`, { parse_mode: "HTML" });
  } else {
    await ctx.reply(
      `❌ エラー: <code>${escapeHtml(result.substring(0, 200))}</code>`,
      { parse_mode: "HTML" }
    );
  }
}

/**
 * /chats — List open claude.ai tabs
 */
export async function handleChatsCommand(ctx: Context): Promise<void> {
  const result = await runLocal(`bash "${TAB_MANAGER}" list-all`, 10000);

  if (!result || result.startsWith("ERROR")) {
    await ctx.reply("❌ Chrome未起動またはエラー");
    return;
  }

  const lines = result.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    await ctx.reply("claude.aiタブなし");
    return;
  }

  let msg = "📑 <b>Open claude.ai tabs:</b>\n\n";
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    const wt = parts[0] || "";
    const title = parts[1] || "Untitled";
    const isWorker = title.includes("[J-WORKER");
    msg += `${isWorker ? "🤖" : "💬"} <code>${escapeHtml(wt)}</code> ${escapeHtml(title)}\n`;
  }

  await ctx.reply(msg, { parse_mode: "HTML" });
}

/**
 * Reply intercept — route replies to /chat notifications into the correct tab.
 * On first reply: try to confirm title from claude.ai.
 */
export async function handleChatReply(ctx: Context): Promise<boolean> {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return false;

  const entry = chatReplyMap.get(replyToId);
  if (!entry) return false;

  const rawMessage = ctx.message?.text || "";
  if (!rawMessage || rawMessage.startsWith("/")) return false;

  // Try to confirm title on first reply (title === null)
  let displayTitle = entry.title;
  if (!entry.title) {
    const confirmed = await tryConfirmTitle(entry, ctx.chat!.id, ctx.api);
    if (confirmed) {
      entry.title = confirmed;
      displayTitle = confirmed;
      saveChatMap();
    } else {
      displayTitle = entry.createdAt ? `${entry.createdAt}_???` : "???";
    }
  }

  const injectTitle = entry.title || (entry.createdAt ? `${entry.createdAt}_???` : "");
  const tmp = await writeTmpMsg(rawMessage);
  const escapedTitle = injectTitle.replace(/"/g, '\\"');
  const result = await runLocal(
    `bash "${TAB_MANAGER}" inject-by-title "${escapedTitle}" "$(cat ${tmp})"; rm -f ${tmp}`,
    20000
  );

  if (result.includes("INSERTED:SENT")) {
    const sentMsg = await ctx.reply(
      `✅ → <b>${escapeHtml(displayTitle || injectTitle)}</b>`,
      { parse_mode: "HTML" }
    );
    // Chain: replies to confirmation also route to same chat
    chatReplyMap.set(sentMsg.message_id, { ...entry, notifMsgId: sentMsg.message_id });
    saveChatMap();
    // Relay claude.ai response back to Telegram
    waitAndRelayResponse(ctx, entry.wt, 180000).catch(e =>
      console.error("[ClaudeChat] waitAndRelayResponse error:", e)
    );
  } else if (result.includes("NOT_FOUND")) {
    await ctx.reply(
      `❌ タブが閉じられています: <b>${escapeHtml(displayTitle || injectTitle)}</b>\n<code>/chats</code> で確認`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `❌ <code>${escapeHtml(result.substring(0, 200))}</code>`,
      { parse_mode: "HTML" }
    );
  }

  return true;
}
