/**
 * /scout command handler
 * - /scout → show latest report summary + actions
 * - /scout N → execute action N from latest scout report
 */

import type { Context } from "grammy";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { existsSync } from "fs";
import { loadJsonFile } from "../utils/json-loader";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const ACTIONS_FILE = "/tmp/jarvis-scout/actions.json";

interface ScoutAction {
  number: number;
  label: string;
  command: string;
}

function loadActions(): ScoutAction[] {
  return loadJsonFile<ScoutAction[]>(ACTIONS_FILE, []);
}

export async function handleScout(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const arg = text.replace(/^\/scout\s*/, "").trim();

  // /scout → show actions
  if (!arg) {
    const actions = loadActions();
    if (actions.length === 0) {
      await ctx.reply("🔭 推奨アクションなし（Scoutレポートが未生成 or アクションなし）");
      return;
    }
    const lines = actions.map(
      (a) => `${a.number}️⃣ ${(a as any).safe ? "🤖" : "👤"} ${a.label}`
    );
    await ctx.reply(
      `🔭 Scout 推奨アクション\n\n${lines.join("\n")}\n\n→ /scout N で実行`
    );
    return;
  }

  // /scout N → execute action
  const num = parseInt(arg, 10);
  if (isNaN(num)) {
    await ctx.reply("⚠️ 番号を指定: /scout 1");
    return;
  }

  const actions = loadActions();
  const action = actions.find((a) => a.number === num);
  if (!action) {
    await ctx.reply(`⚠️ アクション ${num} が見つかりません`);
    return;
  }

  await ctx.reply(`⚙️ 実行中: ${action.label}`);

  try {
    const { stdout, stderr } = await execAsync(action.command, {
      cwd: `${process.env.HOME}/claude-telegram-bot`,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });

    const output = (stdout || "").substring(0, 3000);
    const errOutput = (stderr || "").substring(0, 500);
    let msg = `✅ ${action.label}\n\n${output}`;
    if (errOutput.trim()) msg += `\n\nSTDERR: ${errOutput}`;
    await ctx.reply(msg.substring(0, 4000));
  } catch (error: any) {
    const msg = error.message || "Unknown error";
    await ctx.reply(`❌ ${action.label}\n\n${msg.substring(0, 2000)}`);
  }
}
