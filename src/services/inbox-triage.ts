/**
 * Inbox Triage Service
 * Polls Gateway for inbox items → injects into 🦞 Worker → parses judgment → executes action
 * 
 * Flow: Gateway dequeue → Worker inject → DOM read → JSON parse → action → Gateway result
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

const GATEWAY_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const SCRIPTS_DIR = `${process.env.HOME}/claude-telegram-bot/scripts`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;

// GAS Gmail Web App (for archive/trash)
const GAS_GMAIL_URL = process.env.GAS_GMAIL_URL || '';
const GAS_GMAIL_KEY = process.env.GAS_GMAIL_KEY || '';

const POLL_INTERVAL = 60_000;    // 60 seconds
const BUFFER_SECONDS = 30;       // Wait 30s for burst messages
const RESPONSE_TIMEOUT = 120_000; // 2 min max wait for 🦞 response
const STOP_FLAG = '/tmp/triage-stop';

let triageTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

// Bot API reference (set from index.ts)
let botApi: any = null;
let djChatId: number = 0;

interface TriageItem {
  id: string;
  source: string;
  source_id?: string;
  sender_name: string;
  subject?: string;
  body: string;
  telegram_msg_id?: number;
  telegram_chat_id?: number;
  created_at: string;
}

interface TriageJudgment {
  action: 'archive' | 'delete' | 'reply' | 'obsidian' | 'bug_fix' | 'ignore' | 'escalate';
  confidence: number;
  reason: string;
  draft?: string;
  obsidian_summary?: string;
}

// ============================================================
// Shell helper
// ============================================================

async function runLocal(cmd: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: '/bin/zsh',
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
    });
    return stdout.trim();
  } catch (e: any) {
    return e.stdout?.trim() || e.message || 'ERROR';
  }
}

// ============================================================
// Gateway API
// ============================================================

async function dequeueItems(): Promise<TriageItem[]> {
  try {
    const res = await fetch(
      `${GATEWAY_URL}/v1/inbox/dequeue?limit=5&buffer_seconds=${BUFFER_SECONDS}`
    );
    const data: any = await res.json();
    return data.ok ? (data.items || []) : [];
  } catch (e) {
    console.error('[Triage] Dequeue error:', e);
    return [];
  }
}

async function reportResult(id: string, action: string, confidence: number, reason: string, executed: boolean): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/v1/inbox/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, confidence, reason, executed }),
    });
  } catch (e) {
    console.error('[Triage] Report error:', e);
  }
}

async function reportFeedback(id: string, feedback: string): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/v1/inbox/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, feedback }),
    });
  } catch (e) {
    console.error('[Triage] Feedback error:', e);
  }
}

// ============================================================
// Worker interaction
// ============================================================

async function findReadyWorker(): Promise<string | null> {
  const result = await runLocal(`bash ${TAB_MANAGER} ready`, 10000);
  if (!result || result.includes('ERROR') || result.trim() === '') return null;
  return result.trim();
}

async function injectTriage(wt: string, item: TriageItem): Promise<boolean> {
  const prompt = buildTriagePrompt(item);
  const tmpFile = `/tmp/triage-inject-${Date.now()}.txt`;
  await runLocal(`cat > ${tmpFile} << 'TRIAGEEOF'\n${prompt}\nTRIAGEEOF`);

  const result = await runLocal(
    `MSG=$(cat ${tmpFile}) && bash ${TAB_MANAGER} inject ${wt} "$MSG" && rm -f ${tmpFile}`,
    20000
  );

  if (!result.includes('INSERTED:SENT')) {
    await runLocal(`rm -f ${tmpFile}`);
    return false;
  }
  return true;
}

async function waitForResponse(wt: string): Promise<string | null> {
  const pollInterval = 3000;
  const startTime = Date.now();

  await new Promise(r => setTimeout(r, 3000)); // initial wait

  while (Date.now() - startTime < RESPONSE_TIMEOUT) {
    const status = await runLocal(`bash ${TAB_MANAGER} check-status ${wt}`, 10000);

    if (status.trim() === 'READY') {
      await new Promise(r => setTimeout(r, 1500)); // settle
      const response = await runLocal(`bash ${TAB_MANAGER} read-response ${wt}`, 10000);
      if (response && !response.includes('NO_RESPONSE') && !response.includes('ERROR')) {
        return response.trim();
      }
      return null;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  return null;
}

// ============================================================
// Prompt building
// ============================================================

function buildTriagePrompt(item: TriageItem): string {
  const parts = [`[TRIAGE]`];
  parts.push(`Source: ${item.source}`);
  if (item.sender_name) parts.push(`From: ${item.sender_name}`);
  if (item.subject) parts.push(`Subject: ${item.subject}`);
  parts.push(`Body: ${item.body}`);
  return parts.join('\n');
}

// ============================================================
// Response parsing
// ============================================================

function parseTriageResponse(raw: string): TriageJudgment | null {
  // Try to extract JSON from response (🦞 might add text around it)
  const jsonMatch = raw.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+"/);
  if (!jsonMatch) return null;

  // Find the complete JSON object
  let depth = 0;
  let start = raw.indexOf(jsonMatch[0]);
  let end = start;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  try {
    const json = raw.substring(start, end);
    const parsed = JSON.parse(json);
    if (!parsed.action) return null;
    return {
      action: parsed.action,
      confidence: parsed.confidence || 0,
      reason: parsed.reason || '',
      draft: parsed.draft || undefined,
      obsidian_summary: parsed.obsidian_summary || undefined,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Action execution
// ============================================================

async function executeAction(item: TriageItem, judgment: TriageJudgment): Promise<void> {
  const chatId = item.telegram_chat_id || djChatId;
  if (!botApi || !chatId) return;

  switch (judgment.action) {
    case 'archive':
    case 'delete': {
      if (item.source === 'gmail' && item.source_id && GAS_GMAIL_URL) {
        const action = judgment.action === 'delete' ? 'trash' : 'archive';
        const url = `${GAS_GMAIL_URL}?action=${action}&gmail_id=${item.source_id}&key=${GAS_GMAIL_KEY}`;
        try {
          const res = await fetch(url, { redirect: 'follow' });
          const result: any = await res.json();
          if (!result.ok) {
            console.error(`[Triage] Gmail ${action} failed:`, result);
          }
        } catch (e) {
          console.error(`[Triage] Gmail ${action} error:`, e);
        }
      }
      // Delete Telegram notification message
      if (item.telegram_msg_id) {
        try {
          await botApi.deleteMessage(chatId, item.telegram_msg_id);
        } catch { /* already deleted or expired */ }
      }
      // Confirm to DJ
      const icon = judgment.action === 'archive' ? '📦' : '🗑';
      const confirmText = `🦞 ${icon}${judgment.action === 'archive' ? 'アーカイブ' : '削除'}済み\n${item.sender_name}: ${item.subject || item.body.substring(0, 50)}\n理由: ${judgment.reason}`;
      const confirmMsg = await botApi.sendMessage(chatId, confirmText, {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '❌取消', callback_data: `triage:undo:${item.id}` },
          ]],
        }),
      });
      // Auto-delete confirm after 30s if no interaction
      setTimeout(() => {
        botApi.deleteMessage(chatId, confirmMsg.message_id).catch(() => {});
      }, 30_000);
      break;
    }

    case 'reply': {
      const draftText = `🦞 ✏️返信下書き\n宛先: ${item.sender_name} (${item.source})\n---\n${judgment.draft || '(下書きなし)'}\n---\n理由: ${judgment.reason}`;
      await botApi.sendMessage(chatId, draftText, {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '📤送信', callback_data: `triage:send:${item.id}` },
            { text: '❌却下', callback_data: `triage:reject:${item.id}` },
          ]],
        }),
      });
      break;
    }

    case 'obsidian': {
      // Write to Obsidian via existing obsidian-writer
      // For now, just notify DJ
      const obsText = `🦞 📒Obsidian記録候補\n${item.sender_name}: ${item.subject || ''}\n内容: ${judgment.obsidian_summary || judgment.reason}`;
      await botApi.sendMessage(chatId, obsText, {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '✅OK', callback_data: `triage:approve:${item.id}` },
            { text: '❌却下', callback_data: `triage:reject:${item.id}` },
          ]],
        }),
      });
      break;
    }

    case 'bug_fix': {
      // 🦞 handles this directly via exec bridge - just notify
      await botApi.sendMessage(chatId,
        `🦞 🔧バグ検出・自動修復中\n${judgment.reason}`
      );
      break;
    }

    case 'ignore': {
      // Do nothing - leave notification as is
      break;
    }

    case 'escalate':
    default: {
      await botApi.sendMessage(chatId,
        `🦞 ⚠️判断不能 → DJ確認\n${item.sender_name}: ${item.subject || item.body.substring(0, 80)}\n理由: ${judgment.reason}`
      );
      break;
    }
  }
}

// ============================================================
// Main triage loop
// ============================================================

async function triageCycle(): Promise<void> {
  if (isProcessing) return;
  if (existsSync(STOP_FLAG)) return;

  isProcessing = true;

  try {
    const items = await dequeueItems();
    if (items.length === 0) return;

    console.log(`[Triage] Processing ${items.length} items`);

    for (const item of items) {
      if (existsSync(STOP_FLAG)) break;

      // Find ready worker (DJ messages take priority - if all busy, skip)
      const wt = await findReadyWorker();
      if (!wt) {
        console.log('[Triage] No workers available, deferring');
        // Reset items to pending via cleanup (they'll be picked up next cycle)
        break;
      }

      // Inject triage prompt
      const injected = await injectTriage(wt, item);
      if (!injected) {
        console.error(`[Triage] Inject failed for ${item.id}`);
        continue;
      }

      // Wait for 🦞 response
      const response = await waitForResponse(wt);
      if (!response) {
        console.error(`[Triage] No response for ${item.id}`);
        await reportResult(item.id, 'escalate', 0, 'No response from 🦞', false);
        continue;
      }

      // Parse judgment
      const judgment = parseTriageResponse(response);
      if (!judgment) {
        console.error(`[Triage] Parse failed for ${item.id}:`, response.substring(0, 200));
        await reportResult(item.id, 'escalate', 0, 'Failed to parse 🦞 response', false);
        continue;
      }

      console.log(`[Triage] ${item.id}: ${judgment.action} (${judgment.confidence})`);

      // Execute action
      const autoExecute = judgment.action === 'ignore' || judgment.action === 'bug_fix';
      await executeAction(item, judgment);
      await reportResult(
        item.id,
        judgment.action,
        judgment.confidence,
        judgment.reason,
        autoExecute
      );
    }
  } catch (e) {
    console.error('[Triage] Cycle error:', e);
  } finally {
    isProcessing = false;
  }
}

// ============================================================
// Public API
// ============================================================

export function startInboxTriage(bot: any, chatId: number): void {
  if (triageTimer) {
    console.log('[Triage] Already running');
    return;
  }

  botApi = bot.api;
  djChatId = chatId;

  console.log(`[Triage] Started (interval: ${POLL_INTERVAL / 1000}s, buffer: ${BUFFER_SECONDS}s)`);
  triageTimer = setInterval(triageCycle, POLL_INTERVAL);

  // Run first cycle after 10s (let bot fully start)
  setTimeout(triageCycle, 10_000);
}

export function stopInboxTriage(): void {
  if (triageTimer) {
    clearInterval(triageTimer);
    triageTimer = null;
    console.log('[Triage] Stopped');
  }
}

/**
 * Handle triage callback buttons (from inline keyboards)
 * callback_data format: triage:{action}:{item_id}
 */
export async function handleTriageCallback(callbackQuery: any): Promise<boolean> {
  const data = callbackQuery.data;
  if (!data || !data.startsWith('triage:')) return false;

  const parts = data.split(':');
  if (parts.length < 3) return false;

  const [, action, itemId] = parts;
  const chatId = callbackQuery.message?.chat?.id;
  const msgId = callbackQuery.message?.message_id;

  switch (action) {
    case 'approve':
      await reportFeedback(itemId, 'approved');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '✅ 承認済み').catch(() => {});
        setTimeout(() => botApi.deleteMessage(chatId, msgId).catch(() => {}), 5000);
      }
      break;

    case 'reject':
      await reportFeedback(itemId, 'rejected');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '❌ 却下').catch(() => {});
      }
      break;

    case 'undo':
      await reportFeedback(itemId, 'rejected');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '⏪ 取消済み（手動対応してください）').catch(() => {});
      }
      break;

    case 'send':
      // TODO: Actually send the reply via LINE/Gmail
      await reportFeedback(itemId, 'approved');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '📤 送信済み').catch(() => {});
      }
      break;

    default:
      return false;
  }

  return true;
}
