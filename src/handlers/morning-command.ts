/**
 * /morning — Morning briefing: Gmail count, calendar events, pending tasks, git activity.
 */

import { createLogger } from "../utils/logger";
const log = createLogger("morning-command");

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { gatewayQuery } from "../services/gateway-db";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";

const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || "";
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || "";

export async function handleMorning(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("ja-JP", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [`☀️ <b>Morning Briefing</b>\n📅 ${dateStr}\n`];

  // 1. Unread Gmail count
  try {
    if (GAS_GMAIL_URL && GAS_GMAIL_KEY) {
      const url = `${GAS_GMAIL_URL}?action=count&key=${GAS_GMAIL_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "follow" });
      const data: any = await res.json();
      const count = data?.count ?? data?.unread ?? "?";
      lines.push(`📧 未読Gmail: ${count}件`);
    } else {
      lines.push("📧 未読Gmail: (GAS URL未設定)");
    }
  } catch {
    lines.push("📧 未読Gmail: —");
  }

  // 2. Today calendar events
  try {
    const cal = execSync("python3 ~/scripts/gcal-reminder.py --today 2>/dev/null || echo '(取得失敗)'", {
      shell: "/bin/zsh",
      timeout: 15000,
      encoding: "utf-8",
    }).trim();
    if (cal && cal !== "(取得失敗)") {
      lines.push(`\n📅 <b>今日の予定</b>\n${cal.slice(0, 800)}`);
    } else {
      lines.push("📅 今日の予定: (なし)");
    }
  } catch {
    lines.push("📅 今日の予定: —");
  }

  // 3. Pending tasks from D1
  try {
    const tasksRes = await gatewayQuery(
      "SELECT title FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5"
    );
    const tasks = tasksRes?.results || [];
    if (tasks.length > 0) {
      const taskList = tasks.map((t: any) => `• ${t.title}`).join("\n");
      lines.push(`\n🎯 <b>Pending Tasks</b> (${tasks.length}件)\n${taskList}`);
    } else {
      lines.push("\n🎯 Pending Tasks: なし");
    }
  } catch {
    lines.push("\n🎯 Pending Tasks: —");
  }

  // 4. Yesterday git activity
  try {
    const gitCount = execSync(
      'git -C /Users/daijiromatsuokam1/claude-telegram-bot log --since="yesterday" --oneline 2>/dev/null | wc -l',
      { timeout: 5000, encoding: "utf-8", shell: "/bin/zsh" }
    ).trim();
    lines.push(`\n📦 昨日のCommit: ${gitCount}件`);
  } catch {
    lines.push("\n📦 昨日のCommit: —");
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });

  // Write to Obsidian daily note
  try {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(jst.getUTCDate()).padStart(2, "0");
    const obsDir = `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/${y}/${mo}`;
    const obsFile = `${obsDir}/${y}-${mo}-${dd}.md`;
    const plainText = lines.join("\n").replace(/<[^>]+>/g, "");
    const section = `\n## 朝ブリーフィング\n\n${plainText}\n`;

    mkdirSync(obsDir, { recursive: true });
    if (existsSync(obsFile)) {
      const content = readFileSync(obsFile, "utf-8");
      if (!content.includes("## 朝ブリーフィング")) {
        appendFileSync(obsFile, section);
      }
    } else {
      writeFileSync(obsFile, `# ${y}-${mo}-${dd}\n${section}`);
    }
  } catch (e) {
    log.error("[Morning] Obsidian write error:", e);
  }
}
