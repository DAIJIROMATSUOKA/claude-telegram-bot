/**
 * bg-task-manager.ts のユニットテスト
 */
import { describe, test, expect } from 'bun:test';
import { runBgTask, getBgTaskSummary } from '../utils/bg-task-manager';

describe('bg-task-manager', () => {
  describe('getBgTaskSummary()', () => {
    test('返り値にtotal, successes, failures, recentFailuresフィールドが存在する', () => {
      const summary = getBgTaskSummary();

      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('successes');
      expect(summary).toHaveProperty('failures');
      expect(summary).toHaveProperty('recentFailures');
    });

    test('totalはsuccesses + failuresと等しい', () => {
      const summary = getBgTaskSummary();

      expect(summary.total).toBe(summary.successes + summary.failures);
    });

    test('recentFailuresは配列である', () => {
      const summary = getBgTaskSummary();

      expect(Array.isArray(summary.recentFailures)).toBe(true);
    });
  });

  describe('runBgTask()', () => {
    test('成功するタスクを実行後、getBgTaskSummaryのtotalが増加する', async () => {
      const beforeSummary = getBgTaskSummary();
      const beforeTotal = beforeSummary.total;

      runBgTask(
        async () => {
          // 成功するタスク
        },
        { name: 'test-success-task' }
      );

      // 非同期実行を待つ
      await new Promise((r) => setTimeout(r, 200));

      const afterSummary = getBgTaskSummary();
      expect(afterSummary.total).toBe(beforeTotal + 1);
    });

    test('失敗するタスクを実行後、getBgTaskSummaryのfailuresが増加する', async () => {
      const beforeSummary = getBgTaskSummary();
      const beforeFailures = beforeSummary.failures;

      runBgTask(
        async () => {
          throw new Error('intentional failure');
        },
        { name: 'test-failure-task', maxRetries: 0 }
      );

      // 非同期実行を待つ
      await new Promise((r) => setTimeout(r, 200));

      const afterSummary = getBgTaskSummary();
      expect(afterSummary.failures).toBe(beforeFailures + 1);
    });

    test('runBgTaskはvoidを返す', () => {
      const result = runBgTask(
        async () => {},
        { name: 'test-void-return' }
      );

      expect(result).toBeUndefined();
    });
  });
});
