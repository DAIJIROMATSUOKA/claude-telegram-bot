/**
 * Croppy Bridge Handler - Dispatch tasks to 🦞 worker tabs via osascript
 * 
 * Telegram commands:
 *   /bridge <task>     - Send task to first READY worker
 *   /bridge status     - Show worker tab health
 *   /bridge nightshift - Toggle night mode
 *   /workers           - Alias for /bridge status
 */

import { exec } from 'child_process';
import { writeFileSync as bwSync } from 'fs';
import { promisify } from 'util';
import type { Context } from 'grammy';
import { escapeHtml } from '../formatting';

const execAsync = promisify(exec);

const SCRIPTS_DIR = `${process.env.HOME}/claude-telegram-bot/scripts`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const NIGHTSHIFT = `${SCRIPTS_DIR}/nightshift.sh`;
const SUPERVISOR = `${SCRIPTS_DIR}/croppy-supervisor.sh`;

const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}_\d{4}/;
const HANDOFF_PREFIX_RE = /^\d{5,6}_/;  // MMDD{seq}_ from api-handoff.sh

// Bridge reply routing: Telegram msgId -> Worker tab (wt)
// Enables reply-chain: DJ replies to bridge response -> same worker tab
const bridgeReplyMap = new Map<number, string>();
const BRIDGE_REPLY_MAP_MAX = 100;

// Worker-level lock: prevents concurrent inject to same worker
const lockedWorkers = new Set<string>();
const lockedWorkersTimestamps = new Map<string, number>();
const LOCKED_WORKERS_TTL = 60 * 60 * 1000; // 1 hour (stale lock eviction)
setInterval(() => {
  const now = Date.now();
  for (const [wt, ts] of lockedWorkersTimestamps) {
    if (now - ts > LOCKED_WORKERS_TTL) {
      lockedWorkers.delete(wt);
      lockedWorkersTimestamps.delete(wt);
    }
  }
}, 60_000).unref();

// Check if a WT belongs to a project tab (skip J-WORKER marking for these)
function isProjectTab(wt: string): boolean {
  try {
    const mapPath = `${process.env.HOME}/.croppy-project-tabs.json`;
    const { existsSync, readFileSync } = require('fs');
    if (!existsSync(mapPath)) return false;
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    return Object.values(map).some((v: any) => typeof v === 'string' && v.includes(`|${wt}`));
  } catch { return false; }
}

/** Register a Telegram message ID as belonging to a specific worker tab for reply routing. */
export function registerBridgeReply(msgId: number, wt: string): void {
  bridgeReplyMap.set(msgId, wt);
  // Evict oldest if over limit
  if (bridgeReplyMap.size > BRIDGE_REPLY_MAP_MAX) {
    const oldest = bridgeReplyMap.keys().next().value;
    if (oldest !== undefined) bridgeReplyMap.delete(oldest);
  }
}

/**
 * Format conversation title with JST date prefix (fire-and-forget after response)
 */
async function formatConversationTitle(wt: string): Promise<void> {
  try {
    const raw = await runLocal(`bash ${TAB_MANAGER} get-title "${wt}"`, 8000);
    if (!raw || raw.startsWith("ERROR")) return;

    // Skip if already date-prefixed or still default
    const DEFAULT_RE = /^(Jarvis|New conversation|新しい会話|Claude|Untitled|Loading|claude\.ai|\[J-WORKER|\s*)$/i;
    const cleaned = raw.trim()
      .replace(/^\[J-WORKER-\d+\]\s*/i, "")
      .replace(/\s*-\s*Claude\s*$/i, "")
      .trim();
    if (DEFAULT_RE.test(cleaned) || DATE_PREFIX_RE.test(cleaned) || HANDOFF_PREFIX_RE.test(cleaned) || !cleaned) return;

    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const h = String(jst.getUTCHours()).padStart(2, "0");
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");
    const formatted = `${y}-${mo}-${d}_${h}${mi}_${cleaned}`;

    const escaped = formatted.replace(/'/g, "'\\''" );
    await runLocal(`bash ${TAB_MANAGER} rename-conversation "${wt}" '${escaped}'`, 15000);
    console.log(`[Bridge] Renamed conversation: ${formatted}`);

    // Re-mark worker tab (rename-conversation triggers title update that overwrites [J-WORKER-N])
    const workerMatch = raw.match(/\[J-WORKER-(\d+)\]/);
    if (workerMatch) {
      await runLocal(`bash ${TAB_MANAGER} mark ${wt} ${workerMatch[1]}`, 8000);
    }
  } catch (e) {
    console.error("[Bridge] formatConversationTitle error:", e);
  }
}

// --- Worker inject counter (auto-handoff at threshold) ---
const INJECT_WARN_THRESHOLD = 25;
const INJECT_HANDOFF_THRESHOLD = 30;
const workerInjectCounts: Map<string, number> = new Map(); // key = W:T
const workerInjectCountsTimestamps: Map<string, number> = new Map();
const WORKER_INJECT_MAX = 1000;
const WORKER_INJECT_TTL = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of workerInjectCountsTimestamps) {
    if (now - ts > WORKER_INJECT_TTL) {
      workerInjectCounts.delete(key);
      workerInjectCountsTimestamps.delete(key);
    }
  }
}, 60_000).unref();

function getInjectCount(wt: string): number {
  return workerInjectCounts.get(wt) || 0;
}
function incrementInjectCount(wt: string): number {
  const count = getInjectCount(wt) + 1;
  workerInjectCounts.set(wt, count);
  workerInjectCountsTimestamps.set(wt, Date.now());
  if (workerInjectCounts.size > WORKER_INJECT_MAX) {
    const oldest = workerInjectCounts.keys().next().value;
    if (oldest !== undefined) { workerInjectCounts.delete(oldest); workerInjectCountsTimestamps.delete(oldest); }
  }
  return count;
}
function resetInjectCount(wt: string): void {
  workerInjectCounts.delete(wt);
}


/**
 * Run a local shell command on M1
 */
async function runLocal(cmd: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      shell: '/bin/zsh',
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

/**
 * Build the worker prompt with context
 */
function buildWorkerPrompt(task: string): string {
  const timestamp = new Date().toISOString();
  return [
    `[JARVIS TASK - ${timestamp}]`,
    ``,
    `${task}`,
    ``,
    `## 作業ルール（厳守）`,
    ``,
    `### 粒度ルール`,
    `- 1回の応答でツール呼び出しは最大2回まで`,
    `- 2回で終わらない場合→途中結果をnotify-dj.shで報告して停止`,
    `- 続行指示が来たら次の2回を実行`,
    ``,
    `### 応答ルール`,
    `- Artifactを作成した場合、本文にも要約を書く（Artifact見なくても概要がわかるように）`,
    `- 決定事項は【決定】マーク付きで明示`,
    `- 応答は短く。長文はファイルに書き出してパスだけ返す`,
    `- コード変更は差分のみ報告（全文貼り付け禁止）`,
    ``,
    `### 完了時`,
    `1. exec bridge経由で結果をM1に書き込む`,
    `2. bash /mnt/project/exec.sh "bash ~/claude-telegram-bot/scripts/notify-dj.sh '✅ 完了: ${task.substring(0, 40)}...'" "" 15`,
    `3. エラー時も通知: notify-dj.sh 'FAIL: 理由'`,
  ].join('\n');
}

/**
 * Handle /bridge command
 */
export async function handleBridgeCommand(ctx: Context): Promise<void> {
  const text = ctx.message?.text || '';
  const args = text.replace(/^\/bridge\s*/, '').replace(/^\/workers\s*/, '').trim();

  // /bridge status or /workers
  if (!args || args === 'status' || text.startsWith('/workers')) {
    await handleBridgeStatus(ctx);
    return;
  }

  // /bridge nightshift
  if (args === 'nightshift' || args === 'night') {
    await handleNightshift(ctx);
    return;
  }

  // /bridge setup N or /workers setup N - setup N worker tabs
  if (args.startsWith("setup")) {
    const n = Math.min(10, Math.max(1, parseInt(args.split(/\s+/)[1] || "10") || 10));
    await ctx.reply(`Setting up ${n} workers...`);
    const result = await runLocal(`bash ${TAB_MANAGER} setup-workers ${n}`, 120000);
    await ctx.reply(`Workers ready:
<code>${escapeHtml(result)}</code>`, { parse_mode: "HTML" });
    return;
  }

  // /bridge <task> - dispatch to worker
  await dispatchToWorker(ctx, args);
}

/**
 * Show worker tab status
 */
async function handleBridgeStatus(ctx: Context): Promise<void> {
  const health = await runLocal(`bash ${TAB_MANAGER} health`);
  const nightStatus = await runLocal(`bash ${NIGHTSHIFT} status`);

  let msg = '🦞 <b>Croppy Bridge Status</b>\n\n';

  if (health.includes('NO_WORKERS')) {
    msg += '⚠️ No worker tabs found\n';
    msg += 'Mark tabs with: <code>croppy-tab-manager.sh mark W:T N</code>\n';
  } else if (health.includes('CHROME_NOT_RUNNING')) {
    msg += '❌ Chrome not running\n';
  } else {
    const lines = health.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        const wt = parts[0];
        const status = parts[2];
        const icon = status === 'READY' ? '🟢' : status === 'BUSY' ? '🟡' : '🔴';
        msg += `${icon} <code>${wt}</code> ${status}\n`;
      }
    }
  }

  // Locked workers
  if (lockedWorkers.size > 0) {
    msg += '\n🔒 <b>Locked (responding):</b> ';
    msg += [...lockedWorkers].map(w => `<code>${escapeHtml(w)}</code>`).join(', ');
    msg += '\n';
  }

  // Inject counts
  if (workerInjectCounts.size > 0) {
    msg += '\n📊 <b>Inject counts:</b>\n';
    for (const [wt, count] of workerInjectCounts) {
      const bar = count >= INJECT_WARN_THRESHOLD ? '⚠️' : '✅';
      msg += `${bar} <code>${escapeHtml(wt)}</code>: ${count}/${INJECT_HANDOFF_THRESHOLD}\n`;
    }
  }

  msg += '\n' + nightStatus.split('\n').map(l => `<code>${escapeHtml(l)}</code>`).join('\n');

  await ctx.reply(msg, { parse_mode: 'HTML' });
}

/**
 * Toggle night mode
 */
async function handleNightshift(ctx: Context): Promise<void> {
  const status = await runLocal(`bash ${NIGHTSHIFT} status`);

  if (status.includes('ACTIVE')) {
    await ctx.reply('🌙 Night mode active. Stopping...');
    const result = await runLocal(`bash ${NIGHTSHIFT} stop`);
    await ctx.reply(`☀️ Night mode stopped.\n<code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply('☀️ Night mode inactive. Starting...');
    const result = await runLocal(`bash ${NIGHTSHIFT} start`, 30000);
    await ctx.reply(`🌙 Night mode started.\n<code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
  }
}

/**
 * Dispatch a task to the first available worker tab
 */
export async function dispatchToWorker(ctx: Context, task: string, options?: { raw?: boolean }): Promise<void> {
  // 1. Find READY worker (skip locked/busy ones)
  const allReadyRaw = await runLocal(`bash ${TAB_MANAGER} ready`);
  const readyWT = (allReadyRaw && !allReadyRaw.includes('ERROR'))
    ? (allReadyRaw.split('\n').map(l => l.trim()).find(l => l && !lockedWorkers.has(l)) || '')
    : '';

  if (!readyWT) {
    // Check health for more info
    const health = await runLocal(`bash ${TAB_MANAGER} health`);

    if (health.includes('BUSY')) {
      await ctx.reply('🟡 All workers busy. Task queued for retry...');
      // TODO: implement task queue
      // For now, wait and retry once
      await new Promise(r => setTimeout(r, 30000));
      const retryAllRaw = await runLocal(`bash ${TAB_MANAGER} ready`);
      const retryWT = (retryAllRaw && !retryAllRaw.includes('ERROR'))
        ? (retryAllRaw.split('\n').map(l => l.trim()).find(l => l && !lockedWorkers.has(l)) || '')
        : '';
      if (!retryWT) {
        await ctx.reply('❌ Workers still busy after 30s. Try again later.');
        return;
      }
      await injectAndNotify(ctx, retryWT.trim(), task, options?.raw);
    } else if (health.includes('NO_WORKERS') || health.includes('CHROME_NOT_RUNNING')) {
      // Auto-recover: restore worker tabs from config
      console.log('[Bridge] No workers found, attempting auto-recover...');
      const recoverResult = await runLocal(`bash ${TAB_MANAGER} recover`, 30000);
      if (recoverResult.includes('RESTORED')) {
        // Wait for tabs to load
        await new Promise(r => setTimeout(r, 8000));
        const recoveredWT = await runLocal(`bash ${TAB_MANAGER} ready`);
        if (recoveredWT && recoveredWT.trim() !== '' && !recoveredWT.includes('ERROR')) {
          console.log(`[Bridge] Auto-recovered, dispatching to ${recoveredWT.trim()}`);
          await injectAndNotify(ctx, recoveredWT.trim(), task, options?.raw);
          return;
        }
      }
      await ctx.reply(`❌ Auto-recover failed.\n<code>${escapeHtml(recoverResult)}</code>`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(`❌ No workers available.\n<code>${escapeHtml(health)}</code>`, { parse_mode: 'HTML' });
    }
    return;
  }

  await injectAndNotify(ctx, readyWT.trim(), task, options?.raw);
}

/**
 * Inject task into worker tab and notify DJ
 */
async function injectAndNotify(ctx: Context, wt: string, task: string, raw = false): Promise<void> {
  const prompt = raw ? task : buildWorkerPrompt(task);

  // Lock this worker until response is relayed
  lockedWorkers.add(wt);
  lockedWorkersTimestamps.set(wt, Date.now());

  const tmpFile = `/tmp/croppy-bridge-task-${Date.now()}.txt`;
  // Write to temp file and use inject-file (avoids all shell escaping)
  bwSync(tmpFile, prompt, 'utf-8');

  const result = await runLocal(
    `bash ${TAB_MANAGER} inject-file ${wt} ${tmpFile}; rm -f ${tmpFile}`,
    20000
  );

  if (result.includes('INSERTED:SENT')) {
    const count = incrementInjectCount(wt);
    let statusTag = '';

    if (count >= INJECT_HANDOFF_THRESHOLD) {
      // Auto-handoff: rotate to new chat
      statusTag = `\n🔄 Handoff triggered (${count} turns)`;
      await runLocal(`bash ${SUPERVISOR} handoff ${wt}`, 60000);
      resetInjectCount(wt);
    } else if (count >= INJECT_WARN_THRESHOLD) {
      statusTag = `\n⚠️ ${count}/${INJECT_HANDOFF_THRESHOLD} turns (auto-handoff soon)`;
    }

    // Delete original DJ message immediately
    const origMsgId = ctx.message?.message_id;
    if (origMsgId) {
      ctx.api.deleteMessage(ctx.chat!.id, origMsgId).catch(() => {});
    }

    const dispatchHeader = `🦞 Task dispatched to <code>${escapeHtml(wt)}</code> [${count}/${INJECT_HANDOFF_THRESHOLD}]\n📝 ${escapeHtml(task.substring(0, 100))}${task.length > 100 ? '...' : ''}${statusTag}`;

    // Wait for response and relay to Telegram (non-blocking for handoff case)
    if (count < INJECT_HANDOFF_THRESHOLD) {
      waitAndRelayResponse(ctx, wt, 180000, undefined, dispatchHeader).catch(e => 
        console.error('[Bridge] Relay error:', e)
      );
    }
  } else if (result.includes('BLOCKED')) {
    lockedWorkers.delete(wt);
    await ctx.reply(`⚠️ Worker ${wt} blocked: <code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
  } else {
    lockedWorkers.delete(wt);
    await ctx.reply(`❌ Inject failed: <code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
    // Cleanup temp file
    await runLocal(`rm -f ${tmpFile}`);
  }
}


/**
 * Wait for worker to finish (BUSY → READY), then read response and relay to Telegram
 */
export async function waitAndRelayResponse(ctx: Context, wt: string, maxWaitMs = 180000, dispatchMsgId?: number, dispatchHeader?: string): Promise<void> {
  const pollInterval = 3000;
  const startTime = Date.now();

  // Wait for worker to start processing
  await new Promise(r => setTimeout(r, 3000));

  // Poll using position-based check (not title-based health)
  while (Date.now() - startTime < maxWaitMs) {
    const status = await runLocal(`bash ${TAB_MANAGER} check-status ${wt}`, 10000);

    if (status.trim() === 'READY') {
      // Stability check: wait, re-check status, read only after confirmed stable
      // Prevents false READY during tool-use gaps (web search, code exec)
      await new Promise(r => setTimeout(r, 3000));
      const recheck1 = await runLocal(`bash ${TAB_MANAGER} check-status ${wt}`, 10000);
      if (recheck1.trim() === 'BUSY') continue; // tool-use cycle, keep polling
      await new Promise(r => setTimeout(r, 3000));
      const recheck2 = await runLocal(`bash ${TAB_MANAGER} check-status ${wt}`, 10000);
      if (recheck2.trim() === 'BUSY') continue; // still in tool-use, keep polling
      // Double-READY confirmed (6s apart) → safe to read
      const response = await runLocal(`bash ${TAB_MANAGER} read-response ${wt}`, 10000);
      
      if (response && !response.includes('NO_RESPONSE') && !response.includes('ERROR')) {
        // Remove consecutive duplicate lines (claude.ai thinking indicators + UI duplication)
        const dedupLines: string[] = [];
        for (const line of response.split('\n')) {
          if (dedupLines.length === 0 || line.trim() !== dedupLines[dedupLines.length - 1]!.trim() || line.trim() === '') {
            dedupLines.push(line);
          }
        }
        const cleanResponse = dedupLines.join('\n').trim();
        // Split for Telegram 4096 char limit
        const headerLen = dispatchHeader ? dispatchHeader.length + 2 : 0;
        const maxLen = 4000;
        const chunks: string[] = [];
        let remaining = cleanResponse;
        while (remaining.length > 0) {
          const limit = chunks.length === 0 ? maxLen - headerLen : maxLen;
          chunks.push(remaining.substring(0, limit));
          remaining = remaining.substring(limit);
        }
        for (let i = 0; i < chunks.length; i++) {
          try {
            const text: string = (i === 0 && dispatchHeader) ? `${dispatchHeader}\n\n${chunks[i]}` : chunks[i]!
            const sent = await ctx.reply(text, { parse_mode: i === 0 && dispatchHeader ? 'HTML' : undefined });
            registerBridgeReply(sent.message_id, wt);
          } catch (e) {
            console.error('[Bridge] Reply error:', e);
          }
        }
      }

      // Unlock worker
      lockedWorkers.delete(wt);

      // Skip rename/re-mark for project tabs (they have their own naming)
      if (!isProjectTab(wt)) {
        // Fire-and-forget: rename conversation with date prefix
        formatConversationTitle(wt).catch(e => console.error('[Bridge] Title format error:', e));

        // Re-mark tab title (claude.ai overwrites it with conversation title)
        const workerList = await runLocal(`bash ${TAB_MANAGER} list`);
        if (!workerList.includes(wt)) {
          const num = wt.endsWith(':5') ? '1' : wt.endsWith(':6') ? '2' : '1';
          await runLocal(`bash ${TAB_MANAGER} mark ${wt} ${num}`);
        }
      }
      return;
    }
    
    await new Promise(r => setTimeout(r, pollInterval));
  }
  
  // Timeout - unlock worker
  lockedWorkers.delete(wt);
  try {
    await ctx.reply('⏱ Worker still running after 3min. Check /workers for status.');
  } catch {}
}

/**
 * Handle replies to bridge response messages -> route to same worker tab
 */
export async function handleBridgeReply(ctx: Context): Promise<boolean> {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return false;

  const wt = bridgeReplyMap.get(replyToId);
  if (!wt) return false;

  const rawMessage = ctx.message?.text || "";
  if (!rawMessage || rawMessage.startsWith("/")) return false;

  const chatId = ctx.chat?.id;
  const djMsgId = ctx.message?.message_id;
  if (!chatId) return false;

  // Clean up old mapping (new response will create new entry via waitAndRelayResponse)
  bridgeReplyMap.delete(replyToId);

  // Delete old response message and DJ's reply (same UX as /chat)
  try { await ctx.api.deleteMessage(chatId, replyToId); } catch {}
  if (djMsgId) { try { await ctx.api.deleteMessage(chatId, djMsgId); } catch {} }

  // Inject to the same worker tab (raw mode, same conversation)
  await injectAndNotify(ctx, wt!, rawMessage, true);

  return true;
}

// escapeHtml imported from ../formatting
