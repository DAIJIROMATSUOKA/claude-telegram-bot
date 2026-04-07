/**
 * Inbox Triage Service
 * Polls Gateway for inbox items → injects into 🦞 Worker → parses judgment → executes action
 * 
 * Flow: Gateway dequeue → Worker inject → DOM read → JSON parse → action → Gateway result
 */

import { createLogger } from "../utils/logger";
const log = createLogger("inbox-triage");

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { gatewayQuery } from './gateway-db';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';
import { withRetry } from '../utils/retry';

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

// ============================================================
// Triage Batch Queue - 3s debounce for OK/Undo actions
// ============================================================
interface TriageBatchEntry {
  action: 'ok' | 'undo';
  itemId: string;
  msgId: number;
  chatId: number;
}
interface TriageBatchQueue {
  entries: TriageBatchEntry[];
  timer: ReturnType<typeof setTimeout>;
}
const triageBatchQueue = new Map<number, TriageBatchQueue>();
const TRIAGE_BATCH_DELAY = 3000;
const AUTO_APPROVE_SECONDS = 1800; // 30min - DJ only taps if WRONG
const autoApproveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function queueTriageBatchAction(chatId: number, entry: TriageBatchEntry): number {
  let q = triageBatchQueue.get(chatId);
  if (q) {
    clearTimeout(q.timer);
    q.entries.push(entry);
  } else {
    q = { entries: [entry], timer: null as any };
    triageBatchQueue.set(chatId, q);
  }
  q.timer = setTimeout(() => executeTriageBatch(chatId), TRIAGE_BATCH_DELAY);
  return q.entries.length;
}

async function executeTriageBatch(chatId: number): Promise<void> {
  const q = triageBatchQueue.get(chatId);
  if (!q || !botApi) return;
  triageBatchQueue.delete(chatId);

  const okEntries = q.entries.filter(e => e.action === 'ok');
  const undoEntries = q.entries.filter(e => e.action === 'undo');

  log.info(`[TriageBatch] Executing: ${okEntries.length} ok, ${undoEntries.length} undo in chat ${chatId}`);

  // Process OK entries - report feedback + unpin + delete messages
  for (const e of okEntries) {
    try {
      await reportFeedback(e.itemId, 'approved', 'manual-ok');
      try { await botApi.unpinChatMessage(e.chatId, e.msgId); } catch {}
      await botApi.deleteMessage(e.chatId, e.msgId).catch((e: unknown) => log.error('[inbox-triage]', e));
    } catch (err) {
      log.error('[TriageBatch] OK action error:', err);
    }
  }

  // Process Undo entries - show reason selection for each
  for (const e of undoEntries) {
    try {
      await botApi.editMessageText(e.chatId, e.msgId, '❓ なぜ取消？', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📨重要', callback_data: `triage:reason:${e.itemId}:important` },
              { text: '⏰後で', callback_data: `triage:reason:${e.itemId}:later` },
              { text: '⚠️誤分類', callback_data: `triage:reason:${e.itemId}:misclass` },
            ],
          ],
        },
      }).catch((e: unknown) => log.error('[inbox-triage]', e));
    } catch (err) {
      log.error('[TriageBatch] Undo action error:', err);
    }
  }
}

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
    log.error('[Triage] Dequeue error:', e);
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
    log.error('[Triage] Report error:', e);
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
    log.error('[Triage] Feedback error:', e);
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
  } catch (e) {
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
    try {
      await runLocal(`cat > ${tmpFile} << 'DTEOF'\n${prompt}\nDTEOF`);
    } catch (e) {
      log.error('[inbox-triage]', e);
      return null;
    }
    const result = await runLocal(
      `MSG=$(cat ${tmpFile}) && bash "${SCRIPTS_DIR}/domain-relay.sh" --domain "${domain}" --wt-file /tmp/domain-triage-wt "$MSG" && rm -f ${tmpFile}`,
      150000
    );
    await runLocal(`rm -f ${tmpFile}`);
    const response = result.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();
    return response || null;
  } catch (e: any) {
    log.error(`[Triage] Domain relay error (${domain}):`, e?.message);
    return null;
  }
}

async function injectTriage(wt: string, item: TriageItem, learningContext: string = ''): Promise<boolean> {
  const prompt = buildTriagePrompt(item, learningContext);
  const tmpFile = `/tmp/triage-inject-${Date.now()}.txt`;
  try {
    await runLocal(`cat > ${tmpFile} << 'TRIAGEEOF'\n${prompt}\nTRIAGEEOF`);
  } catch (e) {
    log.error('[inbox-triage]', e);
    return false;
  }

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
    const res = await fetchWithTimeout(`${GATEWAY_URL}/v1/inbox/corrections?limit=${limit}`);
    const data: any = await res.json();
    return data.ok ? (data.corrections || []) : [];
  } catch (e) {
    log.error('[Triage] Corrections fetch error:', e);
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
  const parts: string[] = [];
  parts.push('YOU ARE IN TRIAGE MODE. Your ONLY job is to return a single JSON line. NO explanation, NO routing tags, NO text.');
  parts.push('');
  parts.push(`Source: ${item.source}`);
  if (item.sender_name) parts.push(`From: ${item.sender_name}`);
  if (item.subject) parts.push(`Subject: ${item.subject}`);
  parts.push(`Body: ${item.body.substring(0, 2000)}`);
  if (learningContext) parts.push(learningContext);
  parts.push('');
  parts.push('Rules: Keyence/Nakanishi/Yagai/ItoHam/Miyakokiko/28Bring/Uchiumi = escalate. Ads/newsletters/receipts/shipping = archive or delete. Unsure = escalate.');
  parts.push('If email has action item for DJ (request/deadline/question), add task_title.');
  parts.push('');
  parts.push('Return ONLY this JSON (nothing else before or after):');
  parts.push('{"action":"archive","confidence":85,"reason":"promotional email","task_title":"optional"}');
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
    } catch (e) { /* fall through to text parsing */ }
  }

  // 2. Text format: "**判断:** archive" or "判断: delete"
  const textMatch = raw.match(/(?:\*\*)?判断(?:\*\*)?\s*[:：]\s*(archive|delete|escalate|reply|ignore)/i);
  if (textMatch) {
    const action = textMatch[1]!.toLowerCase() as TriageJudgment['action'];
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
  if (lower.includes('エスカレーション') || lower.includes('escalat') || lower.includes('確認') || lower.includes('要対応')) {
    return { action: 'escalate', confidence: 50, reason: 'Keyword match: escalate' };
  }

  log.error('[Triage] Parse failed, raw:', raw.substring(0, 300));
  return null;
}

// ============================================================
// Action execution
// ============================================================


// ============================================================
// Source-specific deep link button
// ============================================================

function buildOpenButton(item: TriageItem): { text: string; url: string } | null {
  switch (item.source) {
    case 'gmail':
      if (item.source_id) {
        return { text: '📧開く', url: `https://mail.google.com/mail/u/0/#inbox/${item.source_id}` };
      }
      return { text: '📧Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' };
    case 'line':
      return null; // line:// protocol not supported by Telegram inline buttons
    case 'phone': {
      const phoneMatch = (item.sender_name + ' ' + item.body).match(/(\+?\d[\d-]{8,})/);
      if (phoneMatch) {
        const num = phoneMatch[1]!.replace(/-/g, '');
        return { text: '📞折返し', url: `tel:${num}` };
      }
      return null; // tel: without number is invalid for Telegram
    }
    default:
      return null;
  }
}

async function executeAction(item: TriageItem, judgment: TriageJudgment): Promise<void> {
  const chatId = item.telegram_chat_id || djChatId;
  log.info(`[Triage] executeAction: action=${judgment.action}, chatId=${chatId}, botApi=${!!botApi}, djChatId=${djChatId}`);
  if (!botApi || !chatId) {
    log.error('[Triage] ABORT: botApi or chatId missing');
    return;
  }


  // Always delete GAS notification first (triage replaces it)
  if (item.telegram_msg_id) {
    try { await botApi.deleteMessage(chatId, item.telegram_msg_id); } catch (e) { /* expired */ }
  }

  switch (judgment.action) {
    case 'archive':
    case 'delete': {
      if (item.source === 'gmail' && item.source_id && GAS_GMAIL_URL) {
        const action = judgment.action === 'delete' ? 'trash' : 'archive';
        const url = `${GAS_GMAIL_URL}?action=${action}&gmail_id=${item.source_id}&key=${GAS_GMAIL_KEY}`;
        try {
          const res = await withRetry(() => fetchWithTimeout(url, { redirect: 'follow' }));
          if (!res.ok) {
            log.error(`[Triage] Gmail ${action} HTTP ${res.status} ${res.statusText}`);
          } else {
            const text = await res.text();
            try {
              const result: any = JSON.parse(text);
              if (!result.ok) {
                log.error(`[Triage] Gmail ${action} failed:`, result);
              }
            } catch (_parseErr) {
              log.error(`[Triage] Gmail ${action} JSON parse error, body: ${text.substring(0, 100)}`);
            }
          }
        } catch (e) {
          log.error(`[Triage] Gmail ${action} error:`, e);
        }
      }
      // Confirm to DJ
      const icon = judgment.action === 'archive' ? '📦' : '🗑';
      const bodyExcerpt = item.body.substring(0, 150).replace(/\n/g, " ").trim();
      const confirmText = `🦞 ${icon}${judgment.action === 'archive' ? 'アーカイブ' : '削除'}済み\n📧 ${item.sender_name}: ${item.subject || '(件名なし)'}\n📝 ${bodyExcerpt}\n\n💭 ${judgment.reason}`;
      log.info('[Triage] Sending confirm to chatId:', chatId, 'text:', confirmText.substring(0, 80));
      let confirmMsg: any;
      try {
      const openBtn = buildOpenButton(item);
      const archiveRows: any[][] = [
        [
          { text: '✅OK', callback_data: `triage:ok:${item.id}` },
          { text: '❌取消', callback_data: `triage:undo:${item.id}` },
        ],
      ];
      if (openBtn) archiveRows.push([openBtn]);
      confirmMsg = await botApi.sendMessage(chatId, confirmText, {
        reply_markup: { inline_keyboard: archiveRows },
      });
      } catch (sendErr: any) {
        log.error('[Triage] sendMessage FAILED:', sendErr?.message || sendErr);
      }
      log.info('[Triage] Confirm sent, msgId:', confirmMsg?.message_id);
      // Auto-approve after 30s if DJ doesn't interact
      if (confirmMsg?.message_id) {
        const _iid = item.id, _mid = confirmMsg.message_id, _cid = chatId;
        const tid = setTimeout(async () => {
          autoApproveTimers.delete(_iid);
          try {
            await reportFeedback(_iid, 'approved', 'auto-30min');
            await botApi!.deleteMessage(_cid, _mid).catch((e: unknown) => log.error('[inbox-triage]', e));
          } catch (e) { log.error('[Triage] Auto-approve error:', e); }
        }, AUTO_APPROVE_SECONDS * 1000);
        autoApproveTimers.set(_iid, tid);
      }
      break;
    }

    case 'reply': {
      const draftText = `🦞 ✏️返信下書き\n宛先: ${item.sender_name} (${item.source})\n---\n${judgment.draft || '(下書きなし)'}\n---\n理由: ${judgment.reason}`;
      const replyOpenBtn = buildOpenButton(item);
      const replyRows: any[][] = [
        [
          { text: '📤送信', callback_data: `triage:send:${item.id}` },
          { text: '❌却下', callback_data: `triage:reject:${item.id}` },
        ],
      ];
      if (replyOpenBtn) replyRows.push([replyOpenBtn]);
      try {
        await botApi.sendMessage(chatId, draftText, {
          reply_markup: { inline_keyboard: replyRows },
        });
      } catch (e) { log.error('[inbox-triage]', e); }
      break;
    }

    case 'obsidian': {
      // Write to Obsidian via existing obsidian-writer
      // For now, just notify DJ
      const obsText = `🦞 📒Obsidian記録候補\n${item.sender_name}: ${item.subject || ''}\n内容: ${judgment.obsidian_summary || judgment.reason}`;
      try {
        await botApi.sendMessage(chatId, obsText, {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅OK', callback_data: `triage:approve:${item.id}` },
              { text: '❌却下', callback_data: `triage:reject:${item.id}` },
            ]],
          },
        });
      } catch (e) { log.error('[inbox-triage]', e); }
      break;
    }

    case 'bug_fix': {
      // 🦞 handles this directly via exec bridge - just notify
      try {
        await botApi.sendMessage(chatId,
          `🦞 🔧バグ検出・自動修復中\n${judgment.reason}`
        );
      } catch (e) { log.error('[inbox-triage]', e); }
      break;
    }

    case 'ignore': {
      // Do nothing - leave notification as is
      break;
    }

    case 'escalate':
    default: {
      const escOpenBtn = buildOpenButton(item);
      const taskInfo = judgment.task_title ? `\n📋 ${judgment.task_title}` : '';
      const escOpts: any = {};
      if (escOpenBtn) {
        escOpts.reply_markup = { inline_keyboard: [[escOpenBtn]] };
      }
      const escRows: any[][] = [
        [
          { text: '✅OK', callback_data: `triage:ok:${item.id}` },
          { text: '❌取消', callback_data: `triage:undo:${item.id}` },
        ],
      ];
      // Gmail action buttons
      if (item.source === 'gmail' && item.source_id) {
        escRows.push([{ text: '📦', callback_data: `ib:archive:${item.source_id}` }, { text: '🗑', callback_data: `ib:trash:${item.source_id}` }]);
      }
      if (escOpenBtn) escRows.push([escOpenBtn]);
      escOpts.reply_markup = { inline_keyboard: escRows };
      let escMsg: any;
      try {
        escMsg = await botApi.sendMessage(chatId,
          `🦞 ⚠️DJ確認\n📧 ${item.sender_name}: ${item.subject || '(件名なし)'}\n📝 ${item.body.substring(0, 300).replace(/\n/g, ' ')}\n\n💭 ${judgment.reason}${taskInfo}`,
          escOpts
        );
      } catch (e) { log.error('[inbox-triage]', e); }
      // Pin the escalation message so DJ sees it immediately
      try {
        if (escMsg?.message_id) {
          await botApi.pinChatMessage(chatId, escMsg.message_id, { disable_notification: true });
        }
      } catch {
        // Pin may fail in non-supergroup chats — ignore
      }
      break;
    }
  }
}

// ============================================================
// Contact auto-log
// ============================================================

async function autoLogContact(item: TriageItem, summary: string): Promise<void> {
  try {
    await gatewayQuery(
      `CREATE TABLE IF NOT EXISTS contact_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        direction TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      )`
    );
    await gatewayQuery(
      `INSERT INTO contact_log (source, contact_name, direction, summary, created_at) VALUES (?, ?, ?, ?, ?)`,
      [item.source, item.sender_name || 'unknown', 'inbound', summary.substring(0, 500), new Date().toISOString()]
    );
  } catch (e) {
    log.error('[Triage] autoLogContact error:', e);
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

    log.info(`[Triage] Processing ${items.length} items`);

    // Fetch learning context once per cycle
    const corrections = await fetchCorrections(20);
    const learningContext = buildLearningContext(corrections);
    if (corrections.length > 0) {
      const rejected = corrections.filter(c => c.feedback === 'rejected').length;
      log.info(`[Triage] Learning: ${corrections.length} items (${rejected} rejected)`);
    }

    for (const item of items) {
      if (existsSync(STOP_FLAG)) break;

      // Always route triage to INBOX domain (has JSON judgment bootstrap)
      let response: string | null = null;
      log.info(`[Triage] Routing ${item.id} to inbox domain`);
      response = await domainTriageInject('inbox', item, learningContext);

      // Fallback: try specific domain if inbox fails
      if (!response) {
        const domain = await matchDomain(item);
        if (domain && domain !== 'inbox') {
          log.info(`[Triage] Fallback to domain: ${domain}`);
          response = await domainTriageInject(domain, item, learningContext);
        }
      }
      if (!response) {
        log.error(`[Triage] No response for ${item.id}`);
        await reportResult(item.id, 'escalate', 0, 'No response from 🦞', false);
        continue;
      }

      // Parse judgment
      const judgment = parseTriageResponse(response);
      if (!judgment) {
        log.error(`[Triage] Parse failed for ${item.id}:`, response.substring(0, 200));
        await reportResult(item.id, 'escalate', 0, 'Failed to parse 🦞 response', false);
        continue;
      }

      log.info(`[Triage] ${item.id}: ${judgment.action} (${judgment.confidence})`);

      // Execute action
      const autoExecute = judgment.action === 'ignore' || judgment.action === 'bug_fix';
      await executeAction(item, judgment);

      // Auto-log contact to D1
      if (item.source === 'gmail' || item.source === 'line') {
        const logSummary = `${item.subject ? item.subject + ' — ' : ''}${judgment.reason}`;
        autoLogContact(item, logSummary).catch((e: unknown) => log.error('[inbox-triage]', e));
      }

      await reportResult(
        item.id,
        judgment.action,
        judgment.confidence,
        judgment.reason,
        autoExecute
      );
    }
  } catch (e) {
    log.error('[Triage] Cycle error:', e);
  } finally {
    isProcessing = false;
  }
}

// ============================================================
// Public API
// ============================================================

export function startInboxTriage(bot: any, chatId: number): void {
  if (triageTimer) {
    log.info('[Triage] Already running');
    return;
  }

  botApi = bot.api;
  djChatId = chatId;

  log.info(`[Triage] Started (interval: ${POLL_INTERVAL / 1000}s, buffer: ${BUFFER_SECONDS}s)`);
  triageTimer = setInterval(triageCycle, POLL_INTERVAL);

  // Run first cycle after 10s (let bot fully start)
  setTimeout(triageCycle, 10_000);
}

export function stopInboxTriage(): void {
  if (triageTimer) {
    clearInterval(triageTimer);
    triageTimer = null;
    log.info('[Triage] Stopped');
  }
}

/**
 * Handle triage callback buttons (from inline keyboards)
 * callback_data format: triage:{action}:{item_id}
 * @param callbackQuery - The callback query from Telegram
 * @param answerCallback - Function to answer the callback query (from ctx.answerCallbackQuery)
 */
export async function handleTriageCallback(
  callbackQuery: any,
  answerCallback?: (opts: { text: string; show_alert?: boolean }) => Promise<any>
): Promise<boolean> {
  const data = callbackQuery.data;
  if (!data || !data.startsWith('triage:')) return false;

  const parts = data.split(':');
  if (parts.length < 3) return false;

  const [, action, itemId] = parts;
  const chatId = callbackQuery.message?.chat?.id;
  const msgId = callbackQuery.message?.message_id;

  switch (action) {
    case 'approve':
      await reportFeedback(itemId, 'approved', 'manual-approve');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '✅ 承認済み').catch((e: unknown) => log.error('[inbox-triage]', e));
        setTimeout(() => botApi.deleteMessage(chatId, msgId).catch((e: unknown) => log.error('[inbox-triage]', e)), 5000);
      }
      break;

    case 'reject':
      await reportFeedback(itemId, 'rejected', 'manual-reject');
      if (botApi && chatId && msgId) {
        await botApi.editMessageText(chatId, msgId, '❌ 却下').catch((e: unknown) => log.error('[inbox-triage]', e));
      }
      break;

    case 'ok': {
      { const t = autoApproveTimers.get(itemId); if (t) { clearTimeout(t); autoApproveTimers.delete(itemId); } }
      if (chatId && msgId) {
        const count = queueTriageBatchAction(chatId, { action: 'ok', itemId, msgId, chatId });
        if (answerCallback) {
          try { await answerCallback({ text: `✅ OK予約 (${count}件)`, show_alert: false }); } catch {}
        }
        return true;
      }
      break;
    }

    case 'undo': {
      { const t = autoApproveTimers.get(itemId); if (t) { clearTimeout(t); autoApproveTimers.delete(itemId); } }
      if (chatId && msgId) {
        const count = queueTriageBatchAction(chatId, { action: 'undo', itemId, msgId, chatId });
        if (answerCallback) {
          try { await answerCallback({ text: `⏪ 取消予約 (${count}件)`, show_alert: false }); } catch {}
        }
        return true;
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
            await fetch(unarchiveUrl, { redirect: 'follow' }).catch((e: unknown) => log.error('[inbox-triage]', e));
          }
        } catch (e) {
          log.error('[Triage] Un-archive error:', e);
        }
      }

      await reportFeedback(reasonItemId, 'rejected', reasonText);
      if (botApi && chatId && msgId) {
        try { await botApi.unpinChatMessage(chatId, msgId); } catch {}
        await botApi.editMessageText(chatId, msgId, `⏪ \u53d6\u6d88\u6e08\u307f (${reasonText})`).catch((e: unknown) => log.error('[inbox-triage]', e));
        setTimeout(() => botApi.deleteMessage(chatId, msgId).catch((e: unknown) => log.error('[inbox-triage]', e)), 5000);
      }
      break;
    }

    case 'send': {
      // Look up the triage item to get source + reply body
      let sendOk = false;
      try {
        const lookupRes = await fetch(`${GATEWAY_URL}/v1/db/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: `SELECT source, source_id, reply_body, subject FROM inbox_triage_queue WHERE id = ?`,
            params: [itemId],
          }),
        });
        const lookupData: any = await lookupRes.json();
        const row = lookupData?.results?.[0];

        if (row?.reply_body) {
          if (row.source === 'gmail' && GAS_GMAIL_URL) {
            // Send via GAS endpoint: action=reply, threadId=source_id, body=reply_body
            const gasUrl = `${GAS_GMAIL_URL}?action=reply&gmail_id=${encodeURIComponent(row.source_id)}&body=${encodeURIComponent(row.reply_body)}&key=${GAS_GMAIL_KEY}`;
            const gasRes = await fetchWithTimeout(gasUrl, { redirect: 'follow' });
            const gasData: any = await gasRes.json();
            sendOk = !!gasData?.ok;
          } else if (row.source === 'line') {
            // Send via LINE Worker URL (same infrastructure as line-post.ts)
            const lineWorkerUrl = process.env.LINE_WORKER_URL || '';
            if (lineWorkerUrl) {
              const lineRes = await fetchWithTimeout(lineWorkerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: row.source_id,
                  messages: [{ type: 'text', text: row.reply_body }],
                }),
              });
              const lineData: any = await lineRes.json();
              sendOk = lineData?.ok || lineData?.status === 200;
            }
          }
        }
      } catch (e) {
        log.error('[Triage] Send reply error:', e);
      }

      await reportFeedback(itemId, sendOk ? 'approved' : 'failed', 'manual-send');
      if (botApi && chatId && msgId) {
        const statusText = sendOk ? '📤 送信済み' : '❌ 送信失敗';
        await botApi.editMessageText(chatId, msgId, statusText).catch((e: unknown) => log.error('[inbox-triage]', e));
      }
      break;
    }

    default:
      return false;
  }

  return true;
}
