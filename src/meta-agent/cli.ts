// Meta-Agent Claude CLI Wrapper
// callClaudeCLI (ai-router) はBot文脈を注入するため、Meta-Agentには不向き
// このラッパーはシンプルにClaude CLIを呼ぶだけ

import { spawnSync } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dir, '..', '..');

/**
 * Meta-Agent専用のClaude CLI呼び出し
 * Bot文脈（AGENTS.md, jarvis_context等）を注入しない軽量版
 */
export async function callMetaCLI(prompt: string, timeoutMs: number = 60000): Promise<string> {
  const result = spawnSync('claude', ['-p', prompt], {
    timeout: timeoutMs,
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Claude CLI エラー: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').substring(0, 300);
    throw new Error(`Claude CLI 終了コード ${result.status}: ${stderr}`);
  }

  return (result.stdout || '').trim();
}

/**
 * Claude CLI応答からJSONを抽出
 */
export function parseJSONResponse<T>(response: string): T | null {
  try {
    return JSON.parse(response);
  } catch {
    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch {}
    }
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { return JSON.parse(objectMatch[0]); } catch {}
    }
    return null;
  }
}
