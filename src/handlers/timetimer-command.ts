/**
 * /timetimer N — visual countdown timer
 * Usage: /timetimer 60   → 60分タイマー
 *        /timetimer 25   → 25分
 *
 * 毎分メッセージをedit（通知なし）。🟥が残り時間を表す。
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
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    []
  );
}

/** Build visual timer message */
export function buildTimerText(remaining: number, total: number): string {
  const BLOCKS = 20;
  const elapsed = total - remaining;
  const filledBlocks = Math.round((remaining / total) * BLOCKS);
  const emptyBlocks = BLOCKS - filledBlocks;

  const bar = "🟥".repeat(filledBlocks) + "░░".repeat(emptyBlocks);

  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  const timeStr = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:00`;

  const pct = Math.round((remaining / total) * 100);

  if (remaining === 0) {
    return `⏱ タイムタイマー\n${"🟥".repeat(0)}${"░░".repeat(BLOCKS)}\n✅ <b>完了！</b>（${total}分）`;
  }

  return `⏱ <b>${timeStr}</b>  残り${remaining}分\n${bar}\n<code>${pct}%</code>`;
}

export async function handleTimeTimer(ctx: Context): Promise<void> {
  const raw = (ctx.message?.text || "").replace(/^\/timetimer\s*/i, "").trim();
  const chatId = ctx.chat?.id;

  if (!raw || !chatId) {
    await ctx.reply(
      `⏱ <b>タイムタイマー</b>\n` +
      `<code>/timetimer 60</code>  → 60分\n` +
      `<code>/timetimer 25</code>  → 25分\n\n` +
      `毎分更新。✅完了ボタンで停止。`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const minutes = parseInt(raw);
  if (isNaN(minutes) || minutes < 1 || minutes > 480) {
    await ctx.reply("❌ 1〜480分で指定してください。\n例: <code>/timetimer 60</code>", { parse_mode: "HTML" });
    return;
  }

  // Delete command message
  try { await ctx.deleteMessage(); } catch {}

  const text = buildTimerText(minutes, minutes);

  // Send with no notification
  const sent = await ctx.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ 完了", callback_data: "tt_done:0" }
      ]]
    },
    // @ts-ignore — disable_notification is valid but not in Grammy types
    disable_notification: true,
  });

  // Store in D1
  const result = await gatewayQuery(
    "INSERT INTO jarvis_timetimers (chat_id, msg_id, total_minutes, remaining_minutes) VALUES (?, ?, ?, ?) RETURNING id",
    [String(chatId), sent.message_id, minutes, minutes]
  );
  const newId = (result?.results?.[0] as any)?.id;

  // Update button with real id
  if (newId) {
    try {
      await ctx.api.editMessageReplyMarkup(chatId, sent.message_id, {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ 完了", callback_data: `tt_done:${newId}` }
          ]]
        }
      });
    } catch {}
  }
}
