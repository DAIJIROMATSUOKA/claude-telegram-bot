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

// === 追加テストケース ===

describe('buildRetryPrompt - エッジケース', () => {
  test('violations空配列 → 「バリデーション違反」セクションがない', () => {
    const result = buildRetryPrompt('元のプロンプト', '失敗理由', [], 'テスト出力');
    expect(result).not.toContain('バリデーション違反:');
    expect(result).toContain('元のプロンプト');
    expect(result).toContain('失敗理由: 失敗理由');
  });

  test('violations複数 → 全ての違反がプロンプトに含まれる', () => {
    const violations = ['import違反', 'ファイル数超過', 'テスト行数不足', 'banned pattern検出'];
    const result = buildRetryPrompt('プロンプト', '複数違反', violations, '');
    expect(result).toContain('バリデーション違反:');
    expect(result).toContain('- import違反');
    expect(result).toContain('- ファイル数超過');
    expect(result).toContain('- テスト行数不足');
    expect(result).toContain('- banned pattern検出');
  });

  test('testOutput空文字 → エラーにならず、テスト出力セクションなし', () => {
    const result = buildRetryPrompt('プロンプト', '失敗', ['違反'], '');
    expect(result).not.toContain('テスト出力:');
    expect(result).toContain('プロンプト');
    expect(result).toContain('失敗理由: 失敗');
  });

  test('testOutputが1000文字超 → 末尾500文字に切り詰め', () => {
    const longOutput = 'x'.repeat(1000) + 'MARKER_END';
    const result = buildRetryPrompt('プロンプト', '失敗', [], longOutput);
    expect(result).toContain('テスト出力:');
    expect(result).toContain('...');
    // 末尾500文字に切り詰められるので、MARKER_ENDは含まれる
    expect(result).toContain('MARKER_END');
    // 1000文字全体は含まれない
    expect(result).not.toContain('x'.repeat(1000));
  });
});

describe('summarizeFailureReason - エッジケース', () => {
  test('failed + violations空 + exitCode → テスト失敗/実行失敗の記述', () => {
    // violations空でfailedの場合、exit codeベースのメッセージになる
    const result = summarizeFailureReason('failed', [], 1);
    expect(result).toBe('実行失敗 (exit code: 1)');
    expect(result).toContain('実行失敗');
  });

  test('violations複数 → 全て含まれる', () => {
    const violations = ['import違反', 'ファイル数超過', 'テスト行数不足'];
    const result = summarizeFailureReason('failed', violations, 1);
    expect(result).toContain('import違反');
    expect(result).toContain('ファイル数超過');
    expect(result).toContain('テスト行数不足');
    expect(result).toBe('バリデーション失敗: import違反, ファイル数超過, テスト行数不足');
  });

  test('failed + 単一violation → バリデーション失敗メッセージ', () => {
    const result = summarizeFailureReason('failed', ['error detected'], 0);
    expect(result).toBe('バリデーション失敗: error detected');
  });
});

// === retryWithExponentialBackoff シミュレーションテスト ===
// retry.ts には retryWithExponentialBackoff 関数は未実装だが、
// 将来の実装を想定したリトライロジックのテストケース

describe('buildRetryPrompt - リトライシナリオ', () => {
  test('maxRetries=0相当: 失敗関数がリトライなしで即失敗', () => {
    // リトライ回数0 = 最初の失敗でそのまま終了
    // この場合、buildRetryPromptは呼ばれないが、
    // 仮に呼ばれた場合のプロンプト構造をテスト
    const result = buildRetryPrompt(
      '初回のみ実行',
      '初回で失敗',
      ['即時エラー'],
      'Error: function failed immediately'
    );
    expect(result).toContain('初回のみ実行');
    expect(result).toContain('失敗理由: 初回で失敗');
    expect(result).toContain('- 即時エラー');
    expect(result).toContain('Error: function failed immediately');
  });

  test('即成功: リトライ不要のケース', () => {
    // 成功時はリトライプロンプトは生成されないが、
    // 念のため空状態でのプロンプト構造をテスト
    const result = buildRetryPrompt(
      '成功したタスク',
      '',
      [],
      ''
    );
    // 基本構造は維持される
    expect(result).toContain('成功したタスク');
    expect(result).toContain('失敗理由: ');
    expect(result).not.toContain('バリデーション違反:');
    expect(result).not.toContain('テスト出力:');
  });

  test('3回目で成功相当: 2回失敗後のリトライプロンプト', () => {
    // 2回失敗 → 3回目で成功を想定
    // 2回目の失敗時に生成されるリトライプロンプトをテスト
    const attempt2FailureReason = '2回目の失敗: 依存関係エラー';
    const attempt2Violations = ['テスト失敗', '型エラー'];
    const attempt2Output = 'FAIL src/module.test.ts\nTypeError: undefined is not a function';

    const result = buildRetryPrompt(
      '複雑なタスク',
      attempt2FailureReason,
      attempt2Violations,
      attempt2Output
    );

    expect(result).toContain('複雑なタスク');
    expect(result).toContain('失敗理由: 2回目の失敗: 依存関係エラー');
    expect(result).toContain('バリデーション違反:');
    expect(result).toContain('- テスト失敗');
    expect(result).toContain('- 型エラー');
    expect(result).toContain('テスト出力:');
    expect(result).toContain('TypeError: undefined is not a function');
    expect(result).toContain('前回と同じミスを繰り返すな');
  });
});
