/**
 * /slack command - Post to Slack channel from Telegram
 * Usage:
 *   /slack                       → list channels
 *   /slack #channel message      → post to channel
 *   /slack 番号 message          → post by number
 */
import { Context } from "grammy";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

interface SlackChannel {
  channel_id: string;
  channel_name: string;
}

async function getSlackChannels(): Promise<SlackChannel[]> {
  try {
    // First try D1 (known channels from bridge)
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT DISTINCT
                json_extract(source_detail, '$.channel_id') as channel_id,
                json_extract(source_detail, '$.channel_name') as channel_name
              FROM message_mappings
              WHERE source='slack' AND json_extract(source_detail, '$.channel_id') IS NOT NULL
              ORDER BY created_at DESC LIMIT 20`,
      }),
    });
    const data: any = await res.json();
    const channels = data.results || [];
    if (channels.length > 0) return channels;

    // Fallback: Slack API conversations.list
    if (!SLACK_BOT_TOKEN) return [];
    const apiRes = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=50",
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    );
    const apiData: any = await apiRes.json();
    if (!apiData.ok) return [];
    return (apiData.channels || [])
      .filter((c: any) => c.is_member)
      .map((c: any) => ({ channel_id: c.id, channel_name: c.name }));
  } catch {
    return [];
  }
}

export async function handleSlackPost(ctx: Context): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    await ctx.reply("❌ SLACK_BOT_TOKEN未設定。.envに追加してBot再起動が必要。");
    return;
  }

  const text = (ctx.message?.text || "").replace(/^\/slack\s*/, "").trim();

  // No args: list channels
  if (!text) {
    const channels = await getSlackChannels();
    if (channels.length === 0) {
      await ctx.reply("📋 Slackチャンネルが見つかりません");
      return;
    }
    const list = channels
      .map((c, i) => `<b>${i + 1}.</b> #${c.channel_name}`)
      .join("\n");
    await ctx.reply(
      `📋 Slackチャンネル:\n${list}\n\n使い方: <code>/slack 番号 メッセージ</code>\nまたは: <code>/slack #channel メッセージ</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const channels = await getSlackChannels();
  let targetChannel: SlackChannel | undefined;
  let message: string;

  const firstWord = text.split(/\s+/)[0];
  const rest = text.substring(firstWord.length).trim();

  // Try as number
  const num = parseInt(firstWord);
  if (!isNaN(num) && num >= 1 && num <= channels.length) {
    targetChannel = channels[num - 1];
    message = rest;
  } else {
    // Try as #channel name
    const chName = firstWord.replace(/^#/, "").toLowerCase();
    targetChannel = channels.find(
      (c) => c.channel_name.toLowerCase() === chName ||
             c.channel_name.toLowerCase().includes(chName) ||
             c.channel_id === firstWord
    );
    message = targetChannel ? rest : "";
    if (!targetChannel) {
      await ctx.reply(
        `❌ チャンネル "${firstWord}" が見つかりません。\n<code>/slack</code> で一覧を確認してください。`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  if (!message) {
    await ctx.reply("❌ メッセージを入力してください。\n<code>/slack " + (num || firstWord) + " こんにちは</code>", { parse_mode: "HTML" });
    return;
  }

  const sendingMsg = await ctx.reply(`📤 Slack送信中... → #${targetChannel.channel_name}`);

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: targetChannel.channel_id,
        text: message,
      }),
    });
    const result: any = await res.json();

    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if (result.ok) {
      const confirm = await ctx.reply(`✅ Slack送信完了 → #${targetChannel.channel_name}`);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      await ctx.reply(`❌ Slack送信失敗: ${result.error || "unknown"}`);
    }
  } catch (e) {
    await ctx.reply(`❌ Slackエラー: ${e}`);
  }
}
