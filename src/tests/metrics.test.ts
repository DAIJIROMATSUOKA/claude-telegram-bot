/**
 * metrics.ts のユニットテスト
 */

import { describe, test, expect } from 'bun:test';
import {
  recordMessageMetrics,
  getMetricsSummary,
  formatMetricsForStatus,
  cleanupOldMetrics,
  recordBgTaskMetrics,
} from '../utils/metrics';
import type { MessageMetrics } from '../utils/metrics';

describe('metrics', () => {
  describe('recordMessageMetrics', () => {
    test('MessageMetrics型のオブジェクトを渡してもエラーにならない', () => {
      const metrics: MessageMetrics = {
        message_type: 'text',
        enrichment_ms: 100,
        context_fetch_ms: 50,
        claude_latency_ms: 500,
        total_ms: 650,
        context_size_chars: 1000,
        tool_count: 2,
        bg_tasks_ok: 1,
        bg_tasks_fail: 0,
        success: true,
      };

      expect(() => recordMessageMetrics(metrics)).not.toThrow();
    });

    test('空のオブジェクトでもエラーにならない', () => {
      const metrics: MessageMetrics = {};
      expect(() => recordMessageMetrics(metrics)).not.toThrow();
    });
  });

  describe('getMetricsSummary', () => {
    test('返り値にtotalMessages, avgTotalMsフィールドが存在する', () => {
      const summary = getMetricsSummary();

      expect(summary).toHaveProperty('totalMessages');
      expect(summary).toHaveProperty('avgTotalMs');
    });

    test('totalMessagesは0以上の数値', () => {
      const summary = getMetricsSummary();

      expect(typeof summary.totalMessages).toBe('number');
      expect(summary.totalMessages).toBeGreaterThanOrEqual(0);
    });

    test('hoursBack引数を渡しても動作する', () => {
      const summary = getMetricsSummary(24);

      expect(typeof summary.totalMessages).toBe('number');
    });
  });

  describe('formatMetricsForStatus', () => {
    test('文字列を返す', () => {
      const result = formatMetricsForStatus();

      expect(typeof result).toBe('string');
    });

    test('hoursBack引数を渡しても文字列を返す', () => {
      const result = formatMetricsForStatus(24);

      expect(typeof result).toBe('string');
    });
  });

  describe('cleanupOldMetrics', () => {
    test('呼び出してもエラーにならない', () => {
      expect(() => cleanupOldMetrics()).not.toThrow();
    });
  });

  describe('recordBgTaskMetrics', () => {
    test('成功ケースでエラーにならない', () => {
      expect(() => {
        recordBgTaskMetrics('test-task', true, 100);
      }).not.toThrow();
    });

    test('失敗ケースでエラーにならない', () => {
      expect(() => {
        recordBgTaskMetrics('test-task', false, 200, 'Test error message');
      }).not.toThrow();
    });

    test('errorMessageなしの失敗ケースでもエラーにならない', () => {
      expect(() => {
        recordBgTaskMetrics('test-task', false, 150);
      }).not.toThrow();
    });
  });
});
