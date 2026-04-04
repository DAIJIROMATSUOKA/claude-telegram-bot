/**
 * project-context-injector.ts
 * 
 * Reads cached project context and returns formatted Markdown for injection.
 * Called by bridge before injecting user message into project chat.
 * 
 * Usage:
 *   import { getProjectContext, shouldUpdateContext } from './project-context-injector';
 *   
 *   // Before injecting message into chat:
 *   const ctx = await getProjectContext('1317');
 *   if (ctx) {
 *     await injectMessage(chatUrl, ctx);  // inject context first
 *   }
 *   await injectMessage(chatUrl, userMessage);  // then inject user message
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';




const HOME = process.env.HOME || '/Users/daijiromatsuokam1';
const CACHE_FILE = resolve(HOME, 'claude-telegram-bot/cache/project-contexts.json');
const HASH_STORE_FILE = resolve(HOME, 'claude-telegram-bot/cache/injected-hashes.json');

interface ProjectQuote {
  見積書No: string;
  プロジェクトNo: string;
  マシンNo: string;
  名称: string;
  装置名: string;
  受注: string;
  受注日: string;
  納品日: string;
  希望納期: string;
  検収日: string;
  進捗状況: string;
  注文番号: string;
  プロジェクト名: string;
  販売先: string;
  販売先詳細: string;
  販売先担当: string;
  納品先: string;
  納品先詳細: string;
  納品先担当: string;
  [key: string]: any;
}

interface CacheData {
  projects: ProjectQuote[];
  details: Record<string, any[]>;
  orders: Record<string, any[]>;
  status_map: Record<string, string>;
  machine_index: Record<string, number[]>;
  machine_hashes: Record<string, string>;
  generated_at: string;
}

// In-memory cache to avoid re-reading file on every call
let cachedData: CacheData | null = null;
let cacheReadAt = 0;
const CACHE_TTL = 60_000; // Re-read file every 60s

function loadCache(): CacheData | null {
  if (cachedData && Date.now() - cacheReadAt < CACHE_TTL) {
    return cachedData;
  }
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    cachedData = JSON.parse(raw);
    cacheReadAt = Date.now();
    return cachedData;
  } catch {
    return null;
  }
}

function loadInjectedHashes(): Record<string, string> {
  if (!existsSync(HASH_STORE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HASH_STORE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveInjectedHash(machineKey: string, hash: string): void {
  const hashes = loadInjectedHashes();
  hashes[machineKey] = hash;
  const { writeFileSync, mkdirSync } = require('fs');
  const dir = resolve(HOME, 'claude-telegram-bot/cache');
  mkdirSync(dir, { recursive: true });
  writeFileSync(HASH_STORE_FILE, JSON.stringify(hashes, null, 2));
}

/**
 * Extract machine number from chat name or project name
 * "M1317 カット白菜検査" → "1317"
 * "PM931-35 コンベヤ" → "931"
 */
export function extractMachineNo(text: string): string | null {
  const m = text.match(/[MP]M?(\d{3,4})/i);
  return m ? m[1]! : null;
}

/**
 * Check if context needs updating for this machine
 * Returns true if cache hash differs from last injected hash
 */
export function shouldUpdateContext(machineKey: string): boolean {
  const data = loadCache();
  if (!data) return false;

  const currentHash = data.machine_hashes?.[machineKey];
  if (!currentHash) return false;

  const injectedHashes = loadInjectedHashes();
  return injectedHashes[machineKey] !== currentHash;
}

/**
 * Get formatted project context Markdown for injection
 * Returns null if no data or no update needed
 */
export function getProjectContext(
  machineKey: string,
  options: { forceUpdate?: boolean } = {}
): string | null {
  const data = loadCache();
  if (!data) return null;

  const indices = data.machine_index?.[machineKey];
  if (!indices || indices.length === 0) return null;

  // Check if update needed
  if (!options.forceUpdate && !shouldUpdateContext(machineKey)) {
    return null; // No changes since last injection
  }

  const statusMap = data.status_map || {};
  const lines: string[] = [];
  const generated = data.generated_at || 'unknown';

  // Group quotes by プロジェクトNo
  const quotes = indices.map(i => data.projects[i]).filter(q => {
      if (!q) return false;
      const mno = q['マシンNo'] || '';
      // Skip underscore variants (M1300_1 = half-payment duplicate)
      if (mno.includes('_')) return false;
      // Skip P-numbers when searching for M-numbers (different machines)
      if (mno.startsWith('P') && !mno.startsWith('PM')) return false;
      return true;
    });
  const byProject: Record<string, ProjectQuote[]> = {};
  for (const q of quotes) {
    const pno = q!.プロジェクトNo || 'unknown';
    if (!byProject[pno]) byProject[pno] = [];
    byProject[pno]!.push(q!);
  }

  lines.push(`[案件コンテキスト - Access DB ${generated}取得]\n`);

  for (const [pno, pquotes] of Object.entries(byProject)) {
    const main = pquotes[0]!;
    const mno = main.マシンNo || '';
    const device = main.装置名 || '';
    const pname = main.プロジェクト名 || main.名称 || '';
    const seller = main.販売先 || '';
    const sellerD = main.販売先詳細 || '';
    const sellerT = main.販売先担当 || '';
    const buyer = main.納品先 || '';
    const buyerD = main.納品先詳細 || '';
    const buyerT = main.納品先担当 || '';
    const statusId = main.進捗状況;
    const status = statusId ? (statusMap[statusId] || '') : '';
    const deadline = main.希望納期 || '';

    lines.push(`プロジェクトNo: ${pno} | マシンNo: ${mno}`);
    if (device) lines.push(`装置名: ${device}`);
    if (pname && pname !== device) lines.push(`プロジェクト名: ${pname}`);

    if (seller) {
      let sl = `販売先: ${seller}`;
      if (sellerD) sl += ` → ${sellerD}`;
      if (sellerT) sl += `（${sellerT}）`;
      lines.push(sl);
    }
    if (buyer) {
      let bl = `納品先: ${buyer}`;
      if (buyerD) bl += ` ${buyerD}`;
      if (buyerT) bl += `（${buyerT}）`;
      lines.push(bl);
    }
    if (status) lines.push(`進捗: ${status}`);
    if (deadline) lines.push(`希望納期: ${deadline}`);

    for (const q of pquotes) {
      const qno = q.見積書No;
      if (!qno) continue;
      const detailRows = data.details?.[qno] || [];
      const total = detailRows.reduce((s: number, r: any) => s + parseFloat(r.金額 || '0'), 0);
      const nonExpense = detailRows.filter((r: any) => r.経費 !== 'True');
      const topItems = nonExpense.slice(0, 3).map((r: any) => r.商品名 || '').filter(Boolean);

      const qStatus = q.受注 === 'True' ? '受注済' : (q.却下 === 'True' ? '却下' : '見積中');
      const dateInfo = q.受注日 || q.見積書作成日 || '';

      lines.push(`見積No${qno} ${qStatus} ¥${total.toLocaleString()} 明細${detailRows.length}行 ${dateInfo}`);
      if (topItems.length > 0) lines.push(`  主要: ${topItems.join(', ')}`);

      // Undelivered parts
      const orderRows = data.orders?.[qno] || [];
      const undelivered = orderRows.filter((o: any) => !o.入荷日);
      if (undelivered.length > 0) {
        lines.push(`  未入荷${undelivered.length}件:`);
        for (const o of undelivered.slice(0, 5)) {
          const part = o.品名 || o.型式 || `パーツNo${o.パーツNo}`;
          const maker = o.メーカー ? `(${o.メーカー})` : '';
          const eta = o.入荷予定日 || '未定';
          lines.push(`    ${part}${maker} ×${o.数量 || '?'} 予定:${eta}`);
        }
        if (undelivered.length > 5) {
          lines.push(`    ...他${undelivered.length - 5}件`);
        }
      }
    }
    lines.push('');
  }

  // Mark as injected
  const currentHash = data.machine_hashes?.[machineKey] || '';
  if (currentHash) {
    saveInjectedHash(machineKey, currentHash);
  }

  return lines.join('\n');
}

/**
 * Get context for all machines that need updating
 * Returns map of machineKey -> markdown
 */
export function getAllPendingContextUpdates(): Record<string, string> {
  const data = loadCache();
  if (!data) return {};

  const result: Record<string, string> = {};
  const injectedHashes = loadInjectedHashes();

  for (const [key, hash] of Object.entries(data.machine_hashes || {})) {
    if (injectedHashes[key] !== hash) {
      const ctx = getProjectContext(key, { forceUpdate: true });
      if (ctx) result[key] = ctx;
    }
  }

  return result;
}
