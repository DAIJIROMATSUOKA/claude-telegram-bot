/**
 * Midnight Inbox Check - Find unprocessed messages, schedule re-notification for 7:00 AM
 * LaunchAgent: com.jarvis.midnight-inbox (23:55 JST daily)
 * Run: bun run scripts/midnight-inbox-check.ts
 */

import { Bot } from "grammy";

// Load env
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS;
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

if (!TOKEN || !CHAT_ID) {
  console.error("[Midnight] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS");
  process.exit(0);
}

async function gatewayQuery(sql: string, params: any[] = []): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data: any = await res.json();
  if (!data.success) {
    console.error("[Midnight] DB error:", data);
    return null;
  }
  return { results: data.results || [] };
}

async function main() {
  // Today's date in JST (YYYY-MM-DD)
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const dateStr = jstNow.toISOString().split("T")[0];

  console.log(`[Midnight] Checking unprocessed messages for ${dateStr}`);

  // Find messages that were sent today but never archived/acted on
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
    console.log("[Midnight] No unprocessed messages. Inbox Zero! 🎉");
    return;
  }

  const count = unprocessed.results.length;
  console.log(`[Midnight] Found ${count} unprocessed messages`);

  // Calculate tomorrow 7:00 JST in UTC
  const tomorrow = new Date(jstNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  const untilUTC = new Date(tomorrow.getTime() - jstOffset).toISOString();

  let scheduled = 0;

  for (const item of unprocessed.results as any[]) {
    try {
      const detail = item.source_detail ? JSON.parse(item.source_detail) : {};
      const icon =
        item.source === "gmail"
          ? "📧"
          : item.source === "line"
          ? "💬"
          : item.source === "slack_email"
          ? "💬"
          : "📩";
      const desc =
        detail.subject || detail.from || detail.group_name || detail.sender_name || item.source_id;
      const text = `📌 <b>未処理</b> ${icon} ${desc}`;

      await gatewayQuery(
        "INSERT INTO snooze_queue (mapping_id, original_content, snooze_until) VALUES (?, ?, ?)",
        [item.id, JSON.stringify({ text }), untilUTC]
      );
      scheduled++;
    } catch (e) {
      console.error("[Midnight] Error scheduling:", e);
    }
  }

  // Send summary to Telegram
  const bot = new Bot(TOKEN!);
  await bot.api.sendMessage(
    CHAT_ID!,
    `🌙 <b>深夜チェック</b>\n📌 未処理: ${count}件\n⏰ 明朝7:00に再通知予定`,
    { parse_mode: "HTML" }
  );

  console.log(`[Midnight] Scheduled ${scheduled} re-notifications for tomorrow 7:00 JST`);
}

main()
  .catch((e) => {
    console.error("[Midnight] Fatal:", e);
    process.exit(1);
  });
