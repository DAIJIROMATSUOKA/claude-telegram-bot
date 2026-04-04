/**
 * /line command - Post to LINE group or individual from Telegram
 * Usage:
 *   /line                    → list available targets (groups + individuals)
 *   /line <group> <message>  → post to group
 *   /line 1 <message>        → post by group number
 *
 * Attachment: Send an IMAGE first → bot stores it → /line picks it up
 * Note: LINE API only supports image/video/audio - PDF and other files are unsupported
 * Images are sent via Telegram CDN URL (valid ~1h)
 */
import { Context } from "grammy";
import { getPendingAttach, clearPendingAttach } from "../utils/attach-pending";
import { getTgFilePath } from "../utils/tg-file";

const LINE_WORKER_URL = process.env.LINE_WORKER_URL || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

interface LineTarget {
  source_id: string;
  name: string;
  is_group: boolean;
}

async function getLineTargets(): Promise<LineTarget[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT source_id,
                json_extract(source_detail, '$.group_name') as name,
                json_extract(source_detail, '$.is_group') as is_group,
                MAX(json_extract(source_detail, '$.sender_name')) as sender,
                MAX(created_at) as last_msg
              FROM message_mappings
              WHERE source='line'
              GROUP BY source_id
              ORDER BY json_extract(source_detail, '$.is_group') DESC, last_msg DESC
              LIMIT 30`,
      }),
    });
    const data: any = await res.json();
    return (data.results || []).map((r: any) => ({
      source_id: r.source_id,
      name: r.is_group ? (r.name || r.source_id) : (r.sender || r.name || "DM"),
      is_group: !!r.is_group,
    }));
  } catch {
    return [];
  }
}

/** /line -- Post to LINE group or individual from Telegram. */
export async function handleLinePost(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/line\s*/, "").trim();
  const userId = ctx.from?.id;

  // No args: list groups
  if (!text) {
    const groups = await getLineTargets();
    if (groups.length === 0) {
      await ctx.reply("📋 LINEグループが見つかりません");
      return;
    }
    const list = groups
      .map((g, i) => `<b>${i + 1}.</b> ${g.name || g.source_id}`)
      .join("\n");
    const pendingFile = userId ? getPendingAttach(userId) : null;
    const pendingNote = pendingFile
      ? `\n\n📎 保留中: <b>${pendingFile.filename}</b>${!pendingFile.mimeType.startsWith("image/") ? " ⚠️ LINE非対応形式（画像のみ可）" : ""}`
      : "";
    await ctx.reply(
      `📋 LINEグループ一覧:\n${list}\n\n使い方: <code>/line 番号 メッセージ</code>${pendingNote}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse: /line <number_or_name> <message>
  const groups = await getLineTargets();
  let targetGroup: LineTarget | undefined;
  let message: string;

  const firstWord = text.split(/\s+/)[0]!;
  const rest = text.substring(firstWord.length).trim();

  // Try as number
  const num = parseInt(firstWord);
  if (!isNaN(num) && num >= 1 && num <= groups.length) {
    targetGroup = groups[num - 1];
    message = rest;
  } else {
    targetGroup = groups.find(
      (g) =>
        g.name?.toLowerCase().includes(firstWord.toLowerCase()) ||
        g.source_id === firstWord
    );
    message = targetGroup ? rest : "";
    if (!targetGroup) {
      await ctx.reply(
        `❌ グループ "${firstWord}" が見つかりません。\n<code>/line</code> で一覧を確認してください。`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // Check pending attachment
  const pendingFile = userId ? getPendingAttach(userId) : null;
  const isImage = pendingFile?.mimeType.startsWith("image/");

  if (!message && !pendingFile) {
    await ctx.reply("❌ メッセージを入力してください。\n<code>/line " + (num || firstWord) + " こんにちは</code>", { parse_mode: "HTML" });
    return;
  }

  if (!LINE_WORKER_URL) {
    await ctx.reply("❌ LINE_WORKER_URL未設定");
    return;
  }

  // Check non-image file type early
  if (pendingFile && !isImage) {
    await ctx.reply(
      `⚠️ LINE APIは画像のみ対応しています。\n<b>${pendingFile.filename}</b> (${pendingFile.mimeType}) は送信できません。\nテキストのみ送信しますか？（/line ${num || firstWord} ${message || "メッセージ"}）`,
      { parse_mode: "HTML" }
    );
    clearPendingAttach(userId!);
    return;
  }

  const tg = targetGroup!;
  const attachLabel = isImage ? ` 🖼 ${pendingFile!.filename}` : "";
  const sendingMsg = await ctx.reply(`📤 LINE送信中... → ${tg.name || tg.source_id}${attachLabel}`);
  const chatId = ctx.chat?.id!;

  try {
    let textOk = true;
    let imageOk = true;
    const errors: string[] = [];

    // Send image if pending
    if (pendingFile && isImage && userId) {
      try {
        const { filePath } = await getTgFilePath(pendingFile.fileId, BOT_TOKEN);
        const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

        const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_id: tg.source_id,
            is_group: tg.is_group,
            image_url: imageUrl,
          }),
        });
        const result: any = await res.json();
        if (result.ok) {
          clearPendingAttach(userId);
        } else {
          imageOk = false;
          errors.push(`画像送信失敗: ${result.error || "unknown"}`);
        }
      } catch (e: any) {
        imageOk = false;
        errors.push(`画像取得失敗: ${e.message}`);
      }
    }

    // Send text
    if (message) {
      const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_id: tg.source_id,
          text: message,
          is_group: tg.is_group,
        }),
      });
      const result: any = await res.json();
      textOk = result.ok;
      if (!result.ok) errors.push(`テキスト送信失敗: ${result.error || "unknown"}`);
    }

    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if ((textOk || !message) && (imageOk || !pendingFile)) {
      const parts = [
        `✅ LINE送信完了 → ${tg.name || tg.source_id}`,
        pendingFile && imageOk ? `🖼 ${pendingFile.filename}` : null,
      ].filter(Boolean).join("\n");
      const confirm = await ctx.reply(parts);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      await ctx.reply(`❌ LINE送信失敗:\n${errors.join("\n")}`);
    }
  } catch (e) {
    await ctx.reply(`❌ LINEエラー: ${e}`);
  }
}
