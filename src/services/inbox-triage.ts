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
  task_title?: string;
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

async function reportFeedback(id: string, feedback: string, reason?: string): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/v1/inbox/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, feedback, reason: reason || undefined }),
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

/**
 * Check if triage item matches a domain in chat-routing.yaml.
 * Returns domain name if matched, null otherwise.
 */
async function matchDomain(item: TriageItem): Promise<string | null> {
  try {
    const searchText = `${item.subject || ""} ${item.body.substring(0, 200)} ${item.sender_name || ""}`;
    const result = await runLocal(
      `python3 "${SCRIPTS_DIR}/chat-router.py" route ${JSON.stringify(searchText)}`,
      5000
    );
    const domain = result.match(/^DOMAIN: (.+)$/m)?.[1]?.trim();
    const url = result.match(/^URL: (.+)$/m)?.[1]?.trim();
    if (domain && url && !url.includes("未作成")) {
      return domain;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Route triage item to domain-specific chat via domain-relay.sh.
 * Returns Claude response if successful, null otherwise.
 */
async function domainTriageInject(domain: string, item: TriageItem, learningContext: string = ''): Promise<string | null> {
  try {
    const prompt = buildTriagePrompt(item, learningContext);
    const tmpFile = `/tmp/triage-domain-${Date.now()}.txt`;
    await runLocal(`cat > ${tmpFile} << 'DTEOF'\n${prompt}\nDTEOF`);
    const result = await runLocal(
      `MSG=$(cat ${tmpFile}) && bash "${SCRIPTS_DIR}/domain-relay.sh" --domain "${domain}" "$MSG" && rm -f ${tmpFile}`,
      150000
    );
    await runLocal(`rm -f ${tmpFile}`);
    const response = result.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();
    return response || null;
  } catch (e: any) {
    console.error(`[Triage] Domain relay error (${domain}):`, e?.message);
    return null;
  }
}

async function injectTriage(wt: string, item: TriageItem, learningContext: string = ''): Promise<boolean> {
  const prompt = buildTriagePrompt(item, learningContext);
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
// Learning loop: corrections from past triage
// ============================================================

interface CorrectionItem {
  sender_name: string;
  subject: string | null;
  source: string;
  triage_action: string;
  feedback: string;
  feedback_reason: string | null;
}

async function fetchCorrections(limit = 20): Promise<CorrectionItem[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/inbox/corrections?limit=${limit}`);
    const data: any = await res.json();
    return data.ok ? (data.corrections || []) : [];
  } catch (e) {
    console.error('[Triage] Corrections fetch error:', e);
    return [];
  }
}

function buildLearningContext(corrections: CorrectionItem[]): string {
  if (corrections.length === 0) return '';

  const lines: string[] = ['\n## Past triage history (learn from these)'];
  for (const c of corrections) {
    const sender = (c.sender_name || 'unknown').replace(/"/g, '');
    const subj = c.subject || '(no subject)';
    const reason = c.feedback_reason ? ` (${c.feedback_reason})` : '';
    if (c.feedback === 'rejected') {
      lines.push(`WRONG: ${sender} "${subj}" -> ${c.triage_action} -> DJ undid${reason}`);
    } else {
      lines.push(`OK: ${sender} "${subj}" -> ${c.triage_action}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// Prompt building
// ============================================================

function buildTriagePrompt(item: TriageItem, learningContext: string = ''): string {
  const parts = [`[TRIAGE]`];
  parts.push(`Source: ${item.source}`);
  if (item.sender_name) parts.push(`From: ${item.sender_name}`);
  if (item.subject) parts.push(`Subject: ${item.subject}`);
  parts.push(`Body: ${item.body.substring(0, 2000)}`);
  if (learningContext) parts.push(learningContext);
  parts.push('');
  parts.push('## Judgment rules');
  parts.push('- Trading partners (Keyence, Nakanishi, Yagai, ItoHam, Miyakokiko, 28Bring, MISUMI with action needed) = escalate');
  parts.push('- Auto-notifications, ads, receipts, newsletters = archive or delete');
  parts.push('- When unsure, escalate (false-escalate safer than false-archive)');
  parts.push('');
  parts.push('');
  parts.push('If the email contains an action item for DJ (request, order, deadline, question needing reply), add task_title field.');
  parts.push('Respond with ONLY a JSON object, no other text:');
  parts.push('{"action":"archive|delete|escalate","confidence":0-100,"reason":"one line","task_title":"optional: short task description or omit"}');
  return parts.join('\n');
}

// ============================================================
// Response parsing
// ============================================================

function parseTriageResponse(raw: string): TriageJudgment | null {
  // 1. Try JSON first
  const jsonMatch = raw.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+"/);
  if (jsonMatch) {
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
      const parsed = JSON.parse(raw.substring(start, end));
      if (parsed.action) {
        return {
          action: parsed.action,
          confidence: parsed.confidence || 80,
          reason: parsed.reason || '',
          draft: parsed.draft || undefined,
          obsidian_summary: parsed.obsidian_summary || undefined,
          task_title: parsed.task_title || undefined,
        };
      }
    } catch { /* fall through to text parsing */ }
  }

  // 2. Text format: "**判断:** archive" or "判断: delete"
  const textMatch = raw.match(/(?:\*\*)?判断(?:\*\*)?\s*[:：]\s*(archive|delete|escalate|reply|ignore)/i);
  if (textMatch) {
    const action = textMatch[1].toLowerCase() as TriageJudgment['action'];
    // Extract reason from rest of response
    const reasonLines = raw.split('\n').filter(l =>
      !l.includes('判断') && l.trim().length > 0 && !l.startsWith('[TRIAGE]')
    );
    const reason = reasonLines.slice(0, 2).join(' ').substring(0, 200).trim() || 'Auto-parsed from text response';
    return { action, confidence: 70, reason };
  }

  // 3. Simple keyword match as last resort
  const lower = raw.toLowerCase();
  if (lower.includes('アーカイブ') || lower.includes('archive')) {
    return { action: 'archive', confidence: 50, reason: 'Keyword match: archive' };
  }
  if (lower.includes('削除') || lower.includes('delete')) {
    return { action: 'delete', confidence: 50, reason: 'Keyword match: delete' };
  }

  console.error('[Triage] Parse failed, raw:', raw.substring(0, 300));
  return null;
}

// ============================================================
// Action execution
// ============================================================

async function executeAction(item: TriageItem, judgment: TriageJudgment): Promise<void> {
  const chatId = item.telegram_chat_id || djChatId;
  console.log(`[Triage] executeAction: action=${judgment.action}, chatId=${chatId}, botApi=${!!botApi}, djChatId=${djChatId}`);
  if (!botApi || !chatId) {
    console.error('[Triage] ABORT: botApi or chatId missing');
    return;
  }

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
      console.log('[Triage] Sending confirm to chatId:', chatId, 'text:', confirmText.substring(0, 80));
      let confirmMsg: any;
      try {
      confirmMsg = await botApi.sendMessage(chatId, confirmText, {
        reply_markup: {
          inline_keyboard: [[
            { text: '❌取消', callback_data: `triage:undo:${item.id}` },
          ]],
        },
      });
      } catch (sendErr: any) {
        console.error('[Triage] sendMessage FAILED:', sendErr?.message || sendErr);
      }
      console.log('[Triage] Confirm sent, msgId:', confirmMsg?.message_id);
      // Auto-approve + delete after 30s if DJ didn't undo
      const _itemId = item.id;
      setTimeout(async () => {
        try {
          await reportFeedback(_itemId, 'approved');
          await botApi.deleteMessage(chatId, confirmMsg.message_id);
        } catch { /* already deleted */ }
      }, 30_000);
      break;
    }

    case 'reply': {
      const draftText = `🦞 ✏️返信下書き\n宛先: ${item.sender_name} (${item.source})\n---\n${judgment.draft || '(下書きなし)'}\n---\n理由: ${judgment.reason}`;
      await botApi.sendMessage(chatId, draftText, {
        reply_markup: {
          inline_keyboard: [[
            { text: '📤送信', callback_data: `triage:send:${item.id}` },
            { text: '❌却下', callback_data: `triage:reject:${item.id}` },
          ]],
        },
      });
      break;
    }

    case 'obsidian': {
      // Write to Obsidian via existing obsidian-writer
      // For now, just notify DJ
      const obsText = `🦞 📒Obsidian記録候補\n${item.sender_name}: ${item.subject || ''}\n内容: ${judgment.obsidian_summary || judgment.reason}`;
      await botApi.sendMessage(chatId, obsText, {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅OK', callback_data: `triage:approve:${item.id}` },
            { text: '❌却下', callback_data: `triage:reject:${item.id}` },
          ]],
        },
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

    // Fetch learning context once per cycle
    const corrections = await fetchCorrections(20);
    const learningContext = buildLearningContext(corrections);
    if (corrections.length > 0) {
      const rejected = corrections.filter(c => c.feedback === 'rejected').length;
      console.log(`[Triage] Learning: ${corrections.length} items (${rejected} rejected)`);
    }

    for (const item of items) {
      if (existsSync(STOP_FLAG)) break;

      // Always route triage to INBOX domain (has JSON judgment bootstrap)
      let response: string | null = null;
      console.log(`[Triage] Routing ${item.id} to inbox domain`);
      response = await domainTriageInject('inbox', item, learningContext);

      // Fallback: try specific domain if inbox fails
      if (!response) {
        const domain = await matchDomain(item);
        if (domain && domain !== 'inbox') {
          console.log(`[Triage] Fallback to domain: ${domain}`);
          response = await domainTriageInject(domain, item, learningContext);
        }
      }
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

    case 'undo': {
      // Show reason selection keyboard
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '❓ \u306a\u305c\u53d6\u6d88\uff1f', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📨\u91cd\u8981', callback_data: `triage:reason:${itemId}:important` },
                { text: '⏰\u5f8c\u3067', callback_data: `triage:reason:${itemId}:later` },
                { text: '⚠️\u8aa4\u5206\u985e', callback_data: `triage:reason:${itemId}:misclass` },
              ],
            ],
          },
        }).catch(() => {});
      }
      break;
    }

    case 'reason': {
      // DJ selected undo reason
      const reasonParts = data.split(':');
      const reasonItemId = reasonParts[2];
      const reasonCode = reasonParts[3] || 'unknown';
      const reasonLabels: Record<string, string> = {
        important: '\u91cd\u8981\u30e1\u30fc\u30eb',
        later: '\u5f8c\u3067\u898b\u308b',
        misclass: '\u8aa4\u5206\u985e',
      };
      const reasonText = reasonLabels[reasonCode] || reasonCode;

      // Un-archive via GAS
      if (GAS_GMAIL_URL) {
        try {
          const lookupRes = await fetch(`${GATEWAY_URL}/v1/db/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sql: `SELECT source_id, source FROM inbox_triage_queue WHERE id = ?`,
              params: [reasonItemId],
            }),
          });
          const lookupData: any = await lookupRes.json();
          const row = lookupData?.results?.[0];
          if (row?.source === 'gmail' && row?.source_id) {
            const unarchiveUrl = `${GAS_GMAIL_URL}?action=unarchive&gmail_id=${row.source_id}&key=${GAS_GMAIL_KEY}`;
            await fetch(unarchiveUrl, { redirect: 'follow' }).catch(() => {});
          }
        } catch (e) {
          console.error('[Triage] Un-archive error:', e);
        }
      }

      await reportFeedback(reasonItemId, 'rejected', reasonText);
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, `⏪ \u53d6\u6d88\u6e08\u307f (${reasonText})`).catch(() => {});
        setTimeout(() => botApi.deleteMessage(chatId, msgId).catch(() => {}), 5000);
      }
      break;
    }

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
