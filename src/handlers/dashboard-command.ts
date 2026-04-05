/**
 * /dashboard — Single-message dashboard: uptime, triage count, pending tasks, git, disk.
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import { getUptime } from "../utils/uptime";
import { gatewayQuery } from "../services/gateway-db";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function handleDashboard(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const lines: string[] = ["📈 <b>JARVIS Dashboard</b>\n"];

  // Uptime
  lines.push(`⏳ Uptime: ${getUptime()}`);

  // Today triage count
  try {
    const triageRes = await gatewayQuery(
      "SELECT COUNT(*) as cnt FROM inbox_triage_queue WHERE date(created_at) = date('now')"
    );
    const cnt = triageRes?.results?.[0]?.cnt ?? "?";
    lines.push(`📬 Today triage: ${cnt}`);
  } catch {
    lines.push("📬 Today triage: —");
  }

  // Pending tasks
  try {
    const tasksRes = await gatewayQuery(
      "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'pending'"
    );
    const cnt = tasksRes?.results?.[0]?.cnt ?? "?";
    lines.push(`🎯 Pending tasks: ${cnt}`);
  } catch {
    lines.push("🎯 Pending tasks: —");
  }

  // Git unpushed count
  try {
    const { stdout: unpushed } = await execAsync("git rev-list @{u}..HEAD --count 2>/dev/null || echo 0", {
      cwd: "/Users/daijiromatsuokam1/claude-telegram-bot",
      timeout: 5000,
    });
    lines.push(`📦 Unpushed commits: ${unpushed.trim()}`);
  } catch {
    lines.push("📦 Unpushed commits: —");
  }

  // Disk usage
  try {
    const { stdout: diskOut } = await execAsync("df -h / | tail -1", { timeout: 5000 });
    const disk = diskOut.trim();
    // Format: Filesystem Size Used Avail Use% Mounted
    const parts = disk.split(/\s+/);
    if (parts.length >= 5) {
      lines.push(`💾 Disk: ${parts[2]} used / ${parts[1]} (${parts[4]})`);
    } else {
      lines.push(`💾 Disk: ${disk}`);
    }
  } catch {
    lines.push("💾 Disk: —");
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
