/**
 * /quick — Quick shortcuts panel with InlineKeyboard.
 * Buttons: Git Status, Disk Usage, Poller Status, Bot Uptime, Inbox Count, System Load.
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { getUptime } from "../utils/uptime";
import { gatewayQuery } from "../services/gateway-db";
import { execSync } from "child_process";

const QUICK_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📊 Git Status", callback_data: "quick_git" },
      { text: "💾 Disk Usage", callback_data: "quick_disk" },
    ],
    [
      { text: "🔄 Poller Status", callback_data: "quick_poller" },
      { text: "🤖 Bot Uptime", callback_data: "quick_uptime" },
    ],
    [
      { text: "📬 Inbox Count", callback_data: "quick_inbox" },
      { text: "🔋 System Load", callback_data: "quick_load" },
    ],
  ],
};

export async function handleQuick(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  await ctx.reply("⚡ <b>Quick Panel</b>\n\nアクションを選んでください:", {
    parse_mode: "HTML",
    reply_markup: QUICK_KEYBOARD,
  });
}

export async function handleQuickCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("quick_")) return false;

  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.answerCallbackQuery({ text: "Unauthorized" });
    return true;
  }

  const action = data.replace("quick_", "");
  let result = "";

  try {
    switch (action) {
      case "git": {
        const out = execSync("git status --short", {
          cwd: "/Users/daijiromatsuokam1/claude-telegram-bot",
          timeout: 5000,
          encoding: "utf-8",
        }).trim();
        result = out || "（変更なし）";
        break;
      }
      case "disk": {
        result = execSync("df -h", {
          timeout: 5000,
          encoding: "utf-8",
        }).trim();
        break;
      }
      case "poller": {
        try {
          const pid = execSync("pgrep -f task-poller 2>/dev/null || echo ''", {
            timeout: 5000,
            encoding: "utf-8",
          }).trim();
          result = pid ? `✅ Poller running (PID: ${pid.split("\n")[0]})` : "⚠️ Poller not running";
        } catch {
          result = "⚠️ Poller check failed";
        }
        break;
      }
      case "uptime": {
        result = `🤖 Bot uptime: ${getUptime()}`;
        break;
      }
      case "inbox": {
        const res = await gatewayQuery(
          "SELECT COUNT(*) as cnt FROM inbox_triage_queue WHERE status = 'pending'"
        );
        const cnt = res?.results?.[0]?.cnt ?? "?";
        result = `📬 Pending inbox: ${cnt}`;
        break;
      }
      case "load": {
        result = execSync("uptime", {
          timeout: 5000,
          encoding: "utf-8",
        }).trim();
        break;
      }
      default:
        result = "Unknown action";
    }
  } catch (e: any) {
    result = `❌ Error: ${e?.message?.slice(0, 200) || String(e)}`;
  }

  // Reply with result and re-show panel buttons
  try {
    await ctx.reply(`<code>${result.slice(0, 3800)}</code>`, {
      parse_mode: "HTML",
      reply_markup: QUICK_KEYBOARD,
    });
  } catch {
    await ctx.reply(result.slice(0, 3800));
  }
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}
