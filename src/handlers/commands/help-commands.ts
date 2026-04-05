/**
 * Help & start command handlers.
 * /help, /start, help category callbacks
 */

import type { Context } from "grammy";
import { Keyboard } from "grammy";
import { session } from "../../session";
import { WORKING_DIR, ALLOWED_USERS } from "../../config";
import { isAuthorized } from "../../security";

/**
 * /start - Show welcome message and status.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  const status = session.isActive ? "Active session" : "No active session";
  const workDir = WORKING_DIR;

  const keyboard = new Keyboard()
    .text("/ai").text("/imagine").row()
    .text("/debate").text("/status")
    .resized().persistent();

  await ctx.reply(
    `🤖 <b>Claude Telegram Bot</b>\n\n` +
      `Status: ${status}\n` +
      `Working directory: <code>${workDir}</code>\n\n` +
      `<b>Commands:</b>\n` +
      `/new - Start fresh session\n` +
      `/stop - Stop current query\n` +
      `/status - Show detailed status\n` +
      `/resume - Resume last session\n` +
      `/retry - Retry last message\n` +
      `/restart - Restart the bot\n\n` +
      `<b>Tips:</b>\n` +
      `• Prefix with <code>!</code> to interrupt current query\n` +
      `• Use "think" keyword for extended reasoning\n` +
      `• Send photos, voice, or documents`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

const HELP_CATEGORIES: Record<string, { label: string; commands: Array<{ cmd: string; desc: string }> }> = {
  gyoumu: {
    label: "💼 業務",
    commands: [
      { cmd: "/spec", desc: "DJ仕様書管理" },
      { cmd: "/decide", desc: "決定事項を記録" },
      { cmd: "/decisions", desc: "決定事項一覧" },
      { cmd: "/todoist", desc: "Todoist連携" },
      { cmd: "/todo", desc: "Todoを追加" },
      { cmd: "/todos", desc: "Todo一覧" },
    ],
  },
  ai: {
    label: "🤖 AI",
    commands: [
      { cmd: "/debate", desc: "3AI評議会ディベート" },
      { cmd: "/gpt", desc: "ChatGPT直接質問" },
      { cmd: "/gem", desc: "Gemini直接質問" },
      { cmd: "/croppy", desc: "クロッピー自動承認モード" },
      { cmd: "/ai", desc: "AIセッションブリッジ" },
      { cmd: "/code", desc: "Claude Codeタスク" },
    ],
  },
  system: {
    label: "⚙️ システム",
    commands: [
      { cmd: "/status", desc: "Bot詳細ステータス" },
      { cmd: "/dashboard", desc: "ダッシュボード" },
      { cmd: "/quick", desc: "クイックパネル" },
      { cmd: "/new", desc: "セッションリセット" },
      { cmd: "/restart", desc: "Bot再起動" },
      { cmd: "/stop", desc: "クエリ停止" },
    ],
  },
  tools: {
    label: "🔧 ツール",
    commands: [
      { cmd: "/code", desc: "コードタスク実行" },
      { cmd: "/search", desc: "Web検索" },
      { cmd: "/cal", desc: "カレンダー" },
      { cmd: "/mail", desc: "メール送信" },
      { cmd: "/line", desc: "LINEメッセージ" },
      { cmd: "/morning", desc: "朝のブリーフィング" },
    ],
  },
};

/**
 * /help — Show categorized command menu with InlineKeyboard category buttons.
 */
export async function handleHelp(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💼 業務", callback_data: "help_category_gyoumu" },
        { text: "🤖 AI", callback_data: "help_category_ai" },
      ],
      [
        { text: "⚙️ システム", callback_data: "help_category_system" },
        { text: "🔧 ツール", callback_data: "help_category_tools" },
      ],
    ],
  };

  await ctx.reply(
    "❓ <b>JARVIS コマンドヘルプ</b>\n\nカテゴリを選んでください:",
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

/**
 * Handle help_category_NAME callback.
 */
export async function handleHelpCategoryCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("help_category_")) return false;

  const categoryKey = data.replace("help_category_", "");
  const category = HELP_CATEGORIES[categoryKey];

  if (!category) {
    await ctx.answerCallbackQuery({ text: "不明なカテゴリ" });
    return true;
  }

  const lines = category.commands.map((c) => `${c.cmd} — ${c.desc}`);
  const text = `${category.label} コマンド一覧\n\n` + lines.join("\n");

  try {
    await ctx.editMessageText(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ 戻る", callback_data: "help_back" }],
        ],
      },
    });
  } catch {
    await ctx.reply(text);
  }
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}

/**
 * Handle help_back callback.
 */
export async function handleHelpBackCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== "help_back") return false;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💼 業務", callback_data: "help_category_gyoumu" },
        { text: "🤖 AI", callback_data: "help_category_ai" },
      ],
      [
        { text: "⚙️ システム", callback_data: "help_category_system" },
        { text: "🔧 ツール", callback_data: "help_category_tools" },
      ],
    ],
  };

  try {
    await ctx.editMessageText(
      "❓ <b>JARVIS コマンドヘルプ</b>\n\nカテゴリを選んでください:",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    // ignore edit errors
  }
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}
