/**
 * Auto-Resume System Tests
 */

import { describe, test, expect } from 'bun:test';
import {
  detectImplementationStart,
  detectPhaseStart,
  detectCouncilConsultation,
  isUrgentImplementation,
  detectInterruptableTask,
} from '../utils/implementation-detector';

describe('Implementation Detector', () => {
  describe('detectImplementationStart', () => {
    test('Pattern 1: 了解しました！〇〇を実装します！', () => {
      const message = '了解しました！Proactive Context Switcherを実装します！';
      const result = detectImplementationStart(message);

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toBe('Proactive Context Switcher');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('Pattern 2: では、〇〇を実装していきます', () => {
      const message = 'では、Context Detection機能を実装していきます。';
      const result = detectImplementationStart(message);

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toBe('Context Detection機能');
    });

    test('Pattern 3: 〇〇の実装を開始します', () => {
      const message = 'Auto-Resume Systemの実装を開始します。';
      const result = detectImplementationStart(message);

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toBe('Auto-Resume System');
    });

    test('Pattern 4: 実装を続行します', () => {
      const message = '実装を続行します。';
      const result = detectImplementationStart(message);

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toBe('実装続行');
    });

    test('No match: casual conversation', () => {
      const message = 'こんにちは！調子はどうですか？';
      const result = detectImplementationStart(message);

      expect(result.detected).toBe(false);
      expect(result.taskDescription).toBeNull();
    });
  });

  describe('detectPhaseStart', () => {
    test('Pattern 1: Phase X: Description', () => {
      const message = 'Phase 1: Context Detection実装';
      const result = detectPhaseStart(message);

      expect(result.detected).toBe(true);
      expect(result.phase).toBe('Phase 1');
      expect(result.taskDescription).toBe('Context Detection実装');
    });

    test('Pattern 2: Phase X/Y: Description', () => {
      const message = 'Phase 2/5: メインボット統合';
      const result = detectPhaseStart(message);

      expect(result.detected).toBe(true);
      expect(result.phase).toBe('Phase 2/5');
      expect(result.taskDescription).toBe('メインボット統合');
    });

    test('Pattern 3: フェーズX', () => {
      const message = 'フェーズ3: テスト実装';
      const result = detectPhaseStart(message);

      expect(result.detected).toBe(true);
      expect(result.phase).toBe('Phase 3');
      expect(result.taskDescription).toBe('テスト実装');
    });

    test('No match: no phase keyword', () => {
      const message = 'これから実装を開始します';
      const result = detectPhaseStart(message);

      expect(result.detected).toBe(false);
    });
  });

  describe('detectCouncilConsultation', () => {
    test('Detects council: prefix', () => {
      const message = 'council: Proactive Context Switcherの実装順序を教えてください';
      const result = detectCouncilConsultation(message);

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toContain('AI Council相談');
      expect(result.confidence).toBe(1.0);
    });

    test('Case insensitive', () => {
      const message = 'Council: 質問です';
      const result = detectCouncilConsultation(message);

      expect(result.detected).toBe(true);
    });

    test('No match: no council keyword', () => {
      const message = 'これについて教えてください';
      const result = detectCouncilConsultation(message);

      expect(result.detected).toBe(false);
    });
  });

  describe('isUrgentImplementation', () => {
    test('Detects 緊急', () => {
      expect(isUrgentImplementation('緊急で実装してください')).toBe(true);
    });

    test('Detects urgent (English)', () => {
      expect(isUrgentImplementation('This is urgent!')).toBe(true);
    });

    test('Detects ASAP', () => {
      expect(isUrgentImplementation('ASAP please')).toBe(true);
    });

    test('Detects 今すぐ', () => {
      expect(isUrgentImplementation('今すぐ対応してください')).toBe(true);
    });

    test('No urgent keywords', () => {
      expect(isUrgentImplementation('通常の実装です')).toBe(false);
    });
  });

  describe('detectInterruptableTask (unified)', () => {
    test('User message: council consultation', () => {
      const message = 'council: 実装順序を教えて';
      const result = detectInterruptableTask(message, 'user');

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toContain('AI Council相談');
    });

    test('Bot message: Phase start', () => {
      const message = 'Phase 1: Snapshot保存システム実装';
      const result = detectInterruptableTask(message, 'bot');

      expect(result.detected).toBe(true);
      expect(result.phase).toBe('Phase 1');
    });

    test('Bot message: Implementation start', () => {
      const message = '了解しました！Auto-Resume Systemを実装します！';
      const result = detectInterruptableTask(message, 'bot');

      expect(result.detected).toBe(true);
      expect(result.taskDescription).toBe('Auto-Resume System');
    });

    test('Bot message: Urgent implementation', () => {
      const message = '緊急で了解しました！エラー修正を実装します！';
      const result = detectInterruptableTask(message, 'bot');

      expect(result.detected).toBe(true);
      expect(result.priority).toBe('urgent');
    });

    test('No detection', () => {
      const message = 'こんにちは';
      const result = detectInterruptableTask(message, 'user');

      expect(result.detected).toBe(false);
    });
  });
});
