/**
 * Phase Detector - Jarvisの応答からPhase完了を検出
 */

import type { Context } from 'grammy';

/**
 * Phase完了パターン
 */
const PHASE_COMPLETION_PATTERNS = [
  /Phase\s+(\d+)\s*(完了|complete|done)/i,
  /✅\s*Phase\s+(\d+)/i,
  /フェーズ\s*(\d+)\s*(完了|終了)/i,
  /\[Phase\s+(\d+)\]\s*(完了|✅)/i,
];

/**
 * 応答からPhase完了を検出
 */
export function detectPhaseCompletion(response: string): {
  isPhaseComplete: boolean;
  phaseName: string | null;
  phaseNumber: number | null;
} {
  for (const pattern of PHASE_COMPLETION_PATTERNS) {
    const match = response.match(pattern);
    if (match) {
      const phaseNumber = parseInt(match[1] || '0', 10);
      return {
        isPhaseComplete: true,
        phaseName: `Phase ${phaseNumber}`,
        phaseNumber,
      };
    }
  }

  return {
    isPhaseComplete: false,
    phaseName: null,
    phaseNumber: null,
  };
}

/**
 * 応答から実装サマリーを抽出
 */
export function extractImplementationSummary(response: string): string {
  // 最初の200文字を取得（長すぎる場合は省略）
  const lines = response.split('\n').filter(line => line.trim());
  const summary = lines.slice(0, 5).join('\n');

  if (summary.length > 500) {
    return summary.slice(0, 500) + '...';
  }

  return summary || '実装完了';
}

/**
 * 応答からエラーを検出
 */
export function detectErrors(response: string): string | null {
  const errorPatterns = [
    /❌.*?(error|エラー|失敗)/i,
    /Error:/i,
    /Failed:/i,
    /🚫/,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(response)) {
      // エラー行を抽出
      const lines = response.split('\n');
      const errorLines = lines.filter(line => pattern.test(line));
      return errorLines.slice(0, 3).join('\n') || 'エラーが検出されました';
    }
  }

  return null;
}

/**
 * 応答からテスト結果を推定
 */
export function detectTestResults(response: string): 'pass' | 'fail' {
  const failPatterns = [
    /test.*?failed/i,
    /テスト.*?(失敗|エラー)/i,
    /❌.*?test/i,
  ];

  for (const pattern of failPatterns) {
    if (pattern.test(response)) {
      return 'fail';
    }
  }

  // デフォルトはpass（エラーがなければ通過と見なす）
  return 'pass';
}

/**
 * 応答から前提条件を推定
 */
export function detectPrerequisites(response: string): {
  is_experiment: boolean;
  production_impact: boolean;
  is_urgent: boolean;
} {
  const prerequisites = {
    is_experiment: false,
    production_impact: false,
    is_urgent: false,
  };

  // 実験的フラグ
  if (/実験|experiment|test|試験/i.test(response)) {
    prerequisites.is_experiment = true;
  }

  // 本番影響フラグ
  if (/本番|production|prod|deploy/i.test(response)) {
    prerequisites.production_impact = true;
  }

  // 緊急性フラグ
  if (/緊急|urgent|critical|hotfix/i.test(response)) {
    prerequisites.is_urgent = true;
  }

  return prerequisites;
}

/**
 * Phase完了時のcroppy自動承認チェック
 *
 * @param ctx Telegram Context
 * @param response Jarvisの応答全文
 * @returns true = 続行OK, false = 停止（DJ承認待ち）
 */
export async function checkPhaseCompletionApproval(
  ctx: Context,
  response: string
): Promise<boolean> {
  // 1. Phase完了を検出
  const detection = detectPhaseCompletion(response);

  if (!detection.isPhaseComplete) {
    // Phase完了でない場合は自動承認不要
    return true;
  }

  console.log('[Phase Detector] Phase完了検出:', detection.phaseName);

  // Phase完了 → 常にSTOP（DJ承認待ち）
  console.log('[Phase Detector] Phase完了 → DJ承認待ち');
  return false;
}
