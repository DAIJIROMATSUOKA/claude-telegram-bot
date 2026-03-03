/**
 * /imsg command - Send iMessage/SMS from Telegram via AppleScript
 * Usage:
 *   /imsg                          → list recent contacts
 *   /imsg 電話番号 メッセージ       → send to phone
 *   /imsg 番号 メッセージ           → send by contact number
 */
import { Context } from "grammy";

const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

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

export async function handleImsgSend(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/imsg\s*/, "").trim();

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
    await ctx.reply(
      `📱 iMessage連絡先:\n${list}\n\n使い方: <code>/imsg 番号 メッセージ</code>\nまたは: <code>/imsg +8180XXXXXXXX メッセージ</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const contacts = await getRecentContacts();
  let targetHandle: string;
  let targetLabel: string;
  let message: string;

  const firstWord = text.split(/\s+/)[0];
  const rest = text.substring(firstWord.length).trim();

  // Try as number (contact list index)
  const num = parseInt(firstWord);
  if (!isNaN(num) && num >= 1 && num <= contacts.length) {
    const c = contacts[num - 1];
    targetHandle = c.handle_id;
    targetLabel = c.sender_name || c.handle_id;
    message = rest;
  } else if (firstWord.startsWith("+") || firstWord.match(/^[0-9]/)) {
    // Direct phone number
    targetHandle = firstWord;
    targetLabel = firstWord;
    message = rest;
  } else {
    // Try name match
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

  if (!message) {
    await ctx.reply("❌ メッセージを入力してください。\n<code>/imsg " + (num || firstWord) + " こんにちは</code>", { parse_mode: "HTML" });
    return;
  }

  const sendingMsg = await ctx.reply(`📤 iMessage送信中... → ${targetLabel}`);

  try {
    const escapedText = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedHandle = targetHandle.replace(/"/g, '\\"');
    const script =
      'tell application "Messages"\n' +
      "  set targetService to 1st service whose service type = iMessage\n" +
      '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
      '  send "' + escapedText + '" to targetBuddy\n' +
      "end tell";

    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if (exitCode === 0) {
      const confirm = await ctx.reply(`✅ iMessage送信完了 → ${targetLabel}`);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      // SMS fallback
      const smsScript =
        'tell application "Messages"\n' +
        "  set targetService to 1st service whose service type = SMS\n" +
        '  set targetBuddy to buddy "' + escapedHandle + '" of targetService\n' +
        '  send "' + escapedText + '" to targetBuddy\n' +
        "end tell";
      const smsProc = Bun.spawn(["osascript", "-e", smsScript], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const smsExit = await smsProc.exited;

      if (smsExit === 0) {
        const confirm = await ctx.reply(`✅ SMS送信完了 → ${targetLabel}`);
        setTimeout(async () => {
          try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
        }, 5000);
      } else {
        const smsStderr = await new Response(smsProc.stderr).text();
        await ctx.reply(("❌ iMessage/SMS送信失敗:\n" + (stderr || smsStderr)).substring(0, 500));
      }
    }
  } catch (e) {
    await ctx.reply(`❌ iMessageエラー: ${e}`);
  }
}
