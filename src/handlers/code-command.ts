import type { Context } from "grammy";
import { exec } from "child_process";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function handleCode(ctx: Context): Promise<void> {
  if (!isAuthorized(ctx.from?.id, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/code\s*/, "").trim();

  if (!prompt) {
    await ctx.reply("Usage: /code <task>\nEx: /code git log --oneline -5");
    return;
  }

  await ctx.reply(`🚀 Claude Code starting...\n📋 ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}`);

  // Spawn Claude Code as independent process (nohup prevents SIGTERM cascade)
  const cmd = `cd ${REPO_DIR} && nohup claude -p --dangerously-skip-permissions ${JSON.stringify(prompt)} > /tmp/claude-code-output.log 2>&1 & echo $!`;

  exec(cmd, { shell: "/bin/zsh", env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` } }, async (err, stdout) => {
    const pid = stdout?.trim();
    if (err || !pid) {
      await ctx.reply(`❌ Failed: ${err?.message || "unknown"}`);
      return;
    }
    await ctx.reply(`✅ Claude Code spawned (PID: ${pid})\nStop hook will notify on completion`);
  });
}
