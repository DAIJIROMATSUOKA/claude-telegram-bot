/**
 * Snooze Service - Re-notify snoozed messages
 * Run via setInterval in bot startup or as cron job
 */

import { Bot } from "grammy";
import { gatewayQuery } from "./gateway-db";

const CHECK_INTERVAL = 60_000; // Check every 60 seconds

let snoozeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start snooze checker
 */
export function startSnoozeChecker(bot: Bot): void {
  if (snoozeTimer) return;

  console.log("[Snooze] Checker started (60s interval)");
  snoozeTimer = setInterval(() => checkSnoozeQueue(bot), CHECK_INTERVAL);
  // Also check immediately
  checkSnoozeQueue(bot);
}

/**
 * Stop snooze checker
 */
export function stopSnoozeChecker(): void {
  if (snoozeTimer) {
    clearInterval(snoozeTimer);
    snoozeTimer = null;
    console.log("[Snooze] Checker stopped");
  }
}

/**
 * Check for due snooze items and re-notify
 */
async function checkSnoozeQueue(bot: Bot): Promise<void> {
  try {
    const now = new Date().toISOString().replace("T", " ").substring(0, 19);

    const due = await gatewayQuery(
      "SELECT sq.id, sq.mapping_id, sq.original_content, mm.telegram_chat_id, mm.source, mm.source_id FROM snooze_queue sq JOIN message_mappings mm ON sq.mapping_id = mm.id WHERE sq.snooze_until <= ? AND sq.notified = 0 ORDER BY sq.snooze_until ASC LIMIT 10",
      [now]
    );

    if (!due?.results?.length) return;

    for (const item of due.results as any[]) {
      try {
        const content = JSON.parse(item.original_content);
        const chatId = item.telegram_chat_id;

        if (!chatId) continue;

        // Re-send notification with snooze badge
        const escaped = (content.text || "(内容不明)").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const text = `⏰ <b>スヌーズ復帰</b>\n\n${escaped}`;
        const replyMarkup = content.reply_markup ? JSON.parse(content.reply_markup) : undefined;

        const sent = await bot.api.sendMessage(chatId, text.substring(0, 4000), {
          parse_mode: "HTML",
          reply_markup: replyMarkup || undefined,
        });

        // Update mapping with new message_id
        if (sent.message_id) {
          await gatewayQuery(
            "UPDATE message_mappings SET telegram_msg_id = ?, snoozed_until = NULL WHERE id = ?",
            [sent.message_id, item.mapping_id]
          );
        }

        // Mark as notified
        await gatewayQuery("UPDATE snooze_queue SET notified = 1 WHERE id = ?", [item.id]);

        console.log(`[Snooze] Re-notified: mapping=${item.mapping_id}`);
      } catch (e) {
        console.error("[Snooze] Re-notify error:", e);
      }
    }
  } catch (error) {
    console.error("[Snooze] Queue check error:", error);
  }
}

/**
 * Midnight batch: find un-deleted messages (未処理タスク)
 * Run via cron at 23:59 JST → re-notify next morning
 */
export async function midnightInboxCheck(bot: Bot): Promise<void> {
  // This is called by a separate cron/LaunchAgent
  // Logic: query message_mappings where created_at is today and not archived
  // → re-notify with "📌 未処理" badge
  try {
    const todayStart = new Date();
    todayStart.setHours(todayStart.getHours() + 9); // JST
    const dateStr = todayStart.toISOString().split("T")[0];

    const unprocessed = await gatewayQuery(
      `SELECT mm.id, mm.telegram_msg_id, mm.telegram_chat_id, mm.source, mm.source_id, mm.source_detail 
       FROM message_mappings mm 
       LEFT JOIN telegram_archive ta ON mm.telegram_msg_id = ta.telegram_msg_id 
       WHERE ta.id IS NULL 
       AND mm.created_at LIKE ? || '%' 
       AND mm.snoozed_until IS NULL`,
      [dateStr]
    );

    if (!unprocessed?.results?.length) {
      console.log("[Midnight] No unprocessed messages");
      return;
    }

    console.log(`[Midnight] Found ${unprocessed.results.length} unprocessed messages`);

    // Schedule re-notification for tomorrow 7:00 JST
    const tomorrow7am = new Date();
    tomorrow7am.setHours(tomorrow7am.getHours() + 9); // to JST
    tomorrow7am.setDate(tomorrow7am.getDate() + 1);
    tomorrow7am.setHours(7, 0, 0, 0);
    const until = new Date(tomorrow7am.getTime() - 9 * 60 * 60 * 1000).toISOString(); // back to UTC

    for (const item of unprocessed.results as any[]) {
      const detail = item.source_detail ? JSON.parse(item.source_detail) : {};
      const icon = item.source === "gmail" ? "📧" : "💬";
      const text = `📌 <b>未処理</b> ${icon} ${detail.subject || detail.from || item.source_id}`;

      await gatewayQuery(
        "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
        [item.id, JSON.stringify({ text }), until]
      );
    }

    console.log(`[Midnight] Scheduled ${unprocessed.results.length} re-notifications for tomorrow 7:00`);
  } catch (error) {
    console.error("[Midnight] Check error:", error);
  }
}
