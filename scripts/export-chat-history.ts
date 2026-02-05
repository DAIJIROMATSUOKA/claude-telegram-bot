#!/usr/bin/env bun

/**
 * Telegram Chat History Exporter
 * 今日のチャット履歴をテキスト形式でエクスポート
 */

import { Bot } from "grammy";
import { writeFileSync } from "fs";
import { join } from "path";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.USER_CHAT_ID!;

interface MessageData {
  date: Date;
  from: string;
  text: string;
  messageId: number;
}

async function exportTodayMessages() {
  const bot = new Bot(BOT_TOKEN);

  // 今日の開始時刻 (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = Math.floor(today.getTime() / 1000);

  console.log(`📅 Exporting messages from ${today.toLocaleDateString("ja-JP")}`);

  const messages: MessageData[] = [];
  let offsetMessageId: number | undefined = undefined;
  let hasMore = true;
  let totalFetched = 0;

  try {
    // メッセージを取得（新しい順から古い順へ）
    while (hasMore) {
      const updates = await bot.api.getUpdates({
        offset: offsetMessageId,
        limit: 100,
        allowed_updates: ["message"],
      });

      if (updates.length === 0) {
        hasMore = false;
        break;
      }

      for (const update of updates) {
        if (update.message) {
          const msg = update.message;
          const msgDate = new Date(msg.date * 1000);

          // 今日のメッセージのみ
          if (msg.date >= todayTimestamp) {
            const from = msg.from?.first_name || "Unknown";
            const text = msg.text || msg.caption || "[Media]";

            messages.push({
              date: msgDate,
              from,
              text,
              messageId: msg.message_id,
            });
          } else {
            // 今日より前のメッセージに到達したら終了
            hasMore = false;
            break;
          }
        }

        offsetMessageId = update.update_id + 1;
      }

      totalFetched += updates.length;
      console.log(`📦 Fetched ${totalFetched} updates...`);

      // レート制限対策
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // メッセージを時系列順にソート（古い順）
    messages.sort((a, b) => a.date.getTime() - b.date.getTime());

    // テキスト形式でフォーマット
    const output = formatMessages(messages);

    // ファイルに保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `telegram-chat-${today.toISOString().split("T")[0]}_${timestamp}.txt`;
    const filepath = join(process.env.HOME!, "Downloads", filename);

    writeFileSync(filepath, output, "utf-8");

    console.log(`✅ Exported ${messages.length} messages`);
    console.log(`📁 Saved to: ${filepath}`);

    return filepath;
  } catch (error) {
    console.error("❌ Error exporting messages:", error);
    throw error;
  }
}

function formatMessages(messages: MessageData[]): string {
  const header = `=================================================
Telegram Chat History Export
Date: ${new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}
Total Messages: ${messages.length}
=================================================

`;

  const body = messages
    .map((msg) => {
      const time = msg.date.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const separator = "-".repeat(50);
      return `[${time}] ${msg.from}
${msg.text}
${separator}`;
    })
    .join("\n\n");

  return header + body;
}

// 実行
exportTodayMessages()
  .then((filepath) => {
    console.log("\n🎉 Export completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Export failed:", error);
    process.exit(1);
  });
