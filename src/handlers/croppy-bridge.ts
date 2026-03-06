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
import { promisify } from 'util';
import type { Context } from 'grammy';

const execAsync = promisify(exec);

const SCRIPTS_DIR = `${process.env.HOME}/claude-telegram-bot/scripts`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const NIGHTSHIFT = `${SCRIPTS_DIR}/nightshift.sh`;
const SUPERVISOR = `${SCRIPTS_DIR}/croppy-supervisor.sh`;

// --- Worker inject counter (auto-handoff at threshold) ---
const INJECT_WARN_THRESHOLD = 25;
const INJECT_HANDOFF_THRESHOLD = 30;
const workerInjectCounts: Map<string, number> = new Map(); // key = W:T

function getInjectCount(wt: string): number {
  return workerInjectCounts.get(wt) || 0;
}
function incrementInjectCount(wt: string): number {
  const count = getInjectCount(wt) + 1;
  workerInjectCounts.set(wt, count);
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
        const title = parts[1];
        const status = parts[2];
        const icon = status === 'READY' ? '🟢' : status === 'BUSY' ? '🟡' : '🔴';
        msg += `${icon} <code>${wt}</code> ${status}\n`;
      }
    }
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
async function dispatchToWorker(ctx: Context, task: string): Promise<void> {
  // 1. Find READY worker
  const readyWT = await runLocal(`bash ${TAB_MANAGER} ready`);

  if (!readyWT || readyWT.includes('ERROR') || readyWT.trim() === '') {
    // Check health for more info
    const health = await runLocal(`bash ${TAB_MANAGER} health`);

    if (health.includes('BUSY')) {
      await ctx.reply('🟡 All workers busy. Task queued for retry...');
      // TODO: implement task queue
      // For now, wait and retry once
      await new Promise(r => setTimeout(r, 30000));
      const retryWT = await runLocal(`bash ${TAB_MANAGER} ready`);
      if (!retryWT || retryWT.trim() === '') {
        await ctx.reply('❌ Workers still busy after 30s. Try again later.');
        return;
      }
      await injectAndNotify(ctx, retryWT.trim(), task);
    } else {
      await ctx.reply(`❌ No workers available.\n<code>${escapeHtml(health)}</code>`, { parse_mode: 'HTML' });
    }
    return;
  }

  await injectAndNotify(ctx, readyWT.trim(), task);
}

/**
 * Inject task into worker tab and notify DJ
 */
async function injectAndNotify(ctx: Context, wt: string, task: string): Promise<void> {
  const prompt = buildWorkerPrompt(task);

  // Escape for shell - write to temp file to avoid escaping issues
  const tmpFile = `/tmp/croppy-bridge-task-${Date.now()}.txt`;
  await runLocal(`cat > ${tmpFile} << 'TASKEOF'\n${prompt}\nTASKEOF`);

  // Read from file and inject (avoids shell escaping)
  const result = await runLocal(
    `MSG=$(cat ${tmpFile}) && bash ${TAB_MANAGER} inject ${wt} "$MSG" && rm -f ${tmpFile}`,
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

    await ctx.reply(
      `🦞 Task dispatched to <code>${escapeHtml(wt)}</code> [${count}/${INJECT_HANDOFF_THRESHOLD}]\n` +
      `📝 ${escapeHtml(task.substring(0, 100))}${task.length > 100 ? '...' : ''}${statusTag}`,
      { parse_mode: 'HTML' }
    );
  } else if (result.includes('BLOCKED')) {
    await ctx.reply(`⚠️ Worker ${wt} blocked: <code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`❌ Inject failed: <code>${escapeHtml(result)}</code>`, { parse_mode: 'HTML' });
    // Cleanup temp file
    await runLocal(`rm -f ${tmpFile}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
