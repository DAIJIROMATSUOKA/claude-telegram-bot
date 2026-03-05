/**
 * /mail command - Send email from Telegram via GAS
 * Usage:
 *   /mail to@example.com 件名 // 本文
 *   /mail to@example.com 件名
 *     → then quote-reply with body
 *
 * Attachment: Send a file first → bot stores it → /mail picks it up automatically
 */
import { Context } from "grammy";
import { getPendingAttach, clearPendingAttach } from "../utils/attach-pending";
import { downloadTgFile } from "../utils/tg-file";

const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || "";
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export async function handleMailSend(ctx: Context): Promise<void> {
  if (!GAS_GMAIL_URL || !GAS_GMAIL_KEY) {
    await ctx.reply("❌ GAS_GMAIL_URL/KEY未設定");
    return;
  }

  const text = (ctx.message?.text || "").replace(/^\/mail\s*/, "").trim();
  const userId = ctx.from?.id;

  if (!text) {
    await ctx.reply(
      `📧 メール送信:\n<code>/mail 宛先 件名 // 本文</code>\n<code>/mail 宛先 件名</code>（本文は引用リプライで）\n\nCC追加: <code>/mail 宛先 件名 cc:cc@example.com // 本文</code>\n📎 添付: ファイルを先に送信 → /mail で送信`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse: /mail to@addr subject // body
  // or:   /mail to@addr subject cc:cc@addr // body
  const parts = text.split(/\s+/) as string[];
  const to = parts[0] ?? '';

  if (!to || !to.includes("@")) {
    await ctx.reply("❌ 有効なメールアドレスを指定してください。\n<code>/mail to@example.com 件名 // 本文</code>", { parse_mode: "HTML" });
    return;
  }

  const remaining = parts.slice(1).join(" ");

  // Extract CC if present
  let cc = "";
  let withoutCc = remaining;
  const ccMatch = remaining.match(/cc:(\S+)/i);
  if (ccMatch) {
    cc = ccMatch[1] ?? '';
    withoutCc = remaining.replace(/cc:\S+/i, "").trim();
  }

  // Split subject // body
  const sepIdx = withoutCc.indexOf("//");
  let subject: string;
  let body: string;

  if (sepIdx >= 0) {
    subject = withoutCc.substring(0, sepIdx).trim();
    body = withoutCc.substring(sepIdx + 2).trim();
  } else {
    subject = withoutCc.trim();
    body = "";
  }

  if (!subject) {
    await ctx.reply("❌ 件名を入力してください。", { parse_mode: "HTML" });
    return;
  }

  if (!body) {
    // Check if this is a quote-reply with body
    const replyMsg = ctx.message?.reply_to_message;
    if (replyMsg && "text" in replyMsg && replyMsg.text) {
      body = replyMsg.text;
    } else {
      await ctx.reply(
        `📧 本文なし。このメッセージに<b>引用リプライ</b>で本文を送信するか、\n<code>/mail ${to} ${subject} // 本文をここに</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // Check pending attachment
  const pendingFile = userId ? getPendingAttach(userId) : null;
  const attachLabel = pendingFile ? ` 📎 ${pendingFile.filename}` : "";

  const sendingMsg = await ctx.reply(`📤 メール送信中... → ${to}${attachLabel}`);

  try {
    // Build request payload
    const payload: any = {
      key: GAS_GMAIL_KEY,
      action: "send",
      to,
      subject,
      body,
      cc: cc || undefined,
    };

    // Attach file if pending
    if (pendingFile && userId) {
      try {
        const fileData = await downloadTgFile(pendingFile, BOT_TOKEN);
        payload.attachments = [{
          name: fileData.filename,
          mime_type: fileData.mimeType,
          data_base64: fileData.buffer.toString("base64"),
        }];
        clearPendingAttach(userId);
      } catch (e: any) {
        await ctx.reply(`⚠️ 添付失敗: ${e.message}\nメール本文のみ送信します。`);
      }
    }

    const res = await fetch(GAS_GMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify(payload),
    });
    const result: any = await res.json();

    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if (result.ok) {
      const attachNote = pendingFile ? `\n📎 ${pendingFile.filename}` : "";
      const confirm = await ctx.reply(`✅ メール送信完了\n→ ${to}\n📋 ${subject}${attachNote}`);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      await ctx.reply(`❌ メール送信失敗: ${result.error || "unknown"}`);
    }
  } catch (e) {
    await ctx.reply(`❌ メールエラー: ${e}`);
  }
}
