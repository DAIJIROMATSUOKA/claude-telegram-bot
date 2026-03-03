/**
 * Slack→Telegram Bridge - Polls Slack channels, forwards to Telegram Inbox Zero
 * LaunchAgent: com.jarvis.slack-bridge (120s interval)
 * Run: bun run scripts/slack-telegram-bridge.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";
const STATE_FILE = "/tmp/slack-bridge-state.json";

interface ChannelState {
  [channelId: string]: { lastTs: string; channelName: string };
}

function loadState(): ChannelState {
  try {
    if (existsSync(STATE_FILE))
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveState(state: ChannelState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Slack API ---

async function slackApi(
  method: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data: any = await res.json();
  if (!data.ok) {
    console.error(`[Slack Bridge] API ${method} error:`, data.error);
  }
  return data;
}

const userCache = new Map<string, string>();

async function getUserName(userId: string): Promise<string> {
  if (!userId || userId === "unknown") return "unknown";
  if (userCache.has(userId)) return userCache.get(userId)!;

  try {
    const data = await slackApi("users.info", { user: userId });
    const name =
      data.user?.profile?.display_name ||
      data.user?.real_name ||
      data.user?.name ||
      userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

async function getBotChannels(): Promise<
  Array<{ id: string; name: string; is_private: boolean }>
> {
  const channels: Array<{
    id: string;
    name: string;
    is_private: boolean;
  }> = [];

  // Public + private channels where bot is a member
  let cursor = "";
  do {
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApi("conversations.list", params);
    if (data.channels) {
      for (const ch of data.channels) {
        if (ch.is_member) {
          channels.push({
            id: ch.id,
            name: ch.name,
            is_private: ch.is_private,
          });
        }
      }
    }
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);

  return channels;
}

// Resolve Slack markup → plain text
function resolveSlackText(text: string): string {
  // <@U123> → @username
  text = text.replace(/<@(U[A-Z0-9]+)>/g, (_, uid) => {
    return `@${userCache.get(uid) || uid}`;
  });
  // <#C123|name> → #name
  text = text.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1");
  // <url|label> → label
  text = text.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2");
  // <url> → url
  text = text.replace(/<(https?:\/\/[^>]+)>/g, "$1");
  return text;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Telegram ---

async function sendToTelegram(
  channelName: string,
  userName: string,
  text: string,
  channelId: string,
  messageTs: string,
  files?: any[]
): Promise<number | null> {
  const sourceId = `${channelId}:${messageTs}`;
  const resolved = resolveSlackText(text);

  let body =
    `💬 <b>#${escapeHtml(channelName)}</b> | ${escapeHtml(userName)}\n` +
    escapeHtml(resolved);

  if (files?.length) {
    body +=
      "\n" + files.map((f: any) => `📎 ${f.name || f.title || "file"}`).join("\n");
  }

  body = body.substring(0, 4000);

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💬返信", callback_data: `ib:slrpl:${sourceId}` },
        { text: "⏰1h", callback_data: `ib:snz1h:${sourceId}` },
        { text: "⏰3h", callback_data: `ib:snz3h:${sourceId}` },
        { text: "⏰明朝", callback_data: `ib:snzam:${sourceId}` },
      ],
    ],
  };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: body,
          parse_mode: "HTML",
          reply_markup: keyboard,
          disable_web_page_preview: true,
        }),
      }
    );
    const data: any = await res.json();
    if (data.ok) return data.result.message_id;
    console.error("[Slack Bridge] Telegram error:", data.description);
  } catch (e) {
    console.error("[Slack Bridge] Telegram send failed:", e);
  }
  return null;
}

// --- D1 Mapping ---

async function storeMapping(
  telegramMsgId: number,
  channelId: string,
  messageTs: string,
  channelName: string,
  userName: string
): Promise<void> {
  const sourceId = `${channelId}:${messageTs}`;
  const detail = JSON.stringify({
    channel_id: channelId,
    message_ts: messageTs,
    channel_name: channelName,
    sender_name: userName,
  });

  try {
    await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, source_detail) VALUES (?, ?, ?, ?, ?)",
        params: [
          telegramMsgId,
          Number(TELEGRAM_CHAT_ID),
          "slack",
          sourceId,
          detail,
        ],
      }),
    });
  } catch (e) {
    console.error("[Slack Bridge] D1 store failed:", e);
  }
}

// --- Main ---

async function main(): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    console.error("[Slack Bridge] SLACK_BOT_TOKEN not set in .env");
    process.exit(0); // exit(0) = don't crash-loop via launchd
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("[Slack Bridge] Telegram env vars missing");
    process.exit(0);
  }

  const state = loadState();
  const channels = await getBotChannels();

  if (channels.length === 0) {
    console.log("[Slack Bridge] No channels (invite bot to channels first)");
    saveState(state);
    return;
  }

  let totalNew = 0;

  for (const channel of channels) {
    // Default: 3 min ago (first run only)
    const lastTs =
      state[channel.id]?.lastTs || String(Date.now() / 1000 - 180);

    const data = await slackApi("conversations.history", {
      channel: channel.id,
      oldest: lastTs,
      limit: "20",
    });

    if (!data.messages) continue;

    // Reverse for chronological order (API returns newest first)
    const messages = (data.messages as any[]).reverse();
    let maxTs = lastTs;

    for (const msg of messages) {
      // Skip bot/system messages (except file_share which is a user action)
      if (msg.subtype && msg.subtype !== "file_share") continue;
      if (msg.bot_id || msg.app_id) continue;
      if (msg.ts <= lastTs) continue;

      const userName = await getUserName(msg.user || "unknown");
      const text = msg.text || "";

      if (!text && !msg.files?.length) continue;

      const telegramMsgId = await sendToTelegram(
        channel.name,
        userName,
        text,
        channel.id,
        msg.ts,
        msg.files
      );

      if (telegramMsgId) {
        await storeMapping(
          telegramMsgId,
          channel.id,
          msg.ts,
          channel.name,
          userName
        );
        totalNew++;
      }

      if (msg.ts > maxTs) maxTs = msg.ts;
    }

    state[channel.id] = { lastTs: maxTs, channelName: channel.name };
  }

  saveState(state);
  if (totalNew > 0)
    console.log(`[Slack Bridge] Forwarded ${totalNew} messages`);
}

main().catch((e) => {
  console.error("[Slack Bridge] Fatal:", e);
  process.exit(1);
});
