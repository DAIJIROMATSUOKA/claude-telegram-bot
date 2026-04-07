/**
 * Gmail Action Callbacks - full text, attachments, reply, AI draft, Gmail reply.
 */

import { createLogger } from "../utils/logger";
const log = createLogger("inbox-gmail-callbacks");

import type { Context } from "grammy";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";
import { archiveToObsidian } from "../services/obsidian-writer";
import { notifyError } from "../utils/error-notify";
import { gatewayQuery } from "../services/gateway-db";
import { logInboxAction } from "./inbox-triage-callbacks";

const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || "";
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || "";

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
  const res = await fetchWithTimeout(url, { redirect: "follow" });
  const result: any = await res.json();

  if (result.ok) {
    const msgDate = ctx.callbackQuery?.message?.date;
    logInboxAction(action, gmailId, "gmail", msgDate);

    const msgText = ctx.callbackQuery?.message?.text || "(no text)";
    await archiveToObsidian(msgId, chatId, "in", "gmail", msgText, action);

    if (msgId && chatId) {
      try {
        await ctx.api.deleteMessage(chatId, msgId);
      } catch (e) {
        log.info("[Inbox] Delete failed (already deleted?):", e);
      }
    }
  } else {
    await ctx.reply(`❌ ${action}失敗: ${result.error || "unknown"}`);
  }
}

/**
 * Fetch and list Gmail attachments with download info
 */
export async function handleAttachments(ctx: Context, gmailId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: "📎 添付取得中..." });
  const url = `${GAS_GMAIL_URL}?action=full&gmail_id=${gmailId}&key=${GAS_GMAIL_KEY}`;
  const res = await fetchWithTimeout(url, { redirect: "follow" });
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

/**
 * Full text: fetch from GAS and send as reply
 */
export async function handleFullText(ctx: Context, gmailId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: "📖 全文取得中..." });

  const url = `${GAS_GMAIL_URL}?action=full&gmail_id=${gmailId}&key=${GAS_GMAIL_KEY}`;
  const res = await fetchWithTimeout(url, { redirect: "follow" });
  const result: any = await res.json();

  if (result.ok) {
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
export async function handleReplyPrompt(
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
 * AI draft reply: generate a draft using Claude CLI (flat rate)
 */
export async function handleAiDraft(
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

    log.info("[AiDraft] exitCode=", exitCode, "stdout_len=", stdout.length, "stdout_start=", stdout.substring(0, 80));
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
      log.error("[AiDraft] FAILED exitCode=", exitCode, "stdout=", stdout.substring(0, 200));
      await ctx.reply("❌ AI下書き生成失敗 (exit=" + exitCode + ")", { reply_to_message_id: msgId });
    }
  } catch (e) {
    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, draftMsg.message_id); } catch {}
    await notifyError(ctx, "inbox:ai-draft", e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Gmail reply via GAS
 */
export async function handleGmailReply(
  ctx: Context,
  gmailId: string,
  detail: any,
  replyText: string,
  originalMsgId: number
): Promise<boolean> {
  const sendingMsg2 = await ctx.reply("📤 Gmail返信送信中...");

  try {
    const res = await fetchWithTimeout(GAS_GMAIL_URL, {
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
      logInboxAction("reply", gmailId, "gmail");

      await archiveToObsidian(
        originalMsgId,
        ctx.chat?.id,
        "out",
        "gmail",
        `Reply to ${detail.subject}: ${replyText}`,
        "replied"
      );

      const chatId = ctx.chat?.id!;
      try { await ctx.api.deleteMessage(chatId, sendingMsg2.message_id); } catch (e) {}
      try {
        await ctx.api.deleteMessage(chatId, originalMsgId);
      } catch (e) {}
      const confirm = await ctx.reply("✅ Gmail返信送信完了");
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
      await ctx.reply(`❌ Gmail返信失敗: ${result.error}`);
      return true;
    }
  } catch (e) {
    await notifyError(ctx, "inbox:gmail-reply", e instanceof Error ? e : new Error(String(e)));
    return true;
  }
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
