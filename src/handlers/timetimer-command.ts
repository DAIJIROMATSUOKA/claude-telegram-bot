/**
 * /timetimer N [label] — visual countdown timer
 * Usage: /timetimer 60 伊藤ハム設計
 *        /timetimer 25
 */

import { Context } from "grammy";
import { gatewayQuery } from "../services/gateway-db";

export async function initTimerTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS jarvis_timetimers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      msg_id INTEGER,
      total_minutes INTEGER NOT NULL,
      remaining_minutes INTEGER NOT NULL,
      label TEXT DEFAULT '',
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    []
  );
  // Add label column if upgrading from old schema
  try {
    await gatewayQuery("ALTER TABLE jarvis_timetimers ADD COLUMN label TEXT DEFAULT ''", []);
  } catch {}
}

/** Build visual timer message */
export function buildTimerText(remaining: number, total: number, label = ""): string {
  const BLOCKS = 20;
  const filledBlocks = Math.round((remaining / total) * BLOCKS);
  const emptyBlocks = BLOCKS - filledBlocks;
  const bar = "🟥".repeat(filledBlocks) + "░░".repeat(emptyBlocks);

  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  const timeStr = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:00`;
  const pct = Math.round((remaining / total) * 100);
  const labelPart = label ? `  ${label}` : "";

  if (remaining === 0) {
    return `⏱ Time's up!${label ? `  <b>${label}</b>` : ""}\n${"░░".repeat(BLOCKS)}`;
  }

  return `⏱ <b>${timeStr}</b>${labelPart}\n${bar}\n<code>${pct}%</code>`;
}

export async function handleTimeTimer(ctx: Context): Promise<void> {
  const raw = (ctx.message?.text || "").replace(/^\/timetimer\s*/i, "").trim();
  const chatId = ctx.chat?.id;

  if (!raw || !chatId) {
    await ctx.reply(
      `⏱ <b>Time Timer</b>\n` +
      `<code>/timetimer 60</code>  → 60 min\n` +
      `<code>/timetimer 25 Focus</code>  → 25 min with label\n\n` +
      `Updates every minute. Tap ✅ Done to stop.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse: first token = minutes, rest = label
  const parts = raw.split(/\s+/);
  const minutes = parseInt(parts[0]!);
  const label = parts.slice(1).join(" ").trim();

  if (isNaN(minutes) || minutes < 1 || minutes > 480) {
    await ctx.reply("❌ Please specify 1–480 minutes.\nExample: <code>/timetimer 60 Meeting</code>", { parse_mode: "HTML" });
    return;
  }

  try { await ctx.deleteMessage(); } catch {}

  const text = buildTimerText(minutes, minutes, label);

  const sent = await ctx.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Done", callback_data: "tt_done:0" }
      ]]
    },
    // @ts-ignore
    disable_notification: true,
  });

  const result = await gatewayQuery(
    "INSERT INTO jarvis_timetimers (chat_id, msg_id, total_minutes, remaining_minutes, label) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [String(chatId), sent.message_id, minutes, minutes, label]
  );
  const newId = (result?.results?.[0] as any)?.id;

  if (newId) {
    try {
      await ctx.api.editMessageReplyMarkup(chatId, sent.message_id, {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Done", callback_data: `tt_done:${newId}` }
          ]]
        }
      });
    } catch {}
    // Pin to top (silent)
    try {
      await ctx.api.raw.pinChatMessage({
        chat_id: chatId,
        message_id: sent.message_id,
        disable_notification: true,
      });
    } catch {}
  }
}
