/**
 * Health Check - 夜間運転前のClaude CLI生存確認
 * Phase 2a: claude --version + ダミープロンプトで確認
 */

import { execSync } from 'node:child_process';

export interface HealthCheckResult {
  passed: boolean;
  claudeVersion: string;
  dummyResponseOk: boolean;
  errors: string[];
}

/**
 * Claude CLIのバージョンを取得
 */
export function getClaudeVersion(): { version: string; error?: string } {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      },
    }).trim();
    return { version: output };
  } catch (error: any) {
    return { version: '', error: error.message || 'claude --version failed' };
  }
}

/**
 * ダミープロンプトでClaude CLIの応答を確認
 * Sonnet使用（コスト最小化）
 */
export function checkDummyPrompt(): { ok: boolean; error?: string } {
  try {
    const output = execSync(
      'echo "Reply with OK" | claude --print --model claude-sonnet-4-20250514',
      {
        encoding: 'utf-8',
        timeout: 30_000,
        cwd: process.env.HOME || '/Users/daijiromatsuokam1',
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
        },
      }
    ).trim();
    return { ok: output.length > 0 };
  } catch (error: any) {
    return { ok: false, error: error.message || 'dummy prompt failed' };
  }
}

/**
 * 全ヘルスチェック実行
 */
export function runHealthCheck(): HealthCheckResult {
  const errors: string[] = [];

  // 1. Claude version check
  const versionResult = getClaudeVersion();
  if (versionResult.error) {
    errors.push(`claude --version: ${versionResult.error}`);
  }

  // 2. Dummy prompt check
  const dummyResult = checkDummyPrompt();
  if (!dummyResult.ok) {
    errors.push(`dummy prompt: ${dummyResult.error || 'no response'}`);
  }

  return {
    passed: errors.length === 0,
    claudeVersion: versionResult.version,
    dummyResponseOk: dummyResult.ok,
    errors,
  };
}
