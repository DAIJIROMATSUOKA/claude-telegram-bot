/**
 * /line command - Post to LINE group or individual from Telegram
 * Usage:
 *   /line                    → list available targets (groups + individuals)
 *   /line <group> <message>  → post to group
 *   /line 1 <message>        → post by group number
 */
import { Context } from "grammy";

const LINE_WORKER_URL = process.env.LINE_WORKER_URL || "";
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

interface LineTarget {
  source_id: string;
  name: string;
  is_group: boolean;
}

async function getLineTargets(): Promise<LineTarget[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT DISTINCT source_id,
                json_extract(source_detail, '$.group_name') as name,
                json_extract(source_detail, '$.is_group') as is_group,
                json_extract(source_detail, '$.sender_name') as sender
              FROM message_mappings
              WHERE source='line'
              ORDER BY json_extract(source_detail, '$.is_group') DESC, created_at DESC
              LIMIT 30`,
      }),
    });
    const data: any = await res.json();
    return (data.results || []).map((r: any) => ({
      source_id: r.source_id,
      name: r.is_group ? (r.name || r.source_id) : (r.sender || r.name || "DM"),
      is_group: !!r.is_group,
    }));
  } catch {
    return [];
  }
}

export async function handleLinePost(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/line\s*/, "").trim();

  // No args: list groups
  if (!text) {
    const groups = await getLineTargets();
    if (groups.length === 0) {
      await ctx.reply("📋 LINE\u30b0\u30eb\u30fc\u30d7\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093");
      return;
    }
    const list = groups
      .map((g, i) => `<b>${i + 1}.</b> ${g.name || g.source_id}`)
      .join("\n");
    await ctx.reply(
      `📋 LINE\u30b0\u30eb\u30fc\u30d7\u4e00\u89a7:\n${list}\n\n\u4f7f\u3044\u65b9: <code>/line \u756a\u53f7 \u30e1\u30c3\u30bb\u30fc\u30b8</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse: /line <number_or_name> <message>
  const groups = await getLineTargets();
  let targetGroup: LineTarget | undefined;
  let message: string;

  const firstWord = text.split(/\s+/)[0];
  const rest = text.substring(firstWord.length).trim();

  // Try as number
  const num = parseInt(firstWord);
  if (!isNaN(num) && num >= 1 && num <= groups.length) {
    targetGroup = groups[num - 1];
    message = rest;
  } else {
    // Try as name match (partial)
    targetGroup = groups.find(
      (g) =>
        g.name?.toLowerCase().includes(firstWord.toLowerCase()) ||
        g.source_id === firstWord
    );
    message = targetGroup ? rest : "";
    if (!targetGroup) {
      // Maybe the whole thing is: /line <message> to the last active group
      await ctx.reply(
        `\u274c \u30b0\u30eb\u30fc\u30d7 "${firstWord}" \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n<code>/line</code> \u3067\u4e00\u89a7\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  if (!message) {
    await ctx.reply("\u274c \u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n<code>/line " + (num || firstWord) + " \u3053\u3093\u306b\u3061\u306f</code>", { parse_mode: "HTML" });
    return;
  }

  if (!LINE_WORKER_URL) {
    await ctx.reply("\u274c LINE_WORKER_URL\u672a\u8a2d\u5b9a");
    return;
  }

  const sendingMsg = await ctx.reply(`\ud83d\udce4 LINE\u9001\u4fe1\u4e2d... \u2192 ${targetGroup.name || targetGroup.source_id}`);

  try {
    const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_id: targetGroup.source_id,
        text: message,
        is_group: targetGroup.is_group,
      }),
    });
    const result: any = await res.json();

    const chatId = ctx.chat?.id!;
    try { await ctx.api.deleteMessage(chatId, sendingMsg.message_id); } catch {}

    if (result.ok) {
      const confirm = await ctx.reply(`\u2705 LINE\u9001\u4fe1\u5b8c\u4e86 \u2192 ${targetGroup.name || targetGroup.source_id}`);
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, confirm.message_id); } catch {}
      }, 5000);
    } else {
      await ctx.reply(`\u274c LINE\u9001\u4fe1\u5931\u6557: ${result.error || "unknown"}`);
    }
  } catch (e) {
    await ctx.reply(`\u274c LINE\u30a8\u30e9\u30fc: ${e}`);
  }
}
