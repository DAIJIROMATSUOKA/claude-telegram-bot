/**
 * Unit tests for phase-detector utility
 */

import { describe, test, expect } from 'bun:test';
import {
  detectPhaseCompletion,
  extractImplementationSummary,
  detectErrors,
  detectTestResults,
  detectPrerequisites,
} from '../utils/phase-detector';

describe('detectPhaseCompletion', () => {
  describe('detects phase completion markers', () => {
    test('detects "Phase 1 完了" pattern', () => {
      const response = 'Phase 1 完了しました。次のステップに進みます。';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 1');
      expect(result.phaseNumber).toBe(1);
    });

    test('detects "Phase 2 complete" pattern (English)', () => {
      const response = 'Phase 2 complete. Moving to the next phase.';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 2');
      expect(result.phaseNumber).toBe(2);
    });

    test('detects "Phase 3 done" pattern', () => {
      const response = 'Implementation Phase 3 done successfully.';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 3');
      expect(result.phaseNumber).toBe(3);
    });

    test('detects "✅ Phase 1" pattern with emoji', () => {
      const response = '✅ Phase 1 - 基本設計が完了';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 1');
      expect(result.phaseNumber).toBe(1);
    });

    test('detects "フェーズ 2 完了" Japanese pattern', () => {
      const response = 'フェーズ 2 完了。テストも通過しました。';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 2');
      expect(result.phaseNumber).toBe(2);
    });

    test('detects "フェーズ3終了" pattern (no space)', () => {
      const response = 'フェーズ3終了';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 3');
      expect(result.phaseNumber).toBe(3);
    });

    test('detects "[Phase 4] 完了" bracket pattern', () => {
      const response = '[Phase 4] 完了 - 全てのテストがパス';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 4');
      expect(result.phaseNumber).toBe(4);
    });

    test('detects "[Phase 5] ✅" bracket with emoji', () => {
      const response = '[Phase 5] ✅ 実装完了';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 5');
      expect(result.phaseNumber).toBe(5);
    });

    test('detects phase with double-digit number', () => {
      const response = 'Phase 10 完了';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(true);
      expect(result.phaseName).toBe('Phase 10');
      expect(result.phaseNumber).toBe(10);
    });
  });

  describe('returns no match when no phase completion', () => {
    test('returns false for empty string', () => {
      const result = detectPhaseCompletion('');

      expect(result.isPhaseComplete).toBe(false);
      expect(result.phaseName).toBeNull();
      expect(result.phaseNumber).toBeNull();
    });

    test('returns false for text without phase markers', () => {
      const response = '作業中です。もう少しお待ちください。';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(false);
      expect(result.phaseName).toBeNull();
      expect(result.phaseNumber).toBeNull();
    });

    test('returns false for partial match "Phase 1" without completion word', () => {
      const response = 'Phase 1 を開始します。';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(false);
      expect(result.phaseName).toBeNull();
      expect(result.phaseNumber).toBeNull();
    });

    test('returns false for "完了" without phase number', () => {
      const response = 'タスク完了しました。';
      const result = detectPhaseCompletion(response);

      expect(result.isPhaseComplete).toBe(false);
      expect(result.phaseName).toBeNull();
      expect(result.phaseNumber).toBeNull();
    });
  });
});

describe('extractImplementationSummary', () => {
  test('extracts first 5 non-empty lines', () => {
    const response = `Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7`;
    const result = extractImplementationSummary(response);

    expect(result).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
  });

  test('filters out empty lines', () => {
    const response = `Line 1

Line 2

Line 3`;
    const result = extractImplementationSummary(response);

    expect(result).toBe('Line 1\nLine 2\nLine 3');
  });

  test('returns "実装完了" for empty string', () => {
    const result = extractImplementationSummary('');

    expect(result).toBe('実装完了');
  });

  test('returns "実装完了" for whitespace-only string', () => {
    const result = extractImplementationSummary('   \n\n   \n');

    expect(result).toBe('実装完了');
  });

  test('truncates summary longer than 500 characters', () => {
    const longLine = 'A'.repeat(200);
    const response = `${longLine}\n${longLine}\n${longLine}`;
    const result = extractImplementationSummary(response);

    expect(result.length).toBe(503); // 500 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  test('does not truncate summary under 500 characters', () => {
    const response = 'Short summary line 1\nShort summary line 2';
    const result = extractImplementationSummary(response);

    expect(result).toBe('Short summary line 1\nShort summary line 2');
    expect(result.endsWith('...')).toBe(false);
  });

  test('extracts realistic Japanese AI response', () => {
    const response = `## 実装サマリー

- ファイル作成: src/utils/helper.ts
- 関数追加: calculateTotal()
- テスト追加: helper.test.ts

詳細は以下の通りです。`;
    const result = extractImplementationSummary(response);

    expect(result).toContain('実装サマリー');
    expect(result).toContain('ファイル作成');
  });
});

describe('detectErrors', () => {
  test('detects "❌ error" pattern', () => {
    const response = '❌ error occurred during build';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('error');
  });

  test('detects "❌ エラー" Japanese pattern', () => {
    const response = '❌ エラーが発生しました';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('エラー');
  });

  test('detects "❌ 失敗" pattern', () => {
    const response = '❌ ビルド失敗';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('失敗');
  });

  test('detects "Error:" pattern', () => {
    const response = 'Error: Cannot find module';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('Error:');
  });

  test('detects "Failed:" pattern', () => {
    const response = 'Failed: TypeScript compilation';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('Failed:');
  });

  test('detects "🚫" emoji', () => {
    const response = '🚫 アクセス拒否';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    expect(result).toContain('🚫');
  });

  test('extracts up to 3 error lines', () => {
    const response = `正常な行
Error: First error
Error: Second error
Error: Third error
Error: Fourth error (should not be included)`;
    const result = detectErrors(response);

    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    expect(lines.length).toBe(3);
  });

  test('returns null for empty string', () => {
    const result = detectErrors('');

    expect(result).toBeNull();
  });

  test('returns null when no error patterns', () => {
    const response = '✅ ビルド成功しました。全てのテストがパス。';
    const result = detectErrors(response);

    expect(result).toBeNull();
  });

  test('returns default message when pattern matches but no error lines extracted', () => {
    // This case is handled by the || fallback in the code
    const response = 'Error:';
    const result = detectErrors(response);

    expect(result).not.toBeNull();
  });
});

describe('detectTestResults', () => {
  test('returns "fail" for "test failed" pattern', () => {
    const response = '3 tests failed out of 10';
    const result = detectTestResults(response);

    expect(result).toBe('fail');
  });

  test('returns "fail" for "テスト失敗" Japanese pattern', () => {
    const response = 'テスト失敗: 期待値と異なります';
    const result = detectTestResults(response);

    expect(result).toBe('fail');
  });

  test('returns "fail" for "テストエラー" pattern', () => {
    const response = 'テストエラーが発生';
    const result = detectTestResults(response);

    expect(result).toBe('fail');
  });

  test('returns "fail" for "❌ test" pattern', () => {
    const response = '❌ test suite failed';
    const result = detectTestResults(response);

    expect(result).toBe('fail');
  });

  test('returns "pass" for empty string', () => {
    const result = detectTestResults('');

    expect(result).toBe('pass');
  });

  test('returns "pass" for successful test output', () => {
    const response = '✅ All 15 tests passed\nExecution time: 2.3s';
    const result = detectTestResults(response);

    expect(result).toBe('pass');
  });

  test('returns "pass" for text without test failure patterns', () => {
    const response = 'ビルドが完了しました。デプロイの準備ができています。';
    const result = detectTestResults(response);

    expect(result).toBe('pass');
  });

  test('returns "fail" for realistic bun test failure output', () => {
    const response = `bun test v1.2.0

src/tests/example.test.ts:
✓ basic test [0.5ms]
✗ failing test [1.2ms]

 1 pass
 1 fail

 1 tests failed`;
    const result = detectTestResults(response);

    expect(result).toBe('fail');
  });
});

describe('detectPrerequisites', () => {
  describe('is_experiment flag', () => {
    test('detects "実験" keyword', () => {
      const response = 'これは実験的な機能です';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
    });

    test('detects "experiment" keyword (English)', () => {
      const response = 'This is an experiment feature';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
    });

    test('detects "test" keyword', () => {
      const response = 'Running test implementation';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
    });

    test('detects "試験" keyword', () => {
      const response = '試験運用中';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
    });
  });

  describe('production_impact flag', () => {
    test('detects "本番" keyword', () => {
      const response = '本番環境に影響があります';
      const result = detectPrerequisites(response);

      expect(result.production_impact).toBe(true);
    });

    test('detects "production" keyword', () => {
      const response = 'Deploying to production';
      const result = detectPrerequisites(response);

      expect(result.production_impact).toBe(true);
    });

    test('detects "prod" keyword', () => {
      const response = 'Pushing to prod server';
      const result = detectPrerequisites(response);

      expect(result.production_impact).toBe(true);
    });

    test('detects "deploy" keyword', () => {
      const response = 'Ready to deploy';
      const result = detectPrerequisites(response);

      expect(result.production_impact).toBe(true);
    });
  });

  describe('is_urgent flag', () => {
    test('detects "緊急" keyword', () => {
      const response = '緊急対応が必要';
      const result = detectPrerequisites(response);

      expect(result.is_urgent).toBe(true);
    });

    test('detects "urgent" keyword', () => {
      const response = 'This is urgent fix';
      const result = detectPrerequisites(response);

      expect(result.is_urgent).toBe(true);
    });

    test('detects "critical" keyword', () => {
      const response = 'Critical bug found';
      const result = detectPrerequisites(response);

      expect(result.is_urgent).toBe(true);
    });

    test('detects "hotfix" keyword', () => {
      const response = 'Applying hotfix for issue #123';
      const result = detectPrerequisites(response);

      expect(result.is_urgent).toBe(true);
    });
  });

  describe('multiple flags', () => {
    test('detects multiple flags simultaneously', () => {
      const response = '緊急: 本番環境で実験機能がクラッシュ';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
      expect(result.production_impact).toBe(true);
      expect(result.is_urgent).toBe(true);
    });

    test('returns all false for empty string', () => {
      const result = detectPrerequisites('');

      expect(result.is_experiment).toBe(false);
      expect(result.production_impact).toBe(false);
      expect(result.is_urgent).toBe(false);
    });

    test('returns all false for unrelated text', () => {
      const response = 'コードレビューが完了しました。マージできます。';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(false);
      expect(result.production_impact).toBe(false);
      expect(result.is_urgent).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    test('detects uppercase keywords', () => {
      const response = 'URGENT PRODUCTION EXPERIMENT';
      const result = detectPrerequisites(response);

      expect(result.is_experiment).toBe(true);
      expect(result.production_impact).toBe(true);
      expect(result.is_urgent).toBe(true);
    });

    test('detects mixed case keywords', () => {
      const response = 'Deploying Critical Hotfix';
      const result = detectPrerequisites(response);

      expect(result.production_impact).toBe(true);
      expect(result.is_urgent).toBe(true);
    });
  });
});

describe('integration scenarios', () => {
  test('realistic Phase completion response from AI', () => {
    const response = `## Phase 2 完了

### 実装内容
- src/utils/helper.ts を作成
- calculateTotal関数を実装
- ユニットテストを追加

### 次のステップ
Phase 3でAPIエンドポイントを実装`;

    const completion = detectPhaseCompletion(response);
    expect(completion.isPhaseComplete).toBe(true);
    expect(completion.phaseNumber).toBe(2);

    const summary = extractImplementationSummary(response);
    expect(summary).toContain('Phase 2 完了');

    const errors = detectErrors(response);
    expect(errors).toBeNull();

    const testResults = detectTestResults(response);
    expect(testResults).toBe('pass');
  });

  test('realistic error response from AI', () => {
    const response = `❌ ビルドエラー

Error: Cannot find module '@types/node'
Error: TypeScript compilation failed
Failed: 3 type errors

修正が必要です。`;

    const completion = detectPhaseCompletion(response);
    expect(completion.isPhaseComplete).toBe(false);

    const errors = detectErrors(response);
    expect(errors).not.toBeNull();
    // First matching pattern (❌) captures lines with ❌
    expect(errors).toContain('ビルドエラー');

    const testResults = detectTestResults(response);
    // Note: detectTestResults looks for "test failed", not general errors
    expect(testResults).toBe('pass');
  });

  test('realistic test failure response', () => {
    const response = `Running bun test...

src/tests/api.test.ts:
✓ GET /health [0.3ms]
✗ POST /users - test failed [1.5ms]
  Expected: 201
  Received: 400

1 test failed out of 5`;

    const errors = detectErrors(response);
    // No ❌ or Error: pattern
    expect(errors).toBeNull();

    const testResults = detectTestResults(response);
    expect(testResults).toBe('fail');
  });

  test('production hotfix scenario', () => {
    const response = `緊急: 本番サーバーでクリティカルなバグを発見
hotfix ブランチを作成して修正をdeploy`;

    const prerequisites = detectPrerequisites(response);
    expect(prerequisites.is_urgent).toBe(true);
    expect(prerequisites.production_impact).toBe(true);
    expect(prerequisites.is_experiment).toBe(false);
  });
});
