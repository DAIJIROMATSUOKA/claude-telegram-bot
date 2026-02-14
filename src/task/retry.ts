/**
 * Retry Logic - 失敗理由を元にリトライプロンプトを生成
 * Phase 2a: 1回のみリトライ
 */

export function buildRetryPrompt(
  originalPrompt: string,
  failureReason: string,
  violations: string[],
  testOutput: string
): string {
  const sections: string[] = [];
  sections.push(originalPrompt);
  sections.push('');
  sections.push('--- 前回の実行で失敗した。以下を読んで修正しろ ---');
  sections.push('');
  sections.push(`失敗理由: ${failureReason}`);

  if (violations.length > 0) {
    sections.push('');
    sections.push('バリデーション違反:');
    for (const v of violations) {
      sections.push(`- ${v}`);
    }
  }

  if (testOutput) {
    // テスト出力の最後500文字のみ（プロンプト肥大化防止）
    const trimmedOutput = testOutput.length > 500
      ? '...' + testOutput.slice(-500)
      : testOutput;
    sections.push('');
    sections.push('テスト出力:');
    sections.push(trimmedOutput);
  }

  sections.push('');
  sections.push('前回と同じミスを繰り返すな。問題を正確に理解してから修正しろ。');

  return sections.join('\n');
}

/**
 * 失敗理由を人間が読める形に要約
 */
export function summarizeFailureReason(
  status: 'failed' | 'timeout',
  violations: string[],
  exitCode: number
): string {
  if (status === 'timeout') {
    return 'タイムアウト: 実行時間が上限を超えた';
  }
  if (violations.length > 0) {
    return `バリデーション失敗: ${violations.join(', ')}`;
  }
  return `実行失敗 (exit code: ${exitCode})`;
}
