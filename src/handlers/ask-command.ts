/**
 * ask-command.ts — G7: /ask Chrome版
 *
 * Usage:
 *   /ask M1319 白菜検査の進捗は？
 *   /ask M1317 見積の最新状況
 *
 * Flow: resolve project tab → inject-file → wait-response → Telegram reply
 */

import type { Context } from "grammy";
import { waitAndRelayResponse } from "./croppy-bridge";
import { writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";

const execAsync = promisify(exec);
const SCRIPTS_DIR = `${homedir()}/claude-telegram-bot/scripts`;
const TAB_ROUTER = `${SCRIPTS_DIR}/project-tab-router.sh`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function runLocal(cmd: string, timeoutMs = 30000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      shell: "/bin/zsh",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      },
    });
    return stdout.trim();
  } catch (error: any) {
    return `ERROR: ${error.message || error}`;
  }
}

/** /ask <project> <message> -- Route question to project Chrome tab. */
export async function handleAsk(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/ask\s*/, "").trim();

  if (!text) {
    await ctx.reply(
      "使い方: <code>/ask M1319 メッセージ</code>\n" +
        "例: <code>/ask M1317 見積の最新状況は？</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  // Parse: first token = project ID (M-number)
  const mMatch = text.match(/^(M\d{4})\s+/i);
  if (!mMatch) {
    await ctx.reply("❌ 案件番号(M+4桁)を指定してください\n例: <code>/ask M1317 message</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  const projectId = mMatch[1]!.toUpperCase();
  const message = text.substring(mMatch[0].length).trim();

  if (!message) {
    await ctx.reply(`❌ メッセージを指定してください\n例: <code>/ask ${projectId} 質問内容</code>`, {
      parse_mode: "HTML",
    });
    return;
  }

  // Resolve project tab
  const tabWT = await runLocal(`bash "${TAB_ROUTER}" resolve "${projectId}"`, 60000);
  if (tabWT.startsWith("ERROR:") || !tabWT.trim()) {
    await ctx.reply(`❌ ${projectId} のタブが見つかりません: <code>${escapeHtml(tabWT)}</code>`, {
      parse_mode: "HTML",
    });
    return;
  }

  // Check tab status
  const status = await runLocal(`bash "${TAB_MANAGER}" check-status "${tabWT}"`, 10000);
  if (status !== "READY") {
    await ctx.reply(`⏳ ${projectId} (${tabWT}) はまだ処理中です: ${status}`);
    return;
  }

  // Inject message via file
  const tmpFile = `/tmp/ask-inject-${Date.now()}.txt`;
  writeFileSync(tmpFile, message, "utf-8");
  const injectResult = await runLocal(
    `bash "${TAB_MANAGER}" inject-file "${tabWT}" "${tmpFile}"; rm -f "${tmpFile}"`,
    20000,
  );

  if (!injectResult.includes("INSERTED:SENT")) {
    await ctx.reply(
      `❌ ${projectId} へのinject失敗: <code>${escapeHtml(injectResult)}</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  // Delete DJ's original message
  const origMsgId = ctx.message?.message_id;
  if (origMsgId) {
    ctx.api.deleteMessage(ctx.chat!.id, origMsgId).catch(() => {});
  }

  const header = `🔍 <b>/ask ${projectId}</b>\n📝 ${escapeHtml(message.substring(0, 100))}${message.length > 100 ? "..." : ""}`;

  // Wait for response and relay
  await waitAndRelayResponse(ctx, tabWT, 180000, undefined, header);
}
