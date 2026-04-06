/**
 * LINE / iMessage / Slack Action Callbacks - reply prompts and reply handlers.
 */

import type { Context } from "grammy";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";
import { archiveToObsidian } from "../services/obsidian-writer";
import { notifyError } from "../utils/error-notify";
import { gatewayQuery } from "../services/gateway-db";
import { logInboxAction } from "./inbox-triage-callbacks";

/**
 * LINE reply prompt: instruct user to quote-reply
 */
export async function handleLineReplyPrompt(
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
export async function handleLineReply(
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
    const res = await fetchWithTimeout(`${LINE_WORKER_URL}/v1/reply`, {
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
      logInboxAction("reply", sourceId, "line");

      await archiveToObsidian(
        originalMsgId,
        ctx.chat?.id,
        "out",
        "line",
        `Reply to ${detail.group_name || "LINE"}: ${replyText}`,
        "replied"
      );

      const chatId = ctx.chat?.id!;
      try { await ctx.api.deleteMessage(chatId, originalMsgId); } catch (e) {}
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
    await notifyError(ctx, "inbox:line-reply", e instanceof Error ? e : new Error(String(e)));
    return true;
  }
}

/**
 * Slack reply (placeholder)
 */
export async function handleSlackReply(
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
export async function handleImessageReplyPrompt(
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
export async function handleImessageReply(
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
    await notifyError(ctx, "inbox:imessage", e instanceof Error ? e : new Error(String(e)));
    try { await ctx.api.deleteMessage(ctx.chat?.id!, sendingMsg.message_id); } catch {}
    return true;
  }
}
