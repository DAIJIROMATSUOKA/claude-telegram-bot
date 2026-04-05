/**
 * Status & monitoring command handlers.
 * /status, /stats
 */

import type { Context } from "grammy";
import { session } from "../../session";
import { WORKING_DIR, ALLOWED_USERS } from "../../config";
import { isAuthorized } from "../../security";
import { formatMetricsForStatus } from "../../utils/metrics";
import { getUptime } from "../../utils/uptime";
import { memoryGatewayBreaker, geminiBreaker } from "../../utils/circuit-breaker";
import { getBgTaskSummary } from "../../utils/bg-task-manager";

/**
 * /status - Show detailed status.
 */
export async function handleStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const lines: string[] = ["📊 <b>Bot Status</b>\n"];

  // Uptime
  lines.push(`⏳ Uptime: ${getUptime()}`);

  // Session status
  if (session.isActive) {
    lines.push(`✅ Session: Active (${session.sessionId?.slice(0, 8)}...)`);
  } else {
    lines.push("⚪ Session: None");
  }

  // Query status
  if (session.isRunning) {
    const elapsed = session.queryStarted
      ? Math.floor((Date.now() - session.queryStarted.getTime()) / 1000)
      : 0;
    lines.push(`🔄 Query: Running (${elapsed}s)`);
    if (session.currentTool) {
      lines.push(`   └─ ${session.currentTool}`);
    }
  } else {
    lines.push("⚪ Query: Idle");
    if (session.lastTool) {
      lines.push(`   └─ Last: ${session.lastTool}`);
    }
  }

  // Last activity
  if (session.lastActivity) {
    const ago = Math.floor(
      (Date.now() - session.lastActivity.getTime()) / 1000
    );
    lines.push(`\n⏱️ Last activity: ${ago}s ago`);
  }

  // Usage stats
  if (session.lastUsage) {
    const usage = session.lastUsage;
    lines.push(
      `\n📈 Last query usage:`,
      `   Input: ${usage.input_tokens?.toLocaleString() || "?"} tokens`,
      `   Output: ${usage.output_tokens?.toLocaleString() || "?"} tokens`
    );
    if (usage.cache_read_input_tokens) {
      lines.push(
        `   Cache read: ${usage.cache_read_input_tokens.toLocaleString()}`
      );
    }
  }

  // Error status
  if (session.lastError) {
    const ago = session.lastErrorTime
      ? Math.floor((Date.now() - session.lastErrorTime.getTime()) / 1000)
      : "?";
    lines.push(`\n⚠️ Last error (${ago}s ago):`, `   ${session.lastError}`);
  }

  // Working directory
  lines.push(`\n📁 Working dir: <code>${WORKING_DIR}</code>`);

  // Circuit Breaker status
  const mgStatus = memoryGatewayBreaker.getStatus();
  const gmStatus = geminiBreaker.getStatus();
  lines.push(`\n🔌 Circuit Breakers:`);
  lines.push(`   MemoryGW: ${mgStatus.state} (成功率${mgStatus.successRate}%)`);
  lines.push(`   Gemini: ${gmStatus.state} (成功率${gmStatus.successRate}%)`);

  // Background task summary
  const bgSummary = getBgTaskSummary();
  if (bgSummary.total > 0) {
    lines.push(`\n⚙️ BG Tasks: ${bgSummary.successes}/${bgSummary.total} OK`);
    if (bgSummary.recentFailures.length > 0) {
      for (const f of bgSummary.recentFailures.slice(-3)) {
        lines.push(`   ❌ ${f.name}: ${f.error?.slice(0, 60)}`);
      }
    }
  }

  // Performance metrics
  lines.push(`\n${formatMetricsForStatus(1)}`);

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

// Bot start timestamp for uptime calculation
const BOT_START_TIME = Date.now();

// Simple message counter
let messageCount = 0;
/** Increment the global message counter for /stats. */
export function incrementMessageCount(): void {
  messageCount++;
}

/**
 * /stats - Show bot statistics (message count, uptime).
 */
export async function handleStats(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const uptimeMs = Date.now() - BOT_START_TIME;
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;

  const sessionStatus = session.isActive ? "Active" : "Inactive";
  const queryStatus = session.isRunning ? "Running" : "Idle";

  const lines: string[] = [
    "📊 <b>Bot Stats</b>\n",
    `💬 Messages processed: ${messageCount}`,
    `⏱️ Uptime: ${uptimeStr}`,
    `🔗 Session: ${sessionStatus}`,
    `⚙️ Query: ${queryStatus}`,
  ];

  if (session.lastUsage) {
    const totalInput = session.lastUsage.input_tokens || 0;
    const totalOutput = session.lastUsage.output_tokens || 0;
    lines.push(`\n📈 Last query tokens: ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
