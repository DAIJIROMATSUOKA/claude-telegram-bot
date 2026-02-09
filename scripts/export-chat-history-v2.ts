#!/usr/bin/env bun

/**
 * Telegram Chat History Exporter v2
 * Bot APIの制限を回避して、データベースやログから履歴を再構築
 */

import { Bot } from "grammy";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.USER_CHAT_ID!;

interface ExportedMessage {
  date: Date;
  from: string;
  text: string;
}

async function exportFromLogs() {
  console.log("📝 Attempting to export from logs...");

  const messages: ExportedMessage[] = [];
  const today = new Date().toISOString().split("T")[0] ?? '';

  // ログファイルから抽出を試みる
  const logPaths = [
    join(process.env.HOME!, "claude-telegram-bot", "logs", "bot.log"),
    join(process.env.HOME!, "claude-telegram-bot", "bot.log"),
    join("/tmp", "telegram-bot.log"),
  ];

  for (const logPath of logPaths) {
    if (existsSync(logPath)) {
      console.log(`📄 Found log file: ${logPath}`);
      try {
        const logContent = readFileSync(logPath, "utf-8");
        const lines = logContent.split("\n");

        for (const line of lines) {
          // ログからメッセージを抽出（実際のログ形式に合わせて調整が必要）
          if (line.includes(today)) {
            // 簡易的なパース
            messages.push({
              date: new Date(),
              from: "Log Entry",
              text: line,
            });
          }
        }
      } catch (error) {
        console.warn(`⚠️ Could not read log file: ${logPath}`);
      }
    }
  }

  return messages;
}

async function exportUsingUserMethod() {
  console.log(`
⚠️  Bot API制限により、完全な履歴取得ができません

Telegram Bot APIの制限:
- getUpdatesは未処理のメッセージしか取得できない
- すでに処理済みのメッセージは取得不可
- チャット履歴を遡る機能がない

推奨される方法:

【方法A: Telegram Desktop（最も確実）】
1. Telegram Desktopを開く
2. Jarvisとのチャットを開く
3. 右上メニュー（⋮）→「Export chat history」
4. Format: Plain text
5. Date range: Today (${new Date().toLocaleDateString("ja-JP")})
6. Export実行

保存先: ~/Downloads/ChatExport_YYYY-MM-DD/

【方法B: 手動コピー】
Telegramアプリで今日のメッセージを選択してコピー

【方法C: Memory Gatewayから抽出（推奨）】
もしMemory Gatewayに今日の会話が記録されていれば、
そこから抽出する方が確実です。

---

このスクリプトでは履歴を取得できませんでした。
上記の方法をお試しください。
`);
}

// 実行
exportUsingUserMethod()
  .then(() => {
    console.log("\n📋 Instructions displayed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Error:", error);
    process.exit(1);
  });
