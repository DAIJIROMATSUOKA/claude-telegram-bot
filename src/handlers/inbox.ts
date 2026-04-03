/**
 * Inbox Handler - Telegram Inbox Zero
 * Processes inline button callbacks (archive/delete/full/reply/snooze)
 * Auto-deletes notification messages after action completion
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { archiveToObsidian } from "../services/obsidian-writer";

// ============================================================
// Batch Action Queue - 3s debounce for all destructive actions
// ============================================================
interface BatchEntry {
  action: string;
  msgId: number;
  sourceId: string;
  msgText: string;
  msgDate?: number;
  replyToMsgId?: number;
  replyMarkup?: string;
  hours?: number;
}
interface BatchQueue {
  entries: BatchEntry[];
  timer: ReturnType<typeof setTimeout>;
  botApi: any;
}
const batchQueue = new Map<number, BatchQueue>();
const BATCH_DELAY = 3000;

function queueBatchAction(chatId: number, entry: BatchEntry, botApi: any): number {
  let q = batchQueue.get(chatId);
  if (q) {
    clearTimeout(q.timer);
    q.entries.push(entry);
  } else {
    q = { entries: [entry], timer: null as any, botApi };
    batchQueue.set(chatId, q);
  }
  q.timer = setTimeout(() => executeBatch(chatId), BATCH_DELAY);
  return q.entries.length;
}

async function executeBatch(chatId: number): Promise<void> {
  const q = batchQueue.get(chatId);
  if (!q) return;
  batchQueue.delete(chatId);
  const count = q.entries.length;
  console.log("[Batch] Executing: " + count + " actions in chat " + chatId);

  for (const e of q.entries) {
    try {
      switch (e.action) {
        case "del":
          await q.botApi.deleteMessage(chatId, e.msgId);
          break;

        case "delmemo":
          await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          if (e.replyToMsgId) await q.botApi.deleteMessage(chatId, e.replyToMsgId).catch(() => {});
          break;

        case "archive":
        case "trash": {
          const url = `${GAS_GMAIL_URL}?action=${e.action}&gmail_id=${e.sourceId}&key=${GAS_GMAIL_KEY}`;
          const res = await fetch(url, { redirect: "follow" });
          const result: any = await res.json();
          if (result.ok) {
            logInboxAction(e.action, e.sourceId, "gmail", e.msgDate);
            await archiveToObsidian(e.msgId, chatId, "in", "gmail", e.msgText, e.action);
            await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          } else {
            console.error("[Batch] " + e.action + " failed: " + e.sourceId);
          }
          break;
        }

        case "snz1h":
        case "snz3h":
        case "snzam": {
          const hours = e.action === "snz1h" ? 1 : e.action === "snz3h" ? 3 : 0;
          const until = hours > 0
            ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
            : (() => { const t = new Date(); t.setHours(t.getHours() + 9); t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0); return new Date(t.getTime() - 9 * 60 * 60 * 1000).toISOString(); })();

          logInboxAction("snooze", e.sourceId, "gmail", e.msgDate);
          try {
            let mappingId: number | null = null;
            const existing = await gatewayQuery(
              "SELECT id FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
              [e.msgId, chatId]
            );
            if (existing?.results?.[0]) {
              mappingId = existing.results[0].id as number;
              await gatewayQuery("UPDATE message_mappings SET snoozed_until = ? WHERE id = ?", [until, mappingId]);
            } else {
              const ins = await gatewayQuery(
                "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, snoozed_until) VALUES (?, ?, 'gmail', ?, ?) RETURNING id",
                [e.msgId, chatId, e.sourceId, until]
              );
              mappingId = ins?.results?.[0]?.id as number;
            }
            await gatewayQuery(
              "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
              [mappingId || 0, JSON.stringify({ text: e.msgText, reply_markup: e.replyMarkup }), until]
            );
          } catch (err) {
            console.error("[Batch] Snooze store error:", err);
          }
          await q.botApi.deleteMessage(chatId, e.msgId).catch(() => {});
          break;
        }
      }
    } catch (err) {
      console.error("[Batch] Action error:", e.action, err);
    }
  }
}
import { gatewayQuery } from "../services/gateway-db";

// GAS Web App URL (set in .env)
const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || "";
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || "";

/**
 * Log inbox action to D1 for learning/scoring (non-blocking)
 */
async function logInboxAction(
  action: string,
  sourceId: string,
  source: string = "gmail",
  msgDate?: number
): Promise<void> {
  try {
    const mapping = await gatewayQuery(
      "SELECT source_detail FROM message_mappings WHERE source = ? AND source_id = ? LIMIT 1",
      [source, sourceId]
    );
    const detail = mapping?.results?.[0]?.source_detail;
    const parsed = detail ? JSON.parse(String(detail)) : {};
    const from = parsed.from || parsed.sender_name || "";
    const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\\s]+@[^\\s]+)/);
    const email = emailMatch ? emailMatch[1] : from;
    const domain = email.match(/@(.+)/)?.[1] || "";
    const responseSec = msgDate ? Math.floor(Date.now() / 1000 - msgDate) : null;

    await gatewayQuery(
      "INSERT INTO inbox_actions (source, sender_email, sender_domain, action, response_seconds, gmail_msg_id) VALUES (?, ?, ?, ?, ?, ?)",
      [source, email, domain, action, responseSec, sourceId]
    );
  } catch (e) {
    console.error("[Inbox] Action log error:", e);
  }
}


/**
 * Handle inbox callback queries (ib:action:id)
 */
export async function handleInboxCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("ib:")) return false;

  const userId = ctx.from?.id;
  if (!userId || !isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.answerCallbackQuery({ text: "Unauthorized" });
    return true;
  }

  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: "Invalid callback" });
    return true;
  }

  const action = parts[1];
  const sourceId = parts.slice(2).join(":"); // gmail_id might contain colons
  const msgId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.chat?.id;

  try {
    switch (action) {
      case "archive": {
        if (chatId && msgId) {
          const count = queueBatchAction(chatId, { action: "archive", msgId, sourceId, msgText: ctx.callbackQuery?.message?.text || "", msgDate: ctx.callbackQuery?.message?.date }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "✉ アーカイブ予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "trash": {
        if (chatId && msgId) {
          const count = queueBatchAction(chatId, { action: "trash", msgId, sourceId, msgText: ctx.callbackQuery?.message?.text || "", msgDate: ctx.callbackQuery?.message?.date }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "🗑 ゴミ箱予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "full":
        await handleFullText(ctx, sourceId);
        break;
      case "attach":
        await handleAttachments(ctx, sourceId);
        break;
      case "reply":
        await handleReplyPrompt(ctx, sourceId, msgId);
        break;
      case "lnrpl":
        await handleLineReplyPrompt(ctx, sourceId, msgId);
        break;
      case "imrpl":
        await handleImessageReplyPrompt(ctx, sourceId, msgId);
        break;
      case "draft":
        await handleAiDraft(ctx, sourceId, msgId);
        break;
      case "del": {
        if (chatId && msgId) {
          const count = queueBatchAction(chatId, { action: "del", msgId, sourceId, msgText: "" }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "🗑 削除予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "delmemo": {
        if (chatId && msgId) {
          const replyTo = ctx.callbackQuery?.message?.reply_to_message?.message_id;
          const count = queueBatchAction(chatId, { action: "delmemo", msgId, sourceId, msgText: "", replyToMsgId: replyTo }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "🗑 削除予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "todo": {
        // 1-click Todoist task creation from Telegram notification
        try {
          const msgText = ctx.callbackQuery?.message?.text || "";
          const lines = msgText.split("\n").filter((l: string) => l.trim());
          const taskContent = (lines.find((l: string) => l.length > 5) || lines[0] || "Telegram task").substring(0, 200);

          // Calculate next :00 or :30 in JST
          const now = new Date();
          const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
          const jst = new Date(jstMs);
          const min = jst.getUTCMinutes();
          if (min < 30) {
            jst.setUTCMinutes(30, 0, 0);
          } else {
            jst.setUTCMinutes(0, 0, 0);
            jst.setUTCHours(jst.getUTCHours() + 1);
          }
          const y = jst.getUTCFullYear();
          const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
          const d = String(jst.getUTCDate()).padStart(2, "0");
          const h = String(jst.getUTCHours()).padStart(2, "0");
          const mi = String(jst.getUTCMinutes()).padStart(2, "0");
          const dueString = `${y}-${mo}-${d} ${h}:${mi}`;

          const os = await import("os");
          const fs = await import("fs");
          const { join } = await import("path");
          const configPath = join(os.homedir(), ".claude", "jarvis_config.json");
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          const apiToken = config.rules?.todoist?.api_token;
          if (!apiToken) throw new Error("Todoist token not found");

          const res = await fetch("https://api.todoist.com/api/v1/tasks", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content: taskContent, due_string: dueString }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          if (chatId && msgId) {
            try { await ctx.api.deleteMessage(chatId, msgId); } catch {}
          }
          await ctx.answerCallbackQuery({ text: `\u{1F4CB} ${h}:${mi} \u30BF\u30B9\u30AF\u5316`, show_alert: false });
        } catch (e: any) {
          await ctx.answerCallbackQuery({ text: `\u274C ${(e as Error).message || "\u30BF\u30B9\u30AF\u5316\u5931\u6557"}`, show_alert: true });
        }
        break;
      }

            case "snz1h": {
        if (chatId && msgId) {
          const origMsg = ctx.callbackQuery?.message;
          const rm = origMsg && "reply_markup" in origMsg ? JSON.stringify((origMsg as any).reply_markup) : null;
          const count = queueBatchAction(chatId, { action: "snz1h", msgId, sourceId, msgText: origMsg?.text || "", msgDate: origMsg?.date, replyMarkup: rm || undefined, hours: 1 }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "⏰ 1hスヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "snz3h": {
        if (chatId && msgId) {
          const origMsg = ctx.callbackQuery?.message;
          const rm = origMsg && "reply_markup" in origMsg ? JSON.stringify((origMsg as any).reply_markup) : null;
          const count = queueBatchAction(chatId, { action: "snz3h", msgId, sourceId, msgText: origMsg?.text || "", msgDate: origMsg?.date, replyMarkup: rm || undefined, hours: 3 }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "⏰ 3hスヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      case "snzam": {
        if (chatId && msgId) {
          const origMsg = ctx.callbackQuery?.message;
          const rm = origMsg && "reply_markup" in origMsg ? JSON.stringify((origMsg as any).reply_markup) : null;
          const count = queueBatchAction(chatId, { action: "snzam", msgId, sourceId, msgText: origMsg?.text || "", msgDate: origMsg?.date, replyMarkup: rm || undefined }, ctx.api);
          try { await ctx.answerCallbackQuery({ text: "⏰ 明朝スヌーズ予約 (" + count + "件)", show_alert: false }); } catch {}
        }
        break;
      }
      default:
        await ctx.answerCallbackQuery({ text: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error("[Inbox] Callback error:", error);
    await ctx.answerCallbackQuery({ text: "❌ エラー発生" });
  }

  return true;
}

/**
 * Gmail archive/trash → GAS Web App → auto-delete notification
 */
async function handleGmailAction(
  ctx: Context,
  action: string,
  gmailId: string,
  msgId?: number,
  chatId?: number
): Promise<void> {
  await ctx.answerCallbackQuery({ text: `⏳ ${action}...` });

  const url = `${GAS_GMAIL_URL}?action=${action}&gmail_id=${gmailId}&key=${GAS_GMAIL_KEY}`;
  const res = await fetch(url, { redirect: "follow" });
  const result: any = await res.json();

  if (result.ok) {
    // Log action for Inbox Learning
    const msgDate = ctx.callbackQuery?.message?.date;
    logInboxAction(action, gmailId, "gmail", msgDate);

    // Archive to Obsidian before deleting
    const msgText = ctx.callbackQuery?.message?.text || "(no text)";
    await archiveToObsidian(msgId, chatId, "in", "gmail", msgText, action);

    // Delete the notification message (Inbox Zero!)
    if (msgId && chatId) {
      try {
        await ctx.api.deleteMessage(chatId, msgId);
      } catch (e) {
        // Message might already be deleted
        console.log("[Inbox] Delete failed (already deleted?):", e);
      }
    }
  } else {
    await ctx.reply(`❌ ${action}失敗: ${result.error || "unknown"}`);
  }
}

/**
 * Full text: fetch from GAS and send as reply
 */
/**
 * Fetch and list Gmail attachments with download info
 */
async function handleAttachments(ctx: Context, gmailId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: "📎 添付取得中..." });
  const url = `${GAS_GMAIL_URL}?action=full&gmail_id=${gmailId}&key=${GAS_GMAIL_KEY}`;
  const res = await fetch(url, { redirect: "follow" });
  const result: any = await res.json();
  if (result.ok && result.attachments?.length > 0) {
    const list = result.attachments
      .map((a: any, i: number) => `${i + 1}. 📎 ${a.name} (${a.mimeType}, ${Math.round((a.size || 0) / 1024)}KB)`)
      .join("\n");
    await ctx.reply(
      `📎 添付ファイル一覧:\n${list}\n\n📱 Gmailアプリで開いてダウンロードしてください。`,
      {
        parse_mode: "HTML",
        reply_to_message_id: ctx.callbackQuery?.message?.message_id,
      }
    );
  } else {
    await ctx.reply("📎 添付ファイルなし");
  }
}

async function handleFullText(ctx: Context, gmailId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: "📖 全文取得中..." });

  const url = `${GAS_GMAIL_URL}?action=full&gmail_id=${gmailId}&key=${GAS_GMAIL_KEY}`;
  const res = await fetch(url, { redirect: "follow" });
  const result: any = await res.json();

  if (result.ok) {
    // Log read action for Inbox Learning
    logInboxAction("read", gmailId, "gmail", ctx.callbackQuery?.message?.date);

    const attachInfo =
      result.attachments?.length > 0
        ? `\n\n📎 添付: ${result.attachments.map((a: any) => a.name).join(", ")}`
        : "";

    const text =
      `📧 <b>${escapeHtml(result.subject || "")}</b>\n` +
      `From: ${escapeHtml(result.from || "")}\n` +
      `To: ${escapeHtml(result.to || "")}\n` +
      (result.cc ? `CC: ${escapeHtml(result.cc)}\n` : "") +
      `Date: ${result.date}\n` +
      `${"─".repeat(20)}\n` +
      escapeHtml(result.body || "") +
      attachInfo;

    // Send as reply to the notification (4096 char limit)
    await ctx.reply(text.substring(0, 4000), {
      parse_mode: "HTML",
      reply_to_message_id: ctx.callbackQuery?.message?.message_id,
    });
  } else {
    await ctx.reply(`❌ 全文取得失敗: ${result.error || "unknown"}`);
  }
}

/**
 * Reply prompt: instruct user to quote-reply
 */
async function handleReplyPrompt(
  ctx: Context,
  gmailId: string,
  msgId?: number
): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "↩️ このメッセージに<b>引用リプライ</b>で返信内容を送信してください。\n" +
      "<i>テキストを入力 → 通知メッセージを長押し → Reply</i>",
    {
      parse_mode: "HTML",
      reply_to_message_id: msgId,
    }
  );
}

/**
 * Snooze: delete now, re-notify later
 */
/**
 * AI draft reply: generate a draft using Claude CLI (flat rate)
 */
async function handleAiDraft(
  ctx: Context,
  sourceId: string,
  msgId?: number
): Promise<void> {
  await ctx.answerCallbackQuery({ text: "✏️ AI下書き生成中..." });

  const originalText = ctx.callbackQuery?.message?.text || "";
  const caption = (ctx.callbackQuery?.message as any)?.caption || "";
  const msgContent = originalText || caption;

  if (!msgContent || msgContent.length < 5) {
    await ctx.reply("❌ メッセージ内容が取得できません", {
      reply_to_message_id: msgId,
    });
    return;
  }

  let senderName = "";
  try {
    const data = await gatewayQuery(
      "SELECT source, source_detail FROM message_mappings WHERE telegram_msg_id = ? ORDER BY created_at DESC LIMIT 1",
      [msgId]
    );
    if (data?.results?.[0]) {
      try {
        const detail = JSON.parse(data.results[0].source_detail || "{}");
        senderName = detail.sender_name || detail.from || "";
      } catch {}
    }
  } catch {}

  const draftMsg = await ctx.reply("✏️ AI下書き生成中...", {
    reply_to_message_id: msgId,
  });

  try {
    // Load staff context for tone/naming
    let staffContext = "";
    try {
      const ctxFile = Bun.file("config/staff-context.md");
      if (await ctxFile.exists()) staffContext = await ctxFile.text();
    } catch {}

    const isJapanese = /[぀-ゟ゠-ヿ一-龯]/.test(msgContent);
    const langHint = isJapanese ? "日本語" : "English";
    const prompt = [
      "以下のメッセージに対する返信の下書きを1つだけ書いてください。",
      "あなたは株式会社機械ラボのCEO松岡大次郎（DJ）として返信します。",
      staffContext ? "\nスタッフ情報:\n" + staffContext : "",
      `- ${langHint}で書いてください`,
      "- 簡潔でプロフェッショナルなトーンで",
      "- 挨拶と署名は不要",
      "- 下書き本文のみを出力（説明不要）",
      "",
      `送信者: ${senderName}`,
      "メッセージ:",
      msgContent.substring(0, 1500),
    ].join("\n");

    const tmpFile = "/tmp/ai-draft-prompt.txt";
    await Bun.write(tmpFile, prompt);

    const proc = Bun.spawn(
      ["bash", "-c", `cat ${tmpFile} | /opt/homebrew/bin/claude -p --model sonnet 2>/dev/null | head -100`],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:" + (process.env.PATH || "") },
      }
    );

    const timeout = setTimeout(() => proc.kill(), 30000);
    const exitCode = await proc.exited;
    clearTimeout(timeout);
    const stdout = await new Response(proc.stdout).text();

    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, draftMsg.message_id); } catch {}

    console.log("[AiDraft] exitCode=", exitCode, "stdout_len=", stdout.length, "stdout_start=", stdout.substring(0, 80));
    if (stdout.trim()) {
      const draft = stdout.trim();
      await ctx.reply(
        `✏️ <b>AI下書き:</b>\n\n${draft.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}`,
        {
          parse_mode: "HTML",
          reply_to_message_id: msgId,
        }
      );
    } else {
      console.error("[AiDraft] FAILED exitCode=", exitCode, "stdout=", stdout.substring(0, 200));
      await ctx.reply("❌ AI下書き生成失敗 (exit=" + exitCode + ")", { reply_to_message_id: msgId });
    }
  } catch (e) {
    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, draftMsg.message_id); } catch {}
    await ctx.reply("❌ AI下書きエラー: " + String(e).substring(0, 200), {
      reply_to_message_id: msgId,
    });
  }
}

async function handleSnooze(
  ctx: Context,
  gmailId: string,
  msgId?: number,
  chatId?: number,
  hours: number = 1
): Promise<void> {
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const msgText = ctx.callbackQuery?.message?.text || "(no text)";
  const originalMsg = ctx.callbackQuery?.message;

  // Log snooze action for Inbox Learning
  logInboxAction("snooze", gmailId, "gmail", ctx.callbackQuery?.message?.date);

  // Store in snooze queue
  try {
    // Get or create mapping
    let mappingId: number | null = null;
    if (msgId && chatId) {
      const existing = await gatewayQuery(
        "SELECT id FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
        [msgId, chatId]
      );
      if (existing?.results?.[0]) {
        mappingId = existing.results[0].id as number;
      }
    }

    if (!mappingId) {
      // Create mapping if not exists
      const ins = await gatewayQuery(
        "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, snoozed_until) VALUES (?, ?, 'gmail', ?, ?) RETURNING id",
        [msgId || 0, chatId || 0, gmailId, until]
      );
      mappingId = ins?.results?.[0]?.id as number;
    } else {
      await gatewayQuery(
        "UPDATE message_mappings SET snoozed_until = ? WHERE id = ?",
        [until, mappingId]
      );
    }

    // Store full notification content for re-send
    const replyMarkup = JSON.stringify(
      originalMsg && "reply_markup" in originalMsg
        ? (originalMsg as any).reply_markup
        : null
    );

    await gatewayQuery(
      "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
      [mappingId || 0, JSON.stringify({ text: msgText, reply_markup: replyMarkup }), until]
    );
  } catch (e) {
    console.error("[Inbox] Snooze store error:", e);
  }

  await ctx.answerCallbackQuery({ text: `⏰ ${hours}h後に再通知` });

  // Delete the notification (will come back later)
  if (msgId && chatId) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch (e) {
      console.log("[Inbox] Snooze delete failed:", e);
    }
  }
}

/**
 * Snooze until next morning (7:00 JST)
 */
async function handleSnoozeNextMorning(
  ctx: Context,
  gmailId: string,
  msgId?: number,
  chatId?: number
): Promise<void> {
  // Calculate next 7:00 JST
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC→JST
  const tomorrow = new Date(jst);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  const untilUTC = new Date(tomorrow.getTime() - 9 * 60 * 60 * 1000); // JST→UTC

  // Reuse snooze logic with calculated hours
  const hours = (untilUTC.getTime() - now.getTime()) / (60 * 60 * 1000);
  await handleSnooze(ctx, gmailId, msgId, chatId, Math.ceil(hours));

  // Override the callback answer
  await ctx.answerCallbackQuery({ text: "⏰ 明朝7:00に再通知" }).catch(() => {});
}

/**
 * Handle quote-reply to inbox notifications → route to source
 */
export async function handleInboxReply(ctx: Context): Promise<boolean> {
  const replyTo = ctx.message?.reply_to_message;
  if (!replyTo) return false;

  const replyMsgId = replyTo.message_id;
  const chatId = ctx.chat?.id;
  const replyText = ctx.message?.text;

  if (!replyMsgId || !chatId || !replyText) return false;

  // Look up mapping (2 levels: direct reply or reply-to-reply chain)
  try {
    let mapping = await gatewayQuery(
      "SELECT source, source_id, source_detail FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
      [replyMsgId, chatId]
    );

    // If no mapping, check parent (prompt -> notification chain)
    const parentReply = (replyTo as any).reply_to_message;
    if (!mapping?.results?.[0] && parentReply) {
      const parentMsgId = parentReply.message_id;
      mapping = await gatewayQuery(
        "SELECT source, source_id, source_detail FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
        [parentMsgId, chatId]
      );
      console.log("[Inbox] Reply chain: prompt=" + replyMsgId + " parent=" + parentMsgId + " found=" + !!mapping?.results?.[0]);
    }

    if (!mapping?.results?.[0]) return false;

    const { source, source_id, source_detail } = mapping.results[0] as any;
    const detail = source_detail ? JSON.parse(source_detail) : {};

    if (source === "gmail") {
      return await handleGmailReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "line") {
      return await handleLineReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "slack") {
      return await handleSlackReply(ctx, source_id, detail, replyText, replyMsgId);
    } else if (source === "imessage") {
      return await handleImessageReply(ctx, source_id, detail, replyText, replyMsgId);
    }
  } catch (e) {
    console.error("[Inbox] Reply lookup error:", e);
  }

  return false;
}

/**
 * Gmail reply via GAS
 */
async function handleGmailReply(
  ctx: Context,
  gmailId: string,
  detail: any,
  replyText: string,
  originalMsgId: number
): Promise<boolean> {
  const sendingMsg2 = await ctx.reply("📤 Gmail返信送信中...");

  try {
    const res = await fetch(GAS_GMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        gmail_id: gmailId,
        body: replyText,
        key: GAS_GMAIL_KEY,
      }),
    });
    const result: any = await res.json();

    if (result.ok) {
      // Log reply action for Inbox Learning
      logInboxAction("reply", gmailId, "gmail");

      // Archive to Obsidian
      await archiveToObsidian(
        originalMsgId,
        ctx.chat?.id,
        "out",
        "gmail",
        `Reply to ${detail.subject}: ${replyText}`,
        "replied"
      );

      // Delete notification + sending + reply + prompt messages
      const chatId = ctx.chat?.id!;
      try { await ctx.api.deleteMessage(chatId, sendingMsg2.message_id); } catch (e) {}
      try {
        await ctx.api.deleteMessage(chatId, originalMsgId); // original notification
      } catch (e) {}
      // Send confirmation (auto-delete after 5s)
      const confirm = await ctx.reply("✅ Gmail返信送信完了");
      setTimeout(async () => {
        try {
          await ctx.api.deleteMessage(chatId, confirm.message_id);
          // Also delete user's reply message
          if (ctx.message?.message_id) {
            await ctx.api.deleteMessage(chatId, ctx.message.message_id);
          }
        } catch (e) {}
      }, 5000);

      return true;
    } else {
      await ctx.reply(`❌ Gmail返信失敗: ${result.error}`);
      return true;
    }
  } catch (e) {
    await ctx.reply(`❌ Gmail返信エラー: ${e}`);
    return true;
  }
}

/**
 * LINE reply (placeholder - will be implemented with LINE bridge)
 */
/**
 * LINE reply prompt: instruct user to quote-reply
 */
async function handleLineReplyPrompt(
  ctx: Context,
  targetId: string,
  msgId?: number
): Promise<void> {
  await ctx.answerCallbackQuery();
  const sent = await ctx.reply(
    "↩️ このメッセージに<b>引用リプライ</b>でLINE返信内容を送信してください。",
    {
      parse_mode: "HTML",
      reply_to_message_id: msgId,
    }
  );


  // Register prompt message in mapping so quote-reply routing works
  if (sent.message_id && ctx.chat?.id) {
    try {
      let detail = "{}";
      if (msgId) {
        const orig = await gatewayQuery(
          "SELECT source_detail FROM message_mappings WHERE telegram_msg_id = ? AND telegram_chat_id = ?",
          [msgId, ctx.chat.id]
        );
        if (orig?.results?.[0]) {
          detail = (orig.results[0] as any).source_detail || "{}";
        }
      }
      await gatewayQuery(
        "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, source_detail) VALUES (?, ?, 'line', ?, ?)",
        [sent.message_id, ctx.chat.id, targetId, detail]
      );
      console.log('[Inbox] LINE reply prompt registered: msg=' + sent.message_id);
    } catch (e) {
      console.error('[Inbox] LINE prompt mapping error:', e);
    }
  }
}

/**
 * LINE reply via CF Worker LINE Push API
 */
async function handleLineReply(
  ctx: Context,
  sourceId: string,
  detail: any,
  replyText: string,
  originalMsgId: number
): Promise<boolean> {
  const LINE_WORKER_URL = process.env.LINE_WORKER_URL || "";
  if (!LINE_WORKER_URL) {
    await ctx.reply("❌ LINE_WORKER_URL未設定");
    return true;
  }

  const sendingMsg = await ctx.reply("📤 LINE返信送信中...");

  try {
    const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_id: sourceId,
        text: replyText,
        is_group: detail.is_group ?? true,
      }),
    });
    const result: any = await res.json();

    if (result.ok) {
      // Log reply action for Inbox Learning
      logInboxAction("reply", sourceId, "line");

      // Archive to Obsidian
      await archiveToObsidian(
        originalMsgId,
        ctx.chat?.id,
        "out",
        "line",
        `Reply to ${detail.group_name || "LINE"}: ${replyText}`,
        "replied"
      );

      // Delete notification + send confirmation
      const chatId = ctx.chat?.id!;
      try { await ctx.api.deleteMessage(chatId, originalMsgId); } catch (e) {}
      // Delete "送信中" message
      try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch (e) {}
      const confirm = await ctx.reply(`✅ LINE返信送信完了 → ${detail.group_name || "LINE"}`);
      setTimeout(async () => {
        try {
          await ctx.api.deleteMessage(chatId, confirm.message_id);
          if (ctx.message?.message_id) {
            await ctx.api.deleteMessage(chatId, ctx.message.message_id);
          }
        } catch (e) {}
      }, 5000);
      return true;
    } else {
      await ctx.reply(`❌ LINE返信失敗: ${result.error}`);
      return true;
    }
  } catch (e) {
    await ctx.reply(`❌ LINE返信エラー: ${e}`);
    return true;
  }
}

/**
 * Slack reply (placeholder - will be implemented with Slack bridge)
 */
async function handleSlackReply(
  ctx: Context,
  sourceId: string,
  detail: any,
  replyText: string,
  originalMsgId: number
): Promise<boolean> {
  await ctx.reply("🚧 Slack返信は実装中...");
  return true;
}

/**
 * iMessage reply prompt
 */
async function handleImessageReplyPrompt(
  ctx: Context,
  sourceId: string,
  msgId?: number
): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "↩️ このメッセージに<b>引用リプライ</b>でiMessage返信内容を送信してください。",
    {
      parse_mode: "HTML",
      reply_to_message_id: msgId,
    }
  );
}

/**
 * iMessage reply via AppleScript → Messages.app
 */
async function handleImessageReply(
  ctx: Context,
  sourceId: string,
  detail: any,
  replyText: string,
  originalMsgId: number
): Promise<boolean> {
  const handleId = detail.handle_id;
  if (!handleId) {
    await ctx.reply("❌ 送信先が不明です（handle_id missing）");
    return true;
  }
  const sendingMsg = await ctx.reply("📤 iMessage返信送信中...");
  try {
    const escapedText = replyText.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedHandle = handleId.replace(/"/g, '\\"');
    const script =
      'tell application "Messages"\n' +
      "  set targetService to 1st service whose service type = iMessage\n" +
      '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
      '  send "' + escapedText + '" to targetBuddy\n' +
      "end tell";
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    if (exitCode === 0) {
      logInboxAction("reply", sourceId, "imessage");
      await archiveToObsidian(originalMsgId, ctx.chat?.id, "out", "imessage", "Reply to " + handleId + ": " + replyText, "replied");
      const chatId = ctx.chat?.id!;
      try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}
      try { await ctx.api.deleteMessage(chatId, originalMsgId); } catch {}
      const confirm = await ctx.reply("✅ iMessage返信送信完了 → " + handleId);
      setTimeout(async () => { try { await ctx.api.deleteMessage(chatId, confirm.message_id); if (ctx.message?.message_id) await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {} }, 5000);
      return true;
    } else {
      // SMS fallback
      const smsScript =
        'tell application "Messages"\n' +
        "  set targetService to 1st service whose service type = SMS\n" +
        '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
        '  send "' + escapedText + '" to targetBuddy\n' +
        "end tell";
      const smsProc = Bun.spawn(["osascript", "-e", smsScript], { stdout: "pipe", stderr: "pipe" });
      const smsExit = await smsProc.exited;
      if (smsExit === 0) {
        logInboxAction("reply", sourceId, "imessage");
        await archiveToObsidian(originalMsgId, ctx.chat?.id, "out", "imessage", "SMS to " + handleId + ": " + replyText, "replied");
        const chatId = ctx.chat?.id!;
        try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}
        try { await ctx.api.deleteMessage(chatId, originalMsgId); } catch {}
        const confirm = await ctx.reply("✅ SMS返信完了 → " + handleId);
        setTimeout(async () => { try { await ctx.api.deleteMessage(chatId, confirm.message_id); if (ctx.message?.message_id) await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {} }, 5000);
        return true;
      }
      const smsStderr = await new Response(smsProc.stderr).text();
      await ctx.reply(("❌ iMessage/SMS送信失敗:\n" + (stderr || smsStderr)).substring(0, 500));
      try { await ctx.api.deleteMessage(ctx.chat?.id!, sendingMsg.message_id); } catch {}
      return true;
    }
  } catch (e) {
    await ctx.reply("❌ iMessageエラー: " + e);
    try { await ctx.api.deleteMessage(ctx.chat?.id!, sendingMsg.message_id); } catch {}
    return true;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
