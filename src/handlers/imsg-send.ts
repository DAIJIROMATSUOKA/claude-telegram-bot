/**
 * /imsg command - Send iMessage/SMS from Telegram via AppleScript
 * Usage:
 *   /imsg                          → list recent contacts
 *   /imsg 電話番号 メッセージ       → send to phone
 *   /imsg 番号 メッセージ           → send by contact number
 *
 * Attachment: Send a file first → bot stores it → /imsg picks it up automatically
 * Files are saved to /tmp/jarvis-attach/ and sent via AppleScript POSIX file
 */
import { Context } from "grammy";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { getPendingAttach, clearPendingAttach } from "../utils/attach-pending";
import { downloadTgFile } from "../utils/tg-file";

const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ATTACH_DIR = "/tmp/jarvis-attach";

interface ImsgContact {
  handle_id: string;
  sender_name: string;
}

async function getRecentContacts(): Promise<ImsgContact[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT DISTINCT
                json_extract(source_detail, '$.handle_id') as handle_id,
                json_extract(source_detail, '$.sender_name') as sender_name
              FROM message_mappings
              WHERE source='imessage'
                AND json_extract(source_detail, '$.handle_id') IS NOT NULL
              ORDER BY created_at DESC LIMIT 15`,
      }),
    });
    const data: any = await res.json();
    return (data.results || []).filter((r: any) => r.handle_id);
  } catch {
    return [];
  }
}

/** Run AppleScript and return { exitCode, stderr } */
async function runScript(script: string): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

/** Send text via iMessage with SMS fallback */
async function sendImsgText(handle: string, text: string): Promise<{ ok: boolean; via: string; error: string }> {
  const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedHandle = handle.replace(/"/g, '\\"');

  const iMsgScript =
    'tell application "Messages"\n' +
    "  set targetService to 1st service whose service type = iMessage\n" +
    '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
    '  send "' + escapedText + '" to targetBuddy\n' +
    "end tell";

  const { exitCode, stderr } = await runScript(iMsgScript);
  if (exitCode === 0) return { ok: true, via: "iMessage", error: "" };

  // SMS fallback
  const smsScript =
    'tell application "Messages"\n' +
    "  set targetService to 1st service whose service type = SMS\n" +
    '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
    '  send "' + escapedText + '" to targetBuddy\n' +
    "end tell";

  const sms = await runScript(smsScript);
  if (sms.exitCode === 0) return { ok: true, via: "SMS", error: "" };

  return { ok: false, via: "", error: (stderr || sms.stderr).substring(0, 300) };
}

/** Send file attachment via iMessage */
async function sendImsgFile(handle: string, filePath: string): Promise<{ ok: boolean; error: string }> {
  const escapedHandle = handle.replace(/"/g, '\\"');
  const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const script =
    'tell application "Messages"\n' +
    "  set targetService to 1st service whose service type = iMessage\n" +
    '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
    '  send (POSIX file "' + escapedPath + '") to targetBuddy\n' +
    "end tell";

  const { exitCode, stderr } = await runScript(script);
  return { ok: exitCode === 0, error: stderr.substring(0, 300) };
}

/** /imsg -- Send iMessage/SMS from Telegram via AppleScript. */
export async function handleImsgSend(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/imsg\s*/, "").trim();
  const userId = ctx.from?.id;

  // No args: list contacts
  if (!text) {
    const contacts = await getRecentContacts();
    if (contacts.length === 0) {
      await ctx.reply("📱 iMessage連絡先が見つかりません（受信履歴なし）");
      return;
    }
    const list = contacts
      .map((c, i) => `<b>${i + 1}.</b> ${c.sender_name || c.handle_id}${c.sender_name ? " (" + c.handle_id + ")" : ""}`)
      .join("\n");
    const pendingFile = userId ? getPendingAttach(userId) : null;
    const pendingNote = pendingFile ? `\n\n📎 保留中: <b>${pendingFile.filename}</b>` : "";
    await ctx.reply(
      `📱 iMessage連絡先:\n${list}\n\n使い方: <code>/imsg 番号 メッセージ</code>\nまたは: <code>/imsg +8180XXXXXXXX メッセージ</code>${pendingNote}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const contacts = await getRecentContacts();
  let targetHandle: string;
  let targetLabel: string;
  let message: string;

  const firstWord = text.split(/\s+/)[0]!;
  const rest = text.substring(firstWord.length).trim();

  // Try as number (contact list index)
  const num = parseInt(firstWord);
  if (!isNaN(num) && num >= 1 && num <= contacts.length) {
    const c = contacts[num - 1]!;
    targetHandle = c.handle_id;
    targetLabel = c.sender_name || c.handle_id;
    message = rest;
  } else if (firstWord.startsWith("+") || firstWord.match(/^[0-9]/)) {
    targetHandle = firstWord;
    targetLabel = firstWord;
    message = rest;
  } else {
    const match = contacts.find(
      (c) => c.sender_name?.toLowerCase().includes(firstWord.toLowerCase())
    );
    if (match) {
      targetHandle = match.handle_id;
      targetLabel = match.sender_name || match.handle_id;
      message = rest;
    } else {
      await ctx.reply(
        `❌ 連絡先 "${firstWord}" が見つかりません。\n<code>/imsg</code> で一覧を確認してください。`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // Check pending attachment
  const pendingFile = userId ? getPendingAttach(userId) : null;

  if (!message && !pendingFile) {
    await ctx.reply("❌ メッセージを入力してください。\n<code>/imsg " + (num || firstWord) + " こんにちは</code>", { parse_mode: "HTML" });
    return;
  }

  const attachLabel = pendingFile ? ` 📎 ${pendingFile.filename}` : "";
  const sendingMsg = await ctx.reply(`📤 iMessage送信中... → ${targetLabel}${attachLabel}`);
  const chatId = ctx.chat?.id!;

  try {
    let textOk = true;
    let fileOk = true;
    let via = "iMessage";
    let errors: string[] = [];

    // Send file first (if pending)
    if (pendingFile && userId) {
      try {
        const fileData = await downloadTgFile(pendingFile, BOT_TOKEN);

        // Save to temp dir
        mkdirSync(ATTACH_DIR, { recursive: true });
        const safeName = pendingFile.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const tmpPath = `${ATTACH_DIR}/${Date.now()}_${safeName}`;
        writeFileSync(tmpPath, fileData.buffer);

        const result = await sendImsgFile(targetHandle, tmpPath);

        // Cleanup temp file
        try { unlinkSync(tmpPath); } catch {}

        if (result.ok) {
          clearPendingAttach(userId);
        } else {
          fileOk = false;
          errors.push(`ファイル送信失敗: ${result.error}`);
        }
      } catch (e: any) {
        fileOk = false;
        errors.push(`ダウンロード失敗: ${e.message}`);
      }
    }

    // Send text (if provided)
    if (message) {
      const result = await sendImsgText(targetHandle, message);
      textOk = result.ok;
      via = result.via;
      if (!result.ok) errors.push(result.error);
    }

    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if ((textOk || !message) && (fileOk || !pendingFile)) {
      const parts = [
        `✅ ${via}送信完了 → ${targetLabel}`,
        pendingFile && fileOk ? `📎 ${pendingFile.filename}` : null,
      ].filter(Boolean).join("\n");
      const confirm = await ctx.reply(parts);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      await ctx.reply(`❌ 送信失敗:\n${errors.join("\n")}`);
    }
  } catch (e) {
    await ctx.reply(`❌ iMessageエラー: ${e}`);
  }
}
