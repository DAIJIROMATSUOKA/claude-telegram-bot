/**
 * Tool Pre-Loading - コンテキストに応じたツール事前準備
 * Phase: Proactive Context Switcher
 * メッセージ内のファイル参照を検出し、関連コンテキストを事前読み込み
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = '/Users/daijiromatsuokam1/claude-telegram-bot';
const MAX_FILE_SIZE = 10000;
const MAX_TOTAL = 30000;

export interface PreloadedContext {
  type: 'file' | 'git' | 'error_log';
  source: string;
  content: string;
}

/** メッセージからファイル参照を検出 */
function detectFileRefs(message: string): string[] {
  const files = new Set<string>();
  const m1 = message.match(/(?:src|scripts|tests|migrations)\/[\w\-\.\/]+\.(?:ts|js|json|sh|sql|md)/g);
  if (m1) m1.forEach(f => files.add(f));
  return Array.from(files);
}

/** ファイルパスを解決 */
function resolveFile(ref: string): string | null {
  const p = join(PROJECT_ROOT, ref);
  if (existsSync(p)) return p;
  try {
    const found = execSync(`find ${PROJECT_ROOT}/src -name "${ref.split('/').pop()}" -type f 2>/dev/null | head -1`, {
      encoding: 'utf-8', timeout: 3000,
    }).trim();
    return found || null;
  } catch { return null; }
}

/** ファイル内容読み込み（サイズ制限） */
function readPreview(path: string): string | null {
  try {
    const c = readFileSync(path, 'utf-8');
    if (c.length > MAX_FILE_SIZE) {
      const lines = c.split('\n');
      return lines.slice(0, 50).join('\n') + `\n...(${lines.length}行中50行)`;
    }
    return c;
  } catch { return null; }
}

/** Git状態取得 */
function getGitContext(): string | null {
  try {
    const branch = execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000 }).trim();
    const status = execSync('git status --short', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000 }).trim();
    const log = execSync('git log --oneline -5', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000 }).trim();
    return `Branch: ${branch}\nStatus:\n${status || '(clean)'}\n\nRecent:\n${log}`;
  } catch { return null; }
}

/** 最近のエラーログ取得 */
function getRecentErrors(): string | null {
  try {
    const logPath = join(PROJECT_ROOT, 'logs', 'bot.log');
    if (!existsSync(logPath)) return null;
    return execSync(`grep -i "error\\|fail" "${logPath}" | tail -10`, { encoding: 'utf-8', timeout: 3000 }).trim() || null;
  } catch { return null; }
}

/** メッセージを分析し関連コンテキストを事前読み込み */
export function preloadToolContext(message: string): PreloadedContext[] {
  const contexts: PreloadedContext[] = [];
  let total = 0;

  // 1. ファイル参照
  for (const ref of detectFileRefs(message)) {
    if (total >= MAX_TOTAL) break;
    const path = resolveFile(ref);
    if (path) {
      const content = readPreview(path);
      if (content) { total += content.length; contexts.push({ type: 'file', source: ref, content }); }
    }
  }

  // 2. Git関連
  const lower = message.toLowerCase();
  if (/\b(git|commit|branch|merge|push|pull|diff|stash)\b/.test(lower)) {
    const g = getGitContext();
    if (g && total + g.length < MAX_TOTAL) { total += g.length; contexts.push({ type: 'git', source: 'git', content: g }); }
  }

  // 3. エラー関連
  if (/\b(error|エラー|bug|バグ|crash|fail|失敗)\b/.test(lower)) {
    const e = getRecentErrors();
    if (e && total + e.length < MAX_TOTAL) { total += e.length; contexts.push({ type: 'error_log', source: 'bot.log', content: e }); }
  }

  return contexts;
}

/** プリロードコンテキストをプロンプト用テキストに変換 */
export function formatPreloadedContext(contexts: PreloadedContext[]): string {
  if (contexts.length === 0) return '';
  const icons = { file: '📄', git: '🔀', error_log: '⚠️' };
  let out = '\n[PRE-LOADED CONTEXT]\n';
  for (const c of contexts) {
    out += `${icons[c.type]} ${c.source}:\n\`\`\`\n${c.content}\n\`\`\`\n\n`;
  }
  return out + '[END PRE-LOADED CONTEXT]\n';
}
