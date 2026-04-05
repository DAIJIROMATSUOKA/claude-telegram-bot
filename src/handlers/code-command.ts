import type { Context } from "grammy";
import { exec, execSync } from "child_process";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadJsonFile } from "../utils/json-loader";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TASK_DIR = "/tmp/claude-code-tasks";
const SPAWN_SCRIPT = resolve(REPO_DIR, "scripts/claude-code-spawn.sh");
const STATUS_SCRIPT = resolve(REPO_DIR, "scripts/claude-code-status.sh");

// Wrap user prompt with subagent delegation guidance for parallelization
function buildCodePrompt(userPrompt: string): string {
  return `${userPrompt}

[実行ガイド]
- 独立した調査・検索はTask toolのsubagentに委譲して並列化せよ
- 従量課金API使用禁止（CLI経由のみ）
- 完了時は結果を簡潔に報告`;
}

/** /code <task> -- Spawn a Claude Code background task from Telegram. */
export async function handleCode(ctx: Context): Promise<void> {
  if (!isAuthorized(ctx.from?.id, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/code\s*/, "").trim();

  // /code status
  if (args === "status") {
    try {
      const output = execSync(`bash "${STATUS_SCRIPT}" 2>&1`, {
        encoding: "utf-8",
        timeout: 10000,
        env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
      }).trim();
      await ctx.reply(output || "No status available");
    } catch (e: any) {
      await ctx.reply(`❌ Status check failed: ${e.message?.substring(0, 200)}`);
    }
    return;
  }

  // /code stop
  if (args === "stop") {
    const currentFile = `${TASK_DIR}/current.json`;
    if (!existsSync(currentFile)) {
      await ctx.reply("No running task found");
      return;
    }
    try {
      const data = loadJsonFile<any>(currentFile);
      const pid = data.pid;
      if (pid) {
        process.kill(pid, "SIGTERM");
        await ctx.reply(`🛑 Sent SIGTERM to PID ${pid} (task: ${data.task_id})`);
      } else {
        await ctx.reply("No PID in current task");
      }
    } catch (e: any) {
      await ctx.reply(`❌ Stop failed: ${e.message?.substring(0, 200)}`);
    }
    return;
  }

  // /code (no args)
  if (!args) {
    await ctx.reply("Usage:\n/code <task> — spawn Claude Code\n/code status — check running task\n/code stop — kill current task");
    return;
  }

  // /code <prompt> — spawn via claude-code-spawn.sh
  const fullPrompt = buildCodePrompt(args);
  const b64 = Buffer.from(fullPrompt).toString("base64");

  await ctx.reply(`🚀 Claude Code starting...\n📋 ${args.substring(0, 100)}${args.length > 100 ? "..." : ""}`);

  const cmd = `bash "${SPAWN_SCRIPT}" "${b64}" "${REPO_DIR}" sonnet 2>&1`;

  exec(cmd, {
    shell: "/bin/zsh",
    timeout: 30000,
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
  }, async (err, stdout, stderr) => {
    const output = (stdout || "").trim();
    if (err || output.startsWith("ERROR") || output.startsWith("BLOCKED")) {
      await ctx.reply(`❌ ${output || err?.message || "spawn failed"}`);
      return;
    }
    // Extract task_id and PID from spawn output
    const taskMatch = output.match(/SPAWNED: (\S+)/);
    const pidMatch = output.match(/PID: (\d+)/);
    const taskId = taskMatch?.[1] || "unknown";
    const pid = pidMatch?.[1] || "?";
    await ctx.reply(`✅ Spawned via spawn.sh\n🆔 ${taskId} (PID: ${pid})\nUse /code status or /code stop`);
  });
}
