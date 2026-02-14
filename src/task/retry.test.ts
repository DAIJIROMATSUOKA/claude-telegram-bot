import { describe, test, expect } from 'bun:test';
import { buildRetryPrompt, summarizeFailureReason } from './retry';

describe('buildRetryPrompt', () => {
  test('元のプロンプトが含まれる', () => {
    const result = buildRetryPrompt('元のプロンプト', '失敗', [], '');
    expect(result).toContain('元のプロンプト');
  });

  test('失敗理由が含まれる', () => {
    const result = buildRetryPrompt('プロンプト', 'テスト失敗', [], '');
    expect(result).toContain('失敗理由: テスト失敗');
  });

  test('violations一覧が含まれる', () => {
    const violations = ['ファイル数超過', 'import違反'];
    const result = buildRetryPrompt('プロンプト', '失敗', violations, '');
    expect(result).toContain('バリデーション違反:');
    expect(result).toContain('- ファイル数超過');
    expect(result).toContain('- import違反');
  });

  test('violations空配列 → バリデーション違反セクションなし', () => {
    const result = buildRetryPrompt('プロンプト', '失敗', [], '');
    expect(result).not.toContain('バリデーション違反:');
  });

  test('testOutputが500文字超 → 末尾500文字に切り詰め', () => {
    const longOutput = 'a'.repeat(600);
    const result = buildRetryPrompt('プロンプト', '失敗', [], longOutput);
    expect(result).toContain('...' + 'a'.repeat(500));
    expect(result).not.toContain('a'.repeat(600));
  });

  test('testOutput空文字 → テスト出力セクションなし', () => {
    const result = buildRetryPrompt('プロンプト', '失敗', [], '');
    expect(result).not.toContain('テスト出力:');
  });

  test('「前回と同じミスを繰り返すな」が含まれる', () => {
    const result = buildRetryPrompt('プロンプト', '失敗', [], '');
    expect(result).toContain('前回と同じミスを繰り返すな。問題を正確に理解してから修正しろ。');
  });
});

describe('summarizeFailureReason', () => {
  test('timeout → タイムアウトメッセージ', () => {
    const result = summarizeFailureReason('timeout', [], 1);
    expect(result).toBe('タイムアウト: 実行時間が上限を超えた');
  });

  test('violations有り → バリデーション失敗メッセージ', () => {
    const result = summarizeFailureReason('failed', ['import違反', 'ファイル数超過'], 1);
    expect(result).toBe('バリデーション失敗: import違反, ファイル数超過');
  });

  test('violations空+exitCode → 実行失敗メッセージ', () => {
    const result = summarizeFailureReason('failed', [], 127);
    expect(result).toBe('実行失敗 (exit code: 127)');
  });
});
