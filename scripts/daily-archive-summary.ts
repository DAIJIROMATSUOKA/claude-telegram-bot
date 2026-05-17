#!/usr/bin/env bun
/**
 * Daily archive summary - runs at 21:00 via LaunchAgent
 * Reads ~/.claude/archived_mail_log.db, sends past-24h summary to Telegram.
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { homedir } from "os";

const DB_PATH =
  process.env.ARCHIVED_MAIL_LOG_PATH ||
  resolve(homedir(), ".claude/archived_mail_log.db");

interface Row {
  action: string;
  sender: string;
  subject: string;
  reason: string;
}

import { existsSync } from "fs";
let rows: Row[] = [];
if (existsSync(DB_PATH)) {
  const db = new Database(DB_PATH, { readonly: true });
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  try {
    rows = db
      .query(
        `SELECT action, sender, subject, reason
         FROM archived_mail
         WHERE archived_at >= ?
         ORDER BY archived_at DESC`,
      )
      .all(since) as Row[];
  } catch (e) {
    // Table not yet created (no archives ever logged)
    rows = [];
  }
}

const archived = rows.filter((r) => r.action === "archive");
const trashed = rows.filter((r) => r.action === "delete");

let msg = "🦞 過去24h アーカイブサマリー\n";
msg += "━━━━━━━━━━━━━━━\n";
msg += `📦 アーカイブ: ${archived.length}件\n`;
msg += `🗑 削除: ${trashed.length}件\n`;

if (archived.length > 0) {
  msg += "\n📦 アーカイブ一覧（最新10件）:\n";
  archived.slice(0, 10).forEach((r) => {
    const subj = (r.subject || "(件名なし)").substring(0, 50);
    msg += `・${r.sender}: ${subj}\n`;
  });
}

if (trashed.length > 0) {
  msg += "\n🗑 削除一覧（最新5件）:\n";
  trashed.slice(0, 5).forEach((r) => {
    const subj = (r.subject || "(件名なし)").substring(0, 50);
    msg += `・${r.sender}: ${subj}\n`;
  });
}

msg += "\n🔍 全件Gmail検索: label:Jarvis-Auto-Archived\n(※ラベル付与はGAS実装後に有効化)";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_USER = process.env.TELEGRAM_ALLOWED_USERS;

if (TG_TOKEN && TG_USER) {
  const res = await fetch(
    `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_USER, text: msg }),
    },
  );
  if (!res.ok) {
    console.error("Telegram send failed:", res.status, await res.text());
    process.exit(1);
  }
  console.log("Sent. archived=" + archived.length + " trashed=" + trashed.length);
} else {
  console.log(msg);
  console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS missing");
}
