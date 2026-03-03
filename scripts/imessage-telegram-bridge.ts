/**
 * Apple Messages → Telegram Bridge
 * Polls chat.db for new incoming messages, forwards to Telegram Inbox Zero
 * LaunchAgent: com.jarvis.imessage-bridge (120s interval)
 * 
 * REQUIRES: Full Disk Access for bun (System Settings → Privacy → FDA)
 * Run: bun --env-file=.env run scripts/imessage-telegram-bridge.ts
 */

import { Database } from "bun:sqlite";
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

function loadState(): { lastRowId: number } {
  try {
    if (existsSync(STATE_FILE))
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastRowId: 0 };
}

function saveState(state: { lastRowId: number }): void {
  writeFileSync(STATE_FILE, JSON.stringify(state));
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
  isGroup: boolean
): Promise<number | null> {
  const sourceId = `imsg:${rowId}`;
  const icon = "📱";
  const groupTag = isGroup ? " (グループ)" : "";

  let body =
    `${icon} <b>${escapeHtml(senderName)}</b>${groupTag}\n` +
    escapeHtml(text);

  body = body.substring(0, 4000);

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💬返信", callback_data: `ib:imrpl:${sourceId}` },
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

function main() {
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
  const processRows = async () => {
    for (const row of rows) {
      const senderName = row.handle_id || "unknown";
      const text = row.text || "";
      const isGroup = !!(row.group_id || row.cache_roomnames);
      const chatGuid = row.chat_guid || "";

      const telegramMsgId = await sendToTelegram(
        senderName,
        text,
        chatGuid,
        row.ROWID,
        isGroup
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
      saveState(state);
      if (forwarded > 0)
        console.log(`[iMessage Bridge] Forwarded ${forwarded} messages`);
      db.close();
    })
    .catch((e) => {
      console.error("[iMessage Bridge] Process error:", e);
      state.lastRowId = maxRowId;
      saveState(state);
      db.close();
    });
}

main();
