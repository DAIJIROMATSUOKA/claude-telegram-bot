/**
 * Phone Call → Telegram Bridge
 * Polls CallHistory.storedata for incoming calls, forwards to Telegram
 * LaunchAgent: com.jarvis.phone-bridge (60s interval)
 *
 * REQUIRES: Full Disk Access for bun
 * Run: bun --env-file=.env run scripts/phone-telegram-bridge.ts
 */

import { Database } from "bun:sqlite";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";
const GATEWAY_URL = process.env.GATEWAY_URL || "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";
const GATEWAY_KEY = process.env.GATEWAY_API_KEY || "";

const CALLHISTORY_DB = `${process.env.HOME}/Library/Application Support/CallHistoryDB/CallHistory.storedata`;
const STATE_FILE = `${process.env.HOME}/.jarvis/phone-bridge-state.json`;
// Core Data epoch: 2001-01-01 00:00:00 UTC
const COREDATA_EPOCH = new Date("2001-01-01T00:00:00Z").getTime() / 1000;

// ============================================================
// Contact name resolution (shared logic with iMessage bridge)
// ============================================================
const contactCache = new Map<string, string>();
let contactCacheLoaded = false;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function loadContactCache(): Promise<void> {
  if (contactCacheLoaded) return;
  contactCacheLoaded = true;

  try {
    const { readdirSync } = await import("fs");
    const basePath = process.env.HOME + "/Library/Application Support/AddressBook/Sources";
    const sources = readdirSync(basePath);

    for (const src of sources) {
      const dbPath = `${basePath}/${src}/AddressBook-v22.abcddb`;
      try {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.query(`
          SELECT ZABCDRECORD.ZFIRSTNAME, ZABCDRECORD.ZLASTNAME, ZABCDPHONENUMBER.ZFULLNUMBER
          FROM ZABCDPHONENUMBER
          JOIN ZABCDRECORD ON ZABCDPHONENUMBER.ZOWNER = ZABCDRECORD.Z_PK
          WHERE ZABCDPHONENUMBER.ZFULLNUMBER IS NOT NULL
        `).all() as any[];

        for (const row of rows) {
          const name = [row.ZLASTNAME, row.ZFIRSTNAME].filter(Boolean).join("") ||
            row.ZFIRSTNAME || row.ZLASTNAME || "";
          if (name && row.ZFULLNUMBER) {
            const normalized = normalizePhone(row.ZFULLNUMBER);
            if (normalized) contactCache.set(normalized, name);
          }
        }
        db.close();
      } catch { }
    }
    console.log(`[Phone Bridge] Loaded ${contactCache.size} contacts`);
  } catch (e) {
    console.error("[Phone Bridge] Contact cache error:", e);
  }
}

function resolveContactName(phone: string): string {
  if (!phone) return "不明";
  const normalized = normalizePhone(phone);
  if (normalized && contactCache.has(normalized)) return contactCache.get(normalized)!;
  return phone;
}

// ============================================================
// State management
// ============================================================
interface State {
  lastPk: number;
}

function loadState(): State {
  try {
    const data = JSON.parse(require("fs").readFileSync(STATE_FILE, "utf-8"));
    return { lastPk: data.lastPk || 0 };
  } catch {
    return { lastPk: 0 };
  }
}

function saveState(state: State): void {
  require("fs").writeFileSync(STATE_FILE, JSON.stringify(state));
}

// ============================================================
// Telegram
// ============================================================
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(text: string, keyboard?: any[][]): Promise<number | null> {
  const payload: any = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) {
    payload.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data: any = await res.json();
    if (data.ok) return data.result.message_id;
    console.error("[Phone Bridge] Telegram error:", data.description);
    return null;
  } catch (e) {
    console.error("[Phone Bridge] Telegram send error:", e);
    return null;
  }
}

async function storeMapping(
  telegramMsgId: number,
  phone: string,
  name: string,
  callType: string
): Promise<void> {
  if (!GATEWAY_URL || !GATEWAY_KEY) return;
  try {
    await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": GATEWAY_KEY,
      },
      body: JSON.stringify({
        sql: `INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, source_detail)
              VALUES (?, ?, 'phone', ?, ?)`,
        params: [
          telegramMsgId,
          parseInt(TELEGRAM_CHAT_ID),
          phone,
          JSON.stringify({ phone, sender_name: name, call_type: callType }),
        ],
      }),
    });
  } catch { }
}

// ============================================================
// Main
// ============================================================
async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("[Phone Bridge] Missing Telegram env vars");
    process.exit(0);
  }

  let db: Database;
  try {
    db = new Database(CALLHISTORY_DB, { readonly: true });
  } catch (e) {
    console.error("[Phone Bridge] Cannot open CallHistory.storedata - Full Disk Access required");
    process.exit(0);
  }

  await loadContactCache();
  const state = loadState();

  // First run: set baseline
  if (state.lastPk === 0) {
    const maxRow = db.query("SELECT MAX(Z_PK) as max_id FROM ZCALLRECORD").get() as any;
    state.lastPk = maxRow?.max_id || 0;
    saveState(state);
    console.log(`[Phone Bridge] First run - baseline set to PK ${state.lastPk}`);
    db.close();
    return;
  }

  // Query new incoming calls only
  const rows = db.query(`
    SELECT Z_PK, ZADDRESS, ZDURATION, ZORIGINATED, ZANSWERED, ZDATE, ZCALLTYPE
    FROM ZCALLRECORD
    WHERE Z_PK > ?
      AND ZORIGINATED = 0
    ORDER BY Z_PK ASC
    LIMIT 20
  `).all(state.lastPk) as any[];

  let maxPk = state.lastPk;
  let forwarded = 0;

  for (const row of rows) {
    if (row.Z_PK > maxPk) maxPk = row.Z_PK;

    const phone = row.ZADDRESS || "非通知";
    const name = resolveContactName(phone);
    const answered = row.ZANSWERED === 1;
    const duration = Math.round(row.ZDURATION || 0);
    const callType = row.ZCALLTYPE; // 1=phone, 16=FaceTime?

    // Convert Core Data timestamp to JST
    const dateUtc = new Date((COREDATA_EPOCH + row.ZDATE) * 1000);
    const timeStr = dateUtc.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Skip calls older than 10 minutes (iCloud sync delay dedup)
    const callAgeMs = Date.now() - dateUtc.getTime();
    const MAX_CALL_AGE_MS = 10 * 60 * 1000; // 10 minutes
    if (callAgeMs > MAX_CALL_AGE_MS) {
      console.log(`[Phone Bridge] Skipping old call: ${phone} (${Math.round(callAgeMs/60000)}min ago)`);
      continue;
    }

    const icon = answered ? "📞" : "📵";
    const statusText = answered
      ? `応答済み (${duration}秒)`
      : "不在着信";

    const text =
      `${icon} <b>${escapeHtml(name)}</b>\n` +
      `${escapeHtml(phone)}\n` +
      `<i>${timeStr}</i> | ${statusText}`;

    const sourceId = normalizePhone(phone).substring(0, 20);
    const keyboard = [
      [
        { text: "📞折返し", callback_data: `ib:callback:${sourceId}` },
        { text: "✏️下書きSMS", callback_data: `ib:draft:${sourceId}` },
        { text: "🗑", callback_data: `ib:del:${sourceId}` },
      ],
    ];

    const tgMsgId = await sendTelegram(text, keyboard);
    if (tgMsgId) {
      await storeMapping(tgMsgId, phone, name, answered ? "answered" : "missed");
      forwarded++;
    }
  }

  if (maxPk > state.lastPk) {
    state.lastPk = maxPk;
    saveState(state);
  }

  if (forwarded > 0) {
    console.log(`[Phone Bridge] Forwarded ${forwarded} call notifications`);
  }

  db.close();
}

main();
