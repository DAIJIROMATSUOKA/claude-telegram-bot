/**
 * /jarvisnotif - スケジュール通知コマンド
 * Usage: /jarvisnotif 今日の10時 ミスミ【O】
 *        /jarvisnotif 明日14:30 打ち合わせ準備
 *
 * 指定時刻に通知 → 5分おきにスヌーズ（最新以外自動削除）→ ✅完了で停止
 */

import { Context } from "grammy";
import { gatewayQuery } from "../services/gateway-db";

/** D1テーブル初期化（Jarvis起動時に呼ぶ） */
export async function initNotifTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS jarvis_notifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      label TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      next_fire_at TEXT NOT NULL,
      last_msg_id INTEGER,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    []
  );
}

/** 日本語時刻パース → UTC ISO文字列
 * 対応: 今日の10時, 明日14:30, 15時, 9時半, 10時30分, etc.
 */
export function parseJstTime(input: string): Date | null {
  const now = new Date();
  // JST = UTC+9
  const nowJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(nowJst);
  today.setUTCHours(0, 0, 0, 0);

  let base = today;
  let text = input.trim();

  // 日付指定
  if (/明後日|あさって/.test(text)) {
    base = new Date(today.getTime() + 2 * 86400000);
    text = text.replace(/明後日|あさって/, "");
  } else if (/明日|あした/.test(text)) {
    base = new Date(today.getTime() + 86400000);
    text = text.replace(/明日|あした/, "");
  } else if (/今日|きょう/.test(text)) {
    base = today;
    text = text.replace(/今日|きょう/, "");
  }

  // 「の」「 」など除去
  text = text.replace(/^[\sのに]+/, "").trim();

  // 時刻パース
  let hour = -1, min = 0;

  // 14:30 / 14時30分 / 14時半
  const m1 = text.match(/(\d{1,2})[:\uff1a](\d{2})/);
  const m2 = text.match(/(\d{1,2})時半/);
  const m3 = text.match(/(\d{1,2})時(\d{1,2})分/);
  const m4 = text.match(/(\d{1,2})時/);

  if (m1) { hour = parseInt(m1[1]!); min = parseInt(m1[2]!); }
  else if (m2) { hour = parseInt(m2[1]!); min = 30; }
  else if (m3) { hour = parseInt(m3[1]!); min = parseInt(m3[2]!); }
  else if (m4) { hour = parseInt(m4[1]!); min = 0; }

  if (hour < 0 || hour > 23) return null;

  // base は JST 0:00 UTC → JST時刻を加算してUTCに変換
  const fireJst = new Date(base.getTime() + (hour * 60 + min) * 60 * 1000);
  // base already in "UTC representing JST 0:00", so subtract 9h to get true UTC
  const fireUtc = new Date(fireJst.getTime() - 9 * 60 * 60 * 1000);
  return fireUtc;
}

/** ラベル部分を抽出（時刻表現を除いた残り） */
function extractLabel(input: string): string {
  return input
    .replace(/今日|明日|明後日|あした|あさって|きょう/, "")
    .replace(/\d{1,2}[:\uff1a]\d{2}/, "")
    .replace(/\d{1,2}時半/, "")
    .replace(/\d{1,2}時\d{1,2}分/, "")
    .replace(/\d{1,2}時/, "")
    .replace(/^[\sのに\u3000]+/, "")
    .replace(/[\s\u3000]+$/, "")
    .trim();
}

/** /jarvisnotif <time> <label> -- Schedule a Jarvis notification. */
export async function handleJarvisNotif(ctx: Context): Promise<void> {
  const raw = (ctx.message?.text || "").replace(/^\/jarvisnotif\s*/i, "").trim();
  const chatId = String(ctx.chat?.id ?? "");

  if (!raw) {
    await ctx.reply(
      `⏰ <b>スケジュール通知</b>\n` +
      `<code>/jarvisnotif 今日の10時 ミスミ【O】</code>\n` +
      `<code>/jarvisnotif 明日14:30 打ち合わせ準備</code>\n\n` +
      `指定時刻に通知 → 5分おきにスヌーズ → ✅完了で停止`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const fireUtc = parseJstTime(raw);
  if (!fireUtc) {
    await ctx.reply("❌ 時刻が読み取れませんでした。\n例: <code>/jarvisnotif 今日の10時 ミスミ</code>", { parse_mode: "HTML" });
    return;
  }

  const label = extractLabel(raw) || raw;
  const fireIso = fireUtc.toISOString().replace("T", " ").substring(0, 19);

  await gatewayQuery(
    "INSERT INTO jarvis_notifs (chat_id, label, fire_at, next_fire_at) VALUES (?, ?, ?, ?)",
    [chatId, label, fireIso, fireIso]
  );

  // Display time in JST
  const fireJst = new Date(fireUtc.getTime() + 9 * 60 * 60 * 1000);
  const timeStr = `${fireJst.getUTCHours()}:${String(fireJst.getUTCMinutes()).padStart(2, "0")}`;
  const now = new Date();
  const minutesUntil = Math.round((fireUtc.getTime() - now.getTime()) / 60000);
  const untilStr = minutesUntil > 0 ? `（あと${minutesUntil}分）` : "（もうすぐ）";

  // Delete original command message
  try { await ctx.deleteMessage(); } catch {}

  const confirm = await ctx.reply(
    `✅ 通知セット\n⏰ ${timeStr} ${label} ${untilStr}`,
    { parse_mode: "HTML" }
  );
  setTimeout(async () => {
    try { await ctx.api.deleteMessage(ctx.chat!.id, confirm.message_id); } catch {}
  }, 5000);
}
