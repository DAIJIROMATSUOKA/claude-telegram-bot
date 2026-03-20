/**
 * Snooze Service - Re-notify snoozed messages
 * Run via setInterval in bot startup or as cron job
 */

import { Bot } from "grammy";
import { gatewayQuery } from "./gateway-db";
import { buildTimerText } from "../handlers/timetimer-command";

const CHECK_INTERVAL = 60_000; // Check every 60 seconds

let snoozeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start snooze checker
 */
export function startSnoozeChecker(bot: Bot): void {
  if (snoozeTimer) return;

  console.log("[Snooze] Checker started (60s interval)");
  snoozeTimer = setInterval(() => { checkSnoozeQueue(bot); checkJarvisNotifs(bot); checkTimeTimers(bot); }, CHECK_INTERVAL);
  // Also check immediately
  checkSnoozeQueue(bot);
  checkJarvisNotifs(bot);
  checkTimeTimers(bot);
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
        // Escape stray angle brackets (e.g. email addresses) that break HTML parse
        const rawText = content.text || "(内容不明)";
        const safeText = rawText.replace(/<(?!\/?(?:b|i|u|s|a|code|pre|em|strong)[ >])/gi, "&lt;");
        const text = `⏰ スヌーズ復帰\n\n${safeText}`;
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



// ============================================================
// Jarvis Notif Checker - 5分スヌーズ通知
// ============================================================

/**
 * Check jarvis_notifs table and fire due notifications.
 * Called every 60s from startSnoozeChecker.
 */
export async function checkJarvisNotifs(bot: Bot): Promise<void> {
  try {
    const now = new Date().toISOString().replace("T", " ").substring(0, 19);

    const due = await gatewayQuery(
      "SELECT id, chat_id, label, last_msg_id FROM jarvis_notifs WHERE next_fire_at <= ? AND done = 0 ORDER BY next_fire_at ASC LIMIT 20",
      [now]
    );

    if (!due?.results?.length) return;

    for (const item of due.results as any[]) {
      try {
        const chatId = Number(item.chat_id);
        const label: string = item.label;
        const lastMsgId: number | null = item.last_msg_id;

        // Delete previous snooze message
        if (lastMsgId) {
          try { await bot.api.deleteMessage(chatId, lastMsgId); } catch {}
        }

        // Send new notification with ✅完了 button
        const sent = await bot.api.sendMessage(
          chatId,
          `⏰ <b>${label.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "✅ 完了", callback_data: `jn_done:${item.id}` },
                { text: "⏸ 停止", callback_data: `jn_stop:${item.id}` }
              ]]
            }
          }
        );

        // Schedule next snooze: 5 minutes from now
        const nextFire = new Date(Date.now() + 5 * 60 * 1000)
          .toISOString().replace("T", " ").substring(0, 19);

        await gatewayQuery(
          "UPDATE jarvis_notifs SET last_msg_id = ?, next_fire_at = ? WHERE id = ?",
          [sent.message_id, nextFire, item.id]
        );

        console.log(`[Notif] Fired: id=${item.id} label="${label}"`);
      } catch (e) {
        console.error("[Notif] Fire error:", e);
      }
    }
  } catch (error) {
    console.error("[Notif] Check error:", error);
  }
}


// ============================================================
// Time Timer Checker - 毎分カウントダウン更新
// ============================================================

export async function checkTimeTimers(bot: Bot): Promise<void> {
  try {
    const active = await gatewayQuery(
      "SELECT id, chat_id, msg_id, total_minutes, remaining_minutes, label FROM jarvis_timetimers WHERE done = 0 ORDER BY id ASC LIMIT 20",
      []
    );
    if (!active?.results?.length) return;

    for (const item of active.results as any[]) {
      try {
        const chatId = Number(item.chat_id);
        const msgId = Number(item.msg_id);
        const total = Number(item.total_minutes);
        const remaining = Math.max(0, Number(item.remaining_minutes) - 1);

        const label: string = item.label || "";
        const text = buildTimerText(remaining, total, label);

        if (remaining === 0) {
          // Timer done — unpin first
          try {
            await bot.api.raw.unpinChatMessage({ chat_id: chatId, message_id: msgId });
          } catch {}
          await gatewayQuery("UPDATE jarvis_timetimers SET remaining_minutes = 0, done = 1 WHERE id = ?", [item.id]);
          await bot.api.editMessageText(chatId, msgId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [] },
          });
          // 完了通知（サウンドあり）
          const labelStr = item.label ? `  ${item.label}` : "";
          const doneMsg = await bot.api.sendMessage(chatId, `⏱ <b>Timer done!${labelStr}</b>`, { parse_mode: "HTML" });
          setTimeout(async () => {
            try { await bot.api.deleteMessage(chatId, doneMsg.message_id); } catch {}
          }, 10000);
        } else {
          await gatewayQuery("UPDATE jarvis_timetimers SET remaining_minutes = ? WHERE id = ?", [remaining, item.id]);
          await bot.api.editMessageText(chatId, msgId, text, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "✅ Done", callback_data: `tt_done:${item.id}` }
              ]]
            },
          });
        }
      } catch (e) {
        console.error("[Timer] Update error:", e);
      }
    }
  } catch (error) {
    console.error("[Timer] Check error:", error);
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
