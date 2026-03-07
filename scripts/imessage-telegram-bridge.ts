/**
 * Apple Messages → Telegram Bridge
 * Polls chat.db for new incoming messages, forwards to Telegram Inbox Zero
 * LaunchAgent: com.jarvis.imessage-bridge (120s interval)
 * 
 * REQUIRES: Full Disk Access for bun (System Settings → Privacy → FDA)
 * Run: bun --env-file=.env run scripts/imessage-telegram-bridge.ts
 */

import { Database } from "bun:sqlite";

/**
 * Resolve phone/email handle to contact name via AddressBook DB
 * Caches results for the process lifetime
 */
const contactCache = new Map<string, string>();
let contactCacheLoaded = false;

function normalizePhone(phone: string): string {
  // Strip all non-digits
  const digits = phone.replace(/[^0-9]/g, "");
  // Japanese: +81XXXXXXXXXX -> 0XXXXXXXXXX (last 10 digits)
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
        
        // Phone numbers
        const phoneRows = db.query(`
          SELECT ZABCDRECORD.ZFIRSTNAME, ZABCDRECORD.ZLASTNAME, ZABCDPHONENUMBER.ZFULLNUMBER
          FROM ZABCDPHONENUMBER
          JOIN ZABCDRECORD ON ZABCDPHONENUMBER.ZOWNER = ZABCDRECORD.Z_PK
          WHERE ZABCDPHONENUMBER.ZFULLNUMBER IS NOT NULL
        `).all() as any[];
        
        for (const row of phoneRows) {
          const name = [row.ZLASTNAME, row.ZFIRSTNAME].filter(Boolean).join("") || 
                       row.ZFIRSTNAME || row.ZLASTNAME || "";
          if (name && row.ZFULLNUMBER) {
            const normalized = normalizePhone(row.ZFULLNUMBER);
            if (normalized) contactCache.set(normalized, name);
          }
        }
        
        // Email addresses
        const emailRows = db.query(`
          SELECT ZABCDRECORD.ZFIRSTNAME, ZABCDRECORD.ZLASTNAME, ZABCDEMAILADDRESS.ZADDRESS
          FROM ZABCDEMAILADDRESS
          JOIN ZABCDRECORD ON ZABCDEMAILADDRESS.ZOWNER = ZABCDRECORD.Z_PK
          WHERE ZABCDEMAILADDRESS.ZADDRESS IS NOT NULL
        `).all() as any[];
        
        for (const row of emailRows) {
          const name = [row.ZLASTNAME, row.ZFIRSTNAME].filter(Boolean).join("") ||
                       row.ZFIRSTNAME || row.ZLASTNAME || "";
          if (name && row.ZADDRESS) {
            contactCache.set(row.ZADDRESS.toLowerCase(), name);
          }
        }
        
        db.close();
      } catch {}
    }
    
    console.log(`[iMessage Bridge] Loaded ${contactCache.size} contacts`);
  } catch (e) {
    console.error("[iMessage Bridge] Contact cache error:", e);
  }
}

function resolveContactName(handleId: string): string {
  if (!handleId) return "unknown";
  
  // Try exact match (email)
  const lower = handleId.toLowerCase();
  if (contactCache.has(lower)) return contactCache.get(lower)!;
  
  // Try normalized phone
  const normalized = normalizePhone(handleId);
  if (normalized && contactCache.has(normalized)) return contactCache.get(normalized)!;
  
  return handleId;
}

import { readFileSync, writeFileSync, existsSync } from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

const CHAT_DB = `${process.env.HOME}/Library/Messages/chat.db`;
const STATE_FILE = "/tmp/imessage-bridge-state.json";

// iMessage epoch: 2001-01-01 00:00:00 UTC (978307200 seconds from Unix epoch)
// chat.db stores dates in nanoseconds from this epoch
const COCOA_EPOCH_OFFSET = 978307200;

function cocoaToUnix(cocoaNano: number): number {
  return Math.floor(cocoaNano / 1_000_000_000) + COCOA_EPOCH_OFFSET;
}

function cocoaToISO(cocoaNano: number): string {
  return new Date(cocoaToUnix(cocoaNano) * 1000).toISOString();
}

function cocoaToJSTTimeStr(cocoaNano: number): string {
  const d = new Date(cocoaToUnix(cocoaNano) * 1000);
  return d.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface BridgeState {
  lastRowId: number;
  dedupHashes?: string[];  // recent message hashes for dedup
}

const DEDUP_MAX = 200;  // keep last 200 hashes

function loadState(): BridgeState {
  try {
    if (existsSync(STATE_FILE))
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastRowId: 0, dedupHashes: [] };
}

function saveState(state: BridgeState): void {
  // trim dedup list to max size
  if (state.dedupHashes && state.dedupHashes.length > DEDUP_MAX) {
    state.dedupHashes = state.dedupHashes.slice(-DEDUP_MAX);
  }
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

function makeDedupHash(handleId: string, text: string, cocoaDate: number): string {
  // Normalize: round date to nearest second to handle minor drift
  const sec = Math.floor(cocoaDate / 1_000_000_000);
  return `${handleId}|${text}|${sec}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Telegram ---

async function sendToTelegram(
  senderName: string,
  text: string,
  chatId: string,
  rowId: number,
  isGroup: boolean,
  sentTimeStr: string
): Promise<number | null> {
  const sourceId = `imsg:${rowId}`;
  const icon = "📱";
  const groupTag = isGroup ? " (グループ)" : "";
  const timeTag = sentTimeStr ? ` ${sentTimeStr}` : "";

  let body =
    `${icon} <b>${escapeHtml(senderName)}</b>${timeTag}${groupTag}\n` +
    escapeHtml(text);

  body = body.substring(0, 4000);

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💬返信", callback_data: `ib:imrpl:${sourceId}` },
        { text: "✏️下書き", callback_data: `ib:draft:${sourceId}` },
        { text: "🗑", callback_data: `ib:del:${sourceId}` },
      ],
      [
        { text: "⏰1h", callback_data: `ib:snz1h:${sourceId}` },
        { text: "⏰3h", callback_data: `ib:snz3h:${sourceId}` },
        { text: "⏰明朝", callback_data: `ib:snzam:${sourceId}` },
      ],
    ],
  };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: body,
          parse_mode: "HTML",
          reply_markup: keyboard,
          disable_web_page_preview: true,
        }),
      }
    );
    const data: any = await res.json();
    if (data.ok) return data.result.message_id;
    console.error("[iMessage Bridge] Telegram error:", data.description);
  } catch (e) {
    console.error("[iMessage Bridge] Telegram send failed:", e);
  }
  return null;
}

// --- D1 Mapping ---

async function storeMapping(
  telegramMsgId: number,
  rowId: number,
  chatGuid: string,
  handleId: string,
  senderName: string,
  isGroup: boolean
): Promise<void> {
  const sourceId = `imsg:${rowId}`;
  const detail = JSON.stringify({
    chat_guid: chatGuid,
    handle_id: handleId,
    sender_name: senderName,
    is_group: isGroup,
    msg_rowid: rowId,
  });

  try {
    await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "INSERT INTO message_mappings (telegram_msg_id, telegram_chat_id, source, source_id, source_detail) VALUES (?, ?, ?, ?, ?)",
        params: [
          telegramMsgId,
          Number(TELEGRAM_CHAT_ID),
          "imessage",
          sourceId,
          detail,
        ],
      }),
    });
  } catch (e) {
    console.error("[iMessage Bridge] D1 store failed:", e);
  }
}

// --- Main ---

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("[iMessage Bridge] Missing Telegram env vars");
    process.exit(0);
  }

  // Test chat.db access
  let db: Database;
  try {
    db = new Database(CHAT_DB, { readonly: true });
  } catch (e) {
    console.error(
      "[iMessage Bridge] Cannot open chat.db - Full Disk Access required for bun"
    );
    console.error("  System Settings → Privacy & Security → Full Disk Access → add ~/.bun/bin/bun");
    process.exit(0); // exit(0) = don't crash-loop
  }

  await loadContactCache();

  const state = loadState();

  // First run: set baseline to current max ROWID (don't spam old messages)
  if (state.lastRowId === 0) {
    const maxRow = db.query("SELECT MAX(ROWID) as max_id FROM message").get() as any;
    state.lastRowId = maxRow?.max_id || 0;
    saveState(state);
    console.log(`[iMessage Bridge] First run - baseline set to ROWID ${state.lastRowId}`);
    db.close();
    return;
  }

  // Query new incoming messages (is_from_me = 0)
  const query = db.query(`
    SELECT 
      m.ROWID,
      m.text,
      m.date,
      m.is_from_me,
      m.cache_roomnames,
      h.id as handle_id,
      COALESCE(
        (SELECT display_name FROM chat_message_join cmj 
         JOIN chat c ON cmj.chat_id = c.ROWID 
         WHERE cmj.message_id = m.ROWID LIMIT 1),
        ''
      ) as chat_display_name,
      (SELECT c.guid FROM chat_message_join cmj 
       JOIN chat c ON cmj.chat_id = c.ROWID 
       WHERE cmj.message_id = m.ROWID LIMIT 1) as chat_guid,
      (SELECT c.group_id FROM chat_message_join cmj 
       JOIN chat c ON cmj.chat_id = c.ROWID 
       WHERE cmj.message_id = m.ROWID LIMIT 1) as group_id
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.ROWID > ?
      AND m.is_from_me = 0
      AND m.text IS NOT NULL
      AND m.text != ''
    ORDER BY m.ROWID ASC
    LIMIT 20
  `);

  const rows = query.all(state.lastRowId) as any[];
  let maxRowId = state.lastRowId;
  let forwarded = 0;

  // Process synchronously to maintain order, async for telegram/gateway calls
  const dedupSet = new Set(state.dedupHashes || []);

  const processRows = async () => {
    for (const row of rows) {
      const senderName = resolveContactName(row.handle_id || "");
      const text = row.text || "";
      // group chats have chat_identifier starting with "chat" (e.g. "chat123456")
      const isGroup = !!(row.cache_roomnames || (row.chat_guid || "").startsWith("iMessage;+;chat"));
      const chatGuid = row.chat_guid || "";

      // B) Dedup: skip if same handle+text+date already sent
      const hash = makeDedupHash(row.handle_id || "", text, row.date || 0);
      if (dedupSet.has(hash)) {
        console.log(`[iMessage Bridge] Dedup skip ROWID ${row.ROWID}`);
        if (row.ROWID > maxRowId) maxRowId = row.ROWID;
        continue;
      }
      dedupSet.add(hash);

      // A) Original send time
      const sentTimeStr = row.date ? cocoaToJSTTimeStr(row.date) : "";

      const telegramMsgId = await sendToTelegram(
        senderName,
        text,
        chatGuid,
        row.ROWID,
        isGroup,
        sentTimeStr
      );

      if (telegramMsgId) {
        await storeMapping(
          telegramMsgId,
          row.ROWID,
          chatGuid,
          row.handle_id || "",
          senderName,
          isGroup
        );
        forwarded++;
      }

      if (row.ROWID > maxRowId) maxRowId = row.ROWID;
    }
  };

  processRows()
    .then(() => {
      state.lastRowId = maxRowId;
      state.dedupHashes = [...dedupSet];
      saveState(state);
      if (forwarded > 0)
        console.log(`[iMessage Bridge] Forwarded ${forwarded} messages`);
      db.close();
    })
    .catch((e) => {
      console.error("[iMessage Bridge] Process error:", e);
      state.lastRowId = maxRowId;
      state.dedupHashes = [...dedupSet];
      saveState(state);
      db.close();
    });
}

main();
