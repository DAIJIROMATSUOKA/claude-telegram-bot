/**
 * implementation-detector.ts のユニットテスト
 */
import { describe, test, expect } from 'bun:test';
import {
  detectImplementationStart,
  detectPhaseStart,
  detectCouncilConsultation,
  isUrgentImplementation,
  detectInterruptableTask,
  type DetectionResult,
} from '../utils/implementation-detector';

describe('implementation-detector', () => {
  // Helper function to verify DetectionResult shape
  const verifyDetectionResultShape = (result: DetectionResult) => {
    expect(typeof result.detected).toBe('boolean');
    expect(
      result.taskDescription === null || typeof result.taskDescription === 'string'
    ).toBe(true);
    expect(result.phase === null || typeof result.phase === 'string').toBe(true);
    expect(['normal', 'urgent']).toContain(result.priority);
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  };

  describe('detectImplementationStart', () => {
    describe('Japanese messages', () => {
      test('「了解しました！〇〇を実装します」パターンを検出', () => {
        const message = '了解しました！Proactive Context Switcherを実装します！';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('Proactive Context Switcher');
        expect(result.confidence).toBe(0.95);
        verifyDetectionResultShape(result);
      });

      test('「では、〇〇を実装していきます」パターンを検出', () => {
        const message = 'では、Context Detection機能を実装していきます。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('Context Detection機能');
        expect(result.confidence).toBe(0.90);
        verifyDetectionResultShape(result);
      });

      test('「〇〇の実装を開始します」パターンを検出', () => {
        const message = '新しいAPIエンドポイントの実装を開始します。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('新しいAPIエンドポイント');
        expect(result.confidence).toBe(0.92);
        verifyDetectionResultShape(result);
      });

      test('「実装を続行します」パターンを検出', () => {
        const message = 'エラーを修正しました。実装を続行します。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('実装続行');
        expect(result.confidence).toBe(0.85);
        verifyDetectionResultShape(result);
      });

      test('実装パターンがないメッセージは検出しない', () => {
        const message = 'このコードについて説明します。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(false);
        expect(result.taskDescription).toBeNull();
        expect(result.confidence).toBe(0.0);
        verifyDetectionResultShape(result);
      });
    });

    describe('edge cases', () => {
      test('空文字列は検出しない', () => {
        const result = detectImplementationStart('');

        expect(result.detected).toBe(false);
        expect(result.taskDescription).toBeNull();
        verifyDetectionResultShape(result);
      });

      test('部分一致は適切に処理', () => {
        // 「了解」のみでは検出しない
        const message = '了解です。確認しました。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });

      test('複数行メッセージでも最初のパターンを検出', () => {
        const message = '了解しました！新機能を実装します！\nまず設計から始めます。';
        const result = detectImplementationStart(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('新機能');
        verifyDetectionResultShape(result);
      });
    });
  });

  describe('detectPhaseStart', () => {
    describe('English patterns', () => {
      test('"Phase X: Description" パターンを検出', () => {
        const message = 'Phase 1: Context Detection実装';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 1');
        expect(result.taskDescription).toBe('Context Detection実装');
        expect(result.confidence).toBe(0.90);
        verifyDetectionResultShape(result);
      });

      test('"Phase X/Y: Description" パターンを検出', () => {
        const message = 'Phase 2/5: メインボット統合';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 2/5');
        expect(result.taskDescription).toBe('メインボット統合');
        expect(result.confidence).toBe(0.92);
        verifyDetectionResultShape(result);
      });

      test('大文字小文字を区別しない', () => {
        const message = 'phase 3: Unit Testing';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 3');
        expect(result.taskDescription).toBe('Unit Testing');
        verifyDetectionResultShape(result);
      });
    });

    describe('Japanese patterns', () => {
      test('「フェーズX: Description」パターンを検出', () => {
        const message = 'フェーズ2: データベース設計';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 2');
        expect(result.taskDescription).toBe('データベース設計');
        expect(result.confidence).toBe(0.88);
        verifyDetectionResultShape(result);
      });

      test('フェーズX（スペースあり）を検出', () => {
        const message = 'フェーズ 1: 初期設定';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 1');
        verifyDetectionResultShape(result);
      });
    });

    describe('edge cases', () => {
      test('フェーズパターンがないメッセージは検出しない', () => {
        const message = 'これはテストメッセージです';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(false);
        expect(result.phase).toBeNull();
        expect(result.taskDescription).toBeNull();
        verifyDetectionResultShape(result);
      });

      test('空文字列は検出しない', () => {
        const result = detectPhaseStart('');

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });

      test('Phaseという単語だけでは検出しない', () => {
        const message = 'This is a new phase in our project';
        const result = detectPhaseStart(message);

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });
    });
  });

  describe('detectCouncilConsultation', () => {
    describe('detection', () => {
      test('"council:" で始まるメッセージを検出', () => {
        const message = 'council: Darwin Engineのパフォーマンス改善方法を3つ提案して';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toContain('AI Council相談');
        expect(result.confidence).toBe(1.0);
        verifyDetectionResultShape(result);
      });

      test('大文字小文字を区別しない', () => {
        const message = 'Council: セキュリティ対策について相談';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(true);
        verifyDetectionResultShape(result);
      });

      test('COUNCILも検出', () => {
        const message = 'COUNCIL: 設計方針について';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(true);
        verifyDetectionResultShape(result);
      });

      test('先頭の空白を無視', () => {
        const message = '  council: テスト相談';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(true);
        verifyDetectionResultShape(result);
      });
    });

    describe('non-detection', () => {
      test('councilで始まらないメッセージは検出しない', () => {
        const message = 'Please council me on this matter';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(false);
        expect(result.taskDescription).toBeNull();
        expect(result.confidence).toBe(0.0);
        verifyDetectionResultShape(result);
      });

      test('空文字列は検出しない', () => {
        const result = detectCouncilConsultation('');

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });

      test('文中のcouncil:は検出しない', () => {
        const message = 'We need to hold a council: meeting tomorrow';
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });
    });

    describe('task description extraction', () => {
      test('長い質問は100文字で切り捨て', () => {
        const longQuestion = 'a'.repeat(150);
        const message = `council: ${longQuestion}`;
        const result = detectCouncilConsultation(message);

        expect(result.detected).toBe(true);
        expect(result.taskDescription!.length).toBeLessThan(120); // AI Council相談: + 100 + ...
        verifyDetectionResultShape(result);
      });
    });
  });

  describe('isUrgentImplementation', () => {
    describe('Japanese urgent keywords', () => {
      test('「緊急」を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('緊急: バグ修正が必要')).toBe(true);
      });

      test('「今すぐ」を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('今すぐ対応してください')).toBe(true);
      });

      test('「すぐに」を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('すぐに修正が必要です')).toBe(true);
      });
    });

    describe('English urgent keywords', () => {
      test('"urgent" を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('This is an urgent fix')).toBe(true);
      });

      test('"URGENT" (大文字) もurgent', () => {
        expect(isUrgentImplementation('URGENT: Fix needed')).toBe(true);
      });

      test('"asap" を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('Please fix this asap')).toBe(true);
      });

      test('"ASAP" (大文字) もurgent', () => {
        expect(isUrgentImplementation('Need this ASAP')).toBe(true);
      });

      test('"critical" を含むメッセージはurgent', () => {
        expect(isUrgentImplementation('Critical bug found')).toBe(true);
      });

      test('"Critical" (大文字小文字混合) もurgent', () => {
        expect(isUrgentImplementation('Critical: production issue')).toBe(true);
      });
    });

    describe('non-urgent messages', () => {
      test('緊急キーワードがないメッセージはnot urgent', () => {
        expect(isUrgentImplementation('普通の機能追加です')).toBe(false);
      });

      test('空文字列はnot urgent', () => {
        expect(isUrgentImplementation('')).toBe(false);
      });

      test('類似キーワードだが一致しないものはnot urgent', () => {
        expect(isUrgentImplementation('This urgency is low')).toBe(false);
      });

      test('関連のない単語はnot urgent', () => {
        expect(isUrgentImplementation('normal feature request')).toBe(false);
        expect(isUrgentImplementation('低優先度のタスク')).toBe(false);
      });
    });
  });

  describe('detectInterruptableTask', () => {
    describe('user messages', () => {
      test('council相談を検出', () => {
        const message = 'council: 設計相談';
        const result = detectInterruptableTask(message, 'user');

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toContain('AI Council相談');
        verifyDetectionResultShape(result);
      });

      test('通常のユーザーメッセージは検出しない', () => {
        const message = 'この機能を追加してください';
        const result = detectInterruptableTask(message, 'user');

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });
    });

    describe('bot messages - phase detection', () => {
      test('Phase開始を検出（優先度高）', () => {
        const message = 'Phase 1: 初期設定を行います';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 1');
        expect(result.priority).toBe('normal');
        verifyDetectionResultShape(result);
      });

      test('緊急Phase開始を検出', () => {
        const message = '緊急 Phase 1: バグ修正';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(true);
        expect(result.priority).toBe('urgent');
        verifyDetectionResultShape(result);
      });
    });

    describe('bot messages - implementation detection', () => {
      test('実装開始を検出', () => {
        const message = '了解しました！新機能を実装します！';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(true);
        expect(result.taskDescription).toBe('新機能');
        expect(result.priority).toBe('normal');
        verifyDetectionResultShape(result);
      });

      test('緊急実装を検出', () => {
        const message = '了解しました！urgentなバグ修正を実装します！';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(true);
        expect(result.priority).toBe('urgent');
        verifyDetectionResultShape(result);
      });

      test('通常のbotメッセージは検出しない', () => {
        const message = 'ファイルを読み込みました。内容を確認します。';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });
    });

    describe('priority handling', () => {
      test('PhaseとImplementationが両方ある場合、Phaseが優先される', () => {
        const message = 'Phase 1: 了解しました！機能を実装します！';
        const result = detectInterruptableTask(message, 'bot');

        expect(result.detected).toBe(true);
        expect(result.phase).toBe('Phase 1');
        verifyDetectionResultShape(result);
      });
    });

    describe('edge cases', () => {
      test('空文字列のユーザーメッセージ', () => {
        const result = detectInterruptableTask('', 'user');

        expect(result.detected).toBe(false);
        expect(result.confidence).toBe(0.0);
        verifyDetectionResultShape(result);
      });

      test('空文字列のbotメッセージ', () => {
        const result = detectInterruptableTask('', 'bot');

        expect(result.detected).toBe(false);
        verifyDetectionResultShape(result);
      });
    });
  });

  describe('DetectionResult shape', () => {
    test('すべての関数が正しい形状のDetectionResultを返す', () => {
      const testMessages = [
        '了解しました！テストを実装します',
        'Phase 1: テスト',
        'council: テスト',
        '通常のメッセージ',
      ];

      for (const msg of testMessages) {
        verifyDetectionResultShape(detectImplementationStart(msg));
        verifyDetectionResultShape(detectPhaseStart(msg));
        verifyDetectionResultShape(detectCouncilConsultation(msg));
        verifyDetectionResultShape(detectInterruptableTask(msg, 'user'));
        verifyDetectionResultShape(detectInterruptableTask(msg, 'bot'));
      }
    });

    test('confidence値は0.0から1.0の範囲', () => {
      const results = [
        detectImplementationStart('了解しました！テストを実装します'),
        detectPhaseStart('Phase 1: テスト'),
        detectCouncilConsultation('council: テスト'),
        detectInterruptableTask('テスト', 'user'),
        detectInterruptableTask('テスト', 'bot'),
      ];

      for (const result of results) {
        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
