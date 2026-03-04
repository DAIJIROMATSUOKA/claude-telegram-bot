/**
 * /cal — Google Calendar + Todoist 統合コマンド
 *
 * /cal              → 今日の予定 + タスク
 * /cal tomorrow     → 明日
 * /cal week         → 今週
 * /cal add <text>   → イベント作成（自然言語）→ 完了後に両メッセージ自動削除
 * /cal task <text>  → Todoistタスク追加 → 完了後に両メッセージ自動削除
 * /cal done <id>    → Todoistタスク完了 → 完了後に両メッセージ自動削除
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";

const execAsync = promisify(exec);
const SCRIPT = join(homedir(), "claude-telegram-bot/scripts/gcal-todoist.py");
const TIMEOUT = 30_000; // 30秒
const READ_CMDS = new Set(["today", "tomorrow", "week"]);
const AUTO_DELETE_MS = 3_000; // 3秒後に削除

export async function handleCal(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const chatId = ctx.chat?.id;
  const userMsgId = ctx.message?.message_id;
  const text = ctx.message?.text || "";
  const args = text.replace(/^\/cal\s*/, "").trim();
  const subcommand = args.split(/\s+/)[0]?.toLowerCase() || "today";
  const rest = args.replace(/^\S+\s*/, "").trim();

  const cmd = !args ? "today" : subcommand;

  let pyArgs: string[];

  switch (cmd) {
    case "today":
      pyArgs = ["today"];
      break;
    case "tomorrow":
      pyArgs = ["tomorrow"];
      break;
    case "week":
      pyArgs = ["week"];
      break;
    case "add": {
      if (!rest) {
        await ctx.reply("使い方: /cal add 明日14時 打ち合わせ\n（Googleの自然言語解析を使用。英語も可）");
        return;
      }
      pyArgs = ["add", rest];
      break;
    }
    case "task": {
      if (!rest) {
        await ctx.reply("使い方: /cal task タスク名");
        return;
      }
      pyArgs = ["task", rest];
      break;
    }
    case "done": {
      if (!rest) {
        await ctx.reply("使い方: /cal done <task_id>");
        return;
      }
      pyArgs = ["done", rest];
      break;
    }
    default:
      // 引数全体をそのまま "add" として扱う（/cal 明日14時 打ち合わせ）
      pyArgs = ["add", args];
  }

  const isWriteCmd = !READ_CMDS.has(cmd);

  await ctx.replyWithChatAction("typing");

  try {
    const quotedArgs = pyArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const { stdout, stderr } = await execAsync(
      `python3 ${SCRIPT} ${quotedArgs}`,
      { timeout: TIMEOUT, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
    );

    const output = stdout.trim() || stderr.trim() || "(出力なし)";
    const replyMsg = await ctx.reply(output, { parse_mode: "HTML" });

    // 書き込み系コマンドは完了後に両メッセージを自動削除
    if (isWriteCmd && chatId) {
      setTimeout(async () => {
        try { await ctx.api.deleteMessage(chatId, replyMsg.message_id); } catch {}
        try { if (userMsgId) await ctx.api.deleteMessage(chatId, userMsgId); } catch {}
      }, AUTO_DELETE_MS);
    }
  } catch (e: any) {
    const msg = e.stdout?.trim() || e.stderr?.trim() || e.message || "不明なエラー";
    await ctx.reply(`❌ エラー:\n<code>${msg.substring(0, 500)}</code>`, { parse_mode: "HTML" });
  }
}
