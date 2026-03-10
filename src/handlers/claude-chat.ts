import { exec } from "child_process";
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
  createdAt: string;        // YYYY-MM-DD_HHmm (JST)
  title: string | null;     // null = not yet confirmed from claude.ai
  notifMsgId: number;       // current reply-target message ID
  lastResponseMsgId?: number; // previous response msg to delete on next reply
  convUrl?: string;         // claude.ai conversation URL for auto-reopen
}

// telegram_msg_id -> ChatEntry
const chatReplyMap = new Map<number, ChatEntry>();

const DEFAULT_TITLE_RE = /^(Jarvis|New conversation|新しい会話|Claude|Untitled|Loading|claude\.ai|\s*)$/i;

function isDefaultTitle(t: string): boolean {
  return DEFAULT_TITLE_RE.test(t.trim());
}

function formatTitle(createdAt: string, autoTitle: string): string {
  const cleaned = autoTitle.trim()
    .replace(/^\[J-WORKER-\d+\]\s*/i, "")
    .replace(/\s*-\s*Claude\s*$/i, "")
    .trim();
  return `${createdAt}_${cleaned || autoTitle.trim()}`;
}

function loadChatMap(): void {
  try {
    if (existsSync(CHAT_MAP_FILE)) {
      const data = JSON.parse(readFileSync(CHAT_MAP_FILE, "utf-8")) as Record<string, any>;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") {
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
  await runLocal(`echo '${b64}' | base64 -d > ${tmp}`);
  return tmp;
}

/**
 * Wait for claude.ai tab to finish responding and return cleaned text.
 */
async function waitForChatResponse(wt: string, maxWaitMs = 180000): Promise<string | null> {
  const pollInterval = 3000;
  const startTime = Date.now();

  await new Promise(r => setTimeout(r, 3000)); // wait for response to start

  while (Date.now() - startTime < maxWaitMs) {
    const status = await runLocal(`bash "${TAB_MANAGER}" check-status ${wt}`, 10000);

    if (status.trim() === "READY") {
      await new Promise(r => setTimeout(r, 1500)); // settle
      const response = await runLocal(`bash "${TAB_MANAGER}" read-response ${wt}`, 10000);

      if (!response || response.includes("NO_RESPONSE") || response.includes("ERROR")) {
        return null;
      }

      // Remove UI-generated duplicate first line
      const lines = response.split("\n");
      const nonEmpty = lines.map((l, i) => ({ l, i })).filter(x => x.l.trim() !== "");
      return (nonEmpty.length >= 2 && nonEmpty[0]!.l.trim() === nonEmpty[1]!.l.trim())
        ? lines.slice(nonEmpty[1]!.i).join("\n").trimStart()
        : response;
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  return null; // timeout
}

/**
 * Confirm title from claude.ai tab, update document.title.
 * Returns confirmed formatted title or null.
 */
async function tryConfirmTitle(entry: ChatEntry): Promise<string | null> {
  if (!entry.wt || !entry.createdAt) return null;

  const raw = await runLocal(`bash "${TAB_MANAGER}" get-title "${entry.wt}"`, 8000);
  if (!raw || raw.startsWith("ERROR") || isDefaultTitle(raw)) return null;

  const formatted = formatTitle(entry.createdAt, raw);
  const escapedFormatted = formatted.replace(/'/g, "'\\''");
  await runLocal(`bash "${TAB_MANAGER}" set-title "${entry.wt}" '${escapedFormatted}'`, 8000);
  await runLocal(`bash "${TAB_MANAGER}" rename-conversation "${entry.wt}" '${escapedFormatted}'`, 10000);

  return formatted;
}

/**
 * Delete a Telegram message silently (ignore errors).
 */
async function tryDeleteMsg(ctx: Context, msgId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(ctx.chat!.id, msgId);
  } catch (_) { /* ignore */ }
}

/**
 * Send formatted response message and register it as new reply target.
 * Format: 💬 {title}\n> DJ: {djMsg}\n\n{response}
 */
async function sendResponseMsg(
  ctx: Context,
  entry: ChatEntry,
  djMsg: string,
  responseText: string
): Promise<number> {
  const title = entry.title || (entry.createdAt ? `${entry.createdAt}_???` : "???");
  const header = `💬 <b>${escapeHtml(title)}</b>\n&gt; DJ: ${escapeHtml(djMsg)}`;

  const maxBody = 4000 - header.length - 4;
  const body = responseText.length > maxBody
    ? responseText.substring(0, maxBody) + "…"
    : responseText;

  const sent = await ctx.reply(`${header}\n\n${body}`, { parse_mode: "HTML" });
  return sent.message_id;
}

/**
 * Reopen a closed conversation tab and inject message.
 * Returns new W:T or null on failure.
 */
async function reopenAndInject(convUrl: string, message: string): Promise<string | null> {
  const tmp = await writeTmpMsg(message);
  const result = await runLocal(
    `bash "${TAB_MANAGER}" reopen-and-inject "${convUrl}" "$(cat ${tmp})"; rm -f ${tmp}`,
    60000
  );
  const wtMatch = result.match(/^WT:\s*(\S+)/m);
  if (!wtMatch || !result.includes("INSERTED:SENT")) return null;
  return wtMatch[1]!.trim();
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

  const statusMsg = await ctx.reply("⏳ 送信中...");

  try {
    const tmp = await writeTmpMsg(message);
    const result = await runLocal(
      `bash "${TAB_MANAGER}" new-chat "$(cat ${tmp})"; rm -f ${tmp}`,
      90000
    );

    const createdAtMatch = result.match(/^CREATED_AT:\s*(.+)$/m);
    const wtMatch = result.match(/^WT:\s*(.+)$/m);
    const convUrlMatch = result.match(/^CONV_URL:\s*(.+)$/m);

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

    const convUrl = (convUrlMatch?.[1] || "").trim();
    const entry: ChatEntry = { wt, createdAt, title: null, notifMsgId: statusMsg.message_id, convUrl };
    chatReplyMap.set(statusMsg.message_id, entry);
    saveChatMap();

    // Delete DJ's /chat command message
    await tryDeleteMsg(ctx, ctx.message!.message_id);

    // Fire-and-forget: wait for response → delete ⏳ → send formatted response
    (async () => {
      const responseText = await waitForChatResponse(wt, 180000);

      // Confirm title after response
      const confirmed = await tryConfirmTitle(entry);
      if (confirmed) {
        entry.title = confirmed;
      }

      // Delete ⏳ message
      await tryDeleteMsg(ctx, statusMsg.message_id);
      chatReplyMap.delete(statusMsg.message_id);

      if (!responseText) {
        const timeoutMsg = await ctx.reply("⏱ 応答タイムアウト (3分)");
        chatReplyMap.set(timeoutMsg.message_id, { ...entry, notifMsgId: timeoutMsg.message_id });
        saveChatMap();
        return;
      }

      const responseMsgId = await sendResponseMsg(ctx, entry, message, responseText);
      entry.notifMsgId = responseMsgId;
      chatReplyMap.set(responseMsgId, entry);
      saveChatMap();
    })().catch(e => console.error("[ClaudeChat] handleChatCommand async error:", e));

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
    const wtMatch = result.match(/WT:\s*(\S+)/);
    const wt = wtMatch?.[1] || "";
    if (wt) {
      await tryDeleteMsg(ctx, ctx.message!.message_id);
      const waitMsg = await ctx.reply("⏳ 送信中...");
      (async () => {
        const responseText = await waitForChatResponse(wt, 180000);
        await tryDeleteMsg(ctx, waitMsg.message_id);
        if (!responseText) {
          await ctx.reply("⏱ 応答タイムアウト (3分)");
          return;
        }
        let entry = [...chatReplyMap.values()].find(e => e.wt === wt);
        if (!entry) entry = { wt, createdAt: "", title: chatName, notifMsgId: 0 };
        const responseMsgId = await sendResponseMsg(ctx, entry, message, responseText);
        entry.notifMsgId = responseMsgId;
        chatReplyMap.set(responseMsgId, entry);
        saveChatMap();
      })().catch(e => console.error("[ClaudeChat] post relay error:", e));
    } else {
      await ctx.reply(`✅ → <b>${escapeHtml(chatName)}</b>`, { parse_mode: "HTML" });
    }
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
 * Reply intercept — route replies to chat response messages into the correct tab.
 */
export async function handleChatReply(ctx: Context): Promise<boolean> {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return false;

  const entry = chatReplyMap.get(replyToId);
  if (!entry) return false;

  const rawMessage = ctx.message?.text || "";
  if (!rawMessage || rawMessage.startsWith("/")) return false;

  // Try to confirm title if not yet set
  if (!entry.title) {
    const confirmed = await tryConfirmTitle(entry);
    if (confirmed) {
      entry.title = confirmed;
      saveChatMap();
    }
  }

  const injectTitle = entry.title || (entry.createdAt ? `${entry.createdAt}_???` : "");
  const tmp = await writeTmpMsg(rawMessage);
  const escapedTitle = injectTitle.replace(/"/g, '\\"');
  const result = await runLocal(
    `bash "${TAB_MANAGER}" inject-by-title "${escapedTitle}" "$(cat ${tmp})"; rm -f ${tmp}`,
    20000
  );

  if (!result.includes("INSERTED:SENT")) {
    if (result.includes("NOT_FOUND") && entry.convUrl) {
      // Auto-reopen closed tab
      const waitMsg = await ctx.reply("🔄 タブ再オープン中...");
      const newWt = await reopenAndInject(entry.convUrl, rawMessage);
      if (newWt) {
        entry.wt = newWt;
        saveChatMap();
        await tryDeleteMsg(ctx, waitMsg.message_id);
        // Fall through to response relay below
        const responseText2 = await waitForChatResponse(newWt, 180000);
        await tryDeleteMsg(ctx, replyToId);
        chatReplyMap.delete(replyToId);
        if (!responseText2) {
          const tm = await ctx.reply("⏱ 応答タイムアウト (3分)");
          chatReplyMap.set(tm.message_id, { ...entry, notifMsgId: tm.message_id });
          saveChatMap();
          return true;
        }
        const rMsgId = await sendResponseMsg(ctx, entry, rawMessage, responseText2);
        entry.notifMsgId = rMsgId;
        chatReplyMap.set(rMsgId, entry);
        saveChatMap();
        return true;
      } else {
        await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id,
          `❌ 再オープン失敗: <b>${escapeHtml(injectTitle)}</b>`, { parse_mode: "HTML" });
      }
    } else if (result.includes("NOT_FOUND")) {
      await ctx.reply(
        `❌ タブが閉じられています: <b>${escapeHtml(injectTitle)}</b>\n<code>/chats</code> で確認`,
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

  // Delete DJ's reply message
  await tryDeleteMsg(ctx, ctx.message!.message_id);

  // Show ⏳ and fire-and-forget response relay
  const waitMsg = await ctx.reply("⏳ 送信中...");
  const prevResponseMsgId = replyToId; // the message DJ replied to

  (async () => {
    const responseText = await waitForChatResponse(entry.wt, 180000);

    // Delete ⏳
    await tryDeleteMsg(ctx, waitMsg.message_id);
    // Delete previous response message
    await tryDeleteMsg(ctx, prevResponseMsgId);
    chatReplyMap.delete(prevResponseMsgId);

    if (!responseText) {
      const timeoutMsg = await ctx.reply("⏱ 応答タイムアウト (3分)");
      chatReplyMap.set(timeoutMsg.message_id, { ...entry, notifMsgId: timeoutMsg.message_id });
      saveChatMap();
      return;
    }

    const responseMsgId = await sendResponseMsg(ctx, entry, rawMessage, responseText);
    entry.notifMsgId = responseMsgId;
    chatReplyMap.set(responseMsgId, entry);
    saveChatMap();
  })().catch(e => console.error("[ClaudeChat] handleChatReply async error:", e));

  return true;
}
