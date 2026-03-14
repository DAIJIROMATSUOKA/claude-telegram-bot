/**
 * refresh-command.ts — G10: Access DB差分更新
 *
 * Usage:
 *   /refresh M1317  — Access DB再クエリ → 差分をプロジェクトタブに投入
 *
 * Flow: project-context-builder.sh context → compare with last → inject delta
 */

import type { Context } from "grammy";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";

const execAsync = promisify(exec);
const SCRIPTS_DIR = `${homedir()}/claude-telegram-bot/scripts`;
const TAB_ROUTER = `${SCRIPTS_DIR}/project-tab-router.sh`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const CONTEXT_BUILDER = `${SCRIPTS_DIR}/project-context-builder.sh`;
const CACHE_DIR = join(homedir(), ".jarvis/orchestrator/context-cache");

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

export async function handleRefresh(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/refresh\s*/, "").trim();

  if (!text || !/^M\d{4}$/i.test(text)) {
    await ctx.reply(
      "使い方: <code>/refresh M1317</code>\nAccess DBを再クエリしてプロジェクトタブに差分を投入します",
      { parse_mode: "HTML" },
    );
    return;
  }

  const projectId = text.toUpperCase();
  await ctx.reply(`🔄 ${projectId} のコンテキストを再取得中...`);

  // 1. Get fresh context from project-context-builder
  const freshContext = await runLocal(
    `bash "${CONTEXT_BUILDER}" context "${projectId}"`,
    60000,
  );

  if (freshContext.startsWith("ERROR:") || !freshContext.trim()) {
    await ctx.reply(`❌ コンテキスト取得失敗: <code>${escapeHtml(freshContext.substring(0, 200))}</code>`, {
      parse_mode: "HTML",
    });
    return;
  }

  // 2. Load cached context for comparison
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${projectId}.txt`);
  let cachedContext = "";
  if (existsSync(cachePath)) {
    cachedContext = readFileSync(cachePath, "utf-8");
  }

  // 3. Save new context to cache
  writeFileSync(cachePath, freshContext, "utf-8");

  // 4. Generate delta summary
  const freshLines = new Set(freshContext.split("\n").map((l) => l.trim()).filter(Boolean));
  const cachedLines = new Set(cachedContext.split("\n").map((l) => l.trim()).filter(Boolean));
  const newLines = [...freshLines].filter((l) => !cachedLines.has(l));

  if (newLines.length === 0 && cachedContext) {
    await ctx.reply(`✅ ${projectId}: 変更なし（前回と同じ）`);
    return;
  }

  // 5. Resolve project tab
  const tabWT = await runLocal(`bash "${TAB_ROUTER}" resolve "${projectId}"`, 60000);
  if (tabWT.startsWith("ERROR:") || !tabWT.trim()) {
    await ctx.reply(`❌ ${projectId} のタブが見つかりません: <code>${escapeHtml(tabWT)}</code>`, {
      parse_mode: "HTML",
    });
    return;
  }

  // 6. Build injection message
  const isFirstTime = !cachedContext;
  const injectText = isFirstTime
    ? [
        `[Access DB コンテキスト初回注入: ${projectId}]`,
        freshContext.substring(0, 3000),
        "",
        "以上の情報を参考にしてください。「了解」とだけ返答してください。",
      ].join("\n")
    : [
        `[Access DB 差分更新: ${projectId}]`,
        `新規/変更 ${newLines.length}件:`,
        "",
        newLines.slice(0, 30).join("\n"),
        newLines.length > 30 ? `\n... 他${newLines.length - 30}件` : "",
        "",
        "以上の更新情報を反映してください。「了解」とだけ返答してください。",
      ].join("\n");

  // 7. Inject via file
  const tmpFile = `/tmp/refresh-inject-${Date.now()}.txt`;
  writeFileSync(tmpFile, injectText, "utf-8");
  const injectResult = await runLocal(
    `bash "${TAB_MANAGER}" inject-file "${tabWT}" "${tmpFile}"; rm -f "${tmpFile}"`,
    20000,
  );

  if (injectResult.includes("INSERTED:SENT")) {
    const summary = isFirstTime
      ? `初回注入 (${freshContext.length}文字)`
      : `差分${newLines.length}件を投入`;
    await ctx.reply(`✅ ${projectId}: ${summary} → ${tabWT}`);
  } else {
    await ctx.reply(
      `❌ ${projectId} inject失敗: <code>${escapeHtml(injectResult.substring(0, 200))}</code>`,
      { parse_mode: "HTML" },
    );
  }
}
