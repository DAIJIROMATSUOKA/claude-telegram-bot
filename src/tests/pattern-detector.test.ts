// @ts-nocheck
/**
 * pattern-detector.ts のユニットテスト
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  detectWeeklyPatterns,
  detectMonthlyPatterns,
  detectFrequencyPatterns,
  detectDependencyPatterns,
  predictTasks,
  formatPredictedTasks,
  type PredictedTask,
} from '../utils/pattern-detector';

describe('pattern-detector', () => {
  // 日付をモックするためのオリジナルDateを保存
  const OriginalDate = global.Date;

  afterEach(() => {
    // 各テスト後にDateを復元
    global.Date = OriginalDate;
  });

  describe('detectWeeklyPatterns', () => {
    test('月曜日に週報キーワードがあれば週報作成を予測', () => {
      // 月曜日をモック (2026-02-09 = 月曜日)
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '毎週月曜: ミーティング\n週報を提出した\n週次レポート作成';
      const result = detectWeeklyPatterns(historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('週報作成');
      expect(result[0]!.confidence).toBe(0.8);
      expect(result[0]!.source).toBe('time-based');
    });

    test('金曜日に週次キーワードがあれば週次レポート準備を予測', () => {
      // 金曜日をモック (2026-02-13 = 金曜日)
      const mockDate = new OriginalDate('2026-02-13T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週次ミーティングの準備\n来週の予定確認';
      const result = detectWeeklyPatterns(historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('週次レポート準備');
      expect(result[0]!.confidence).toBe(0.7);
      expect(result[0]!.source).toBe('time-based');
    });

    test('平日（火〜木）はパターンなし', () => {
      // 水曜日をモック (2026-02-11 = 水曜日)
      const mockDate = new OriginalDate('2026-02-11T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週報を提出した\n週次レポート作成';
      const result = detectWeeklyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('月曜日でもキーワードがなければパターンなし', () => {
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = 'プロジェクトの進捗確認\n設計書レビュー';
      const result = detectWeeklyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('空の履歴テキストではパターンなし', () => {
      const result = detectWeeklyPatterns('');
      expect(result.length).toBe(0);
    });
  });

  describe('detectMonthlyPatterns', () => {
    test('月初（1-7日）に月報キーワードがあれば月報作成を予測', () => {
      // 月初をモック (2026-02-03 = 3日)
      const mockDate = new OriginalDate('2026-02-03T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '月報提出\n月次レポート作成\nプロジェクト進捗';
      const result = detectMonthlyPatterns(historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('月報作成');
      expect(result[0]!.confidence).toBe(0.85);
      expect(result[0]!.source).toBe('time-based');
    });

    test('月末: レポート提出 - 月末に締めキーワードがあれば締め処理を予測', () => {
      // 月末をモック (2026-02-26 = 26日, 2月は28日まで)
      const mockDate = new OriginalDate('2026-02-26T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '月末の締め処理\n請求書発行\nレポート提出';
      const result = detectMonthlyPatterns(historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('月末締め処理');
      expect(result[0]!.confidence).toBe(0.8);
      expect(result[0]!.source).toBe('time-based');
    });

    test('月中（8-24日）はパターンなし', () => {
      // 月中をモック (2026-02-15 = 15日)
      const mockDate = new OriginalDate('2026-02-15T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '月報提出\n請求書発行\n締め処理';
      const result = detectMonthlyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('月初でもキーワードがなければパターンなし', () => {
      const mockDate = new OriginalDate('2026-02-03T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = 'プロジェクト打ち合わせ\n設計レビュー';
      const result = detectMonthlyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('空の履歴テキストではパターンなし', () => {
      const result = detectMonthlyPatterns('');
      expect(result.length).toBe(0);
    });
  });

  describe('detectFrequencyPatterns', () => {
    test('キーワードが3回以上出現すれば関連タスクを予測', () => {
      const historyText = 'ヤガイ案件の打ち合わせ\nヤガイ設計レビュー\nヤガイ図面確認\nヤガイ進捗報告';
      const result = detectFrequencyPatterns(historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('ヤガイ案件の進捗確認');
      expect(result[0]!.source).toBe('frequency-based');
      // 4回出現 -> confidence = 0.5 + 0.4 = 0.9
      expect(result[0]!.confidence).toBe(0.9);
    });

    test('複数キーワードがそれぞれ3回以上出現すれば複数予測', () => {
      const historyText = `
        ヤガイ案件1 ヤガイ案件2 ヤガイ案件3
        設計レビュー1 設計レビュー2 設計レビュー3
        見積書作成1 見積書作成2 見積書作成3
      `;
      const result = detectFrequencyPatterns(historyText);

      expect(result.length).toBe(3);
      const contents = result.map(r => r.content);
      expect(contents).toContain('ヤガイ案件の進捗確認');
      expect(contents).toContain('設計レビュー');
      expect(contents).toContain('見積書作成');
    });

    test('キーワードが2回以下ならパターンなし', () => {
      const historyText = 'ヤガイ案件\nヤガイ確認';
      const result = detectFrequencyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('マッチするキーワードがなければパターンなし', () => {
      const historyText = '会議の準備\nドキュメント作成\nコードレビュー';
      const result = detectFrequencyPatterns(historyText);

      expect(result.length).toBe(0);
    });

    test('空の履歴テキストではパターンなし', () => {
      const result = detectFrequencyPatterns('');
      expect(result.length).toBe(0);
    });

    test('信頼度は0.9を超えない', () => {
      // 10回出現させる
      const historyText = Array(10).fill('ヤガイ').join(' ');
      const result = detectFrequencyPatterns(historyText);

      expect(result.length).toBe(1);
      // 10回出現 -> Math.min(0.9, 0.5 + 1.0) = 0.9
      expect(result[0]!.confidence).toBe(0.9);
    });
  });

  describe('detectDependencyPatterns', () => {
    test('設計タスクがあり履歴に設計・図面があれば図面作成を予測', () => {
      const todayTasks = ['設計レビュー', 'コード確認'];
      const historyText = '設計書作成\n図面レビュー\n設計完了後に図面作成';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('設計図面の作成');
      expect(result[0]!.confidence).toBe(0.75);
      expect(result[0]!.source).toBe('dependency-based');
    });

    test('見積タスクがあり履歴に見積・発注があれば発注準備を予測', () => {
      const todayTasks = ['見積確認', 'メール返信'];
      const historyText = '見積書送付\n発注処理\n見積承認';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('見積承認後の発注準備');
      expect(result[0]!.confidence).toBe(0.7);
      expect(result[0]!.source).toBe('dependency-based');
    });

    test('会議タスクがあれば議事録作成を予測（履歴不要）', () => {
      const todayTasks = ['プロジェクト会議'];
      const historyText = '';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('議事録作成');
      expect(result[0]!.confidence).toBe(0.8);
      expect(result[0]!.source).toBe('dependency-based');
    });

    test('打ち合わせタスクがあれば議事録作成を予測', () => {
      const todayTasks = ['顧客打ち合わせ'];
      const historyText = '';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(1);
      expect(result[0]!.content).toBe('議事録作成');
    });

    test('複数の依存パターンがマッチすれば複数予測', () => {
      const todayTasks = ['設計レビュー', '見積確認', 'プロジェクト会議'];
      const historyText = '設計と図面\n見積と発注';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(3);
      const contents = result.map(r => r.content);
      expect(contents).toContain('設計図面の作成');
      expect(contents).toContain('見積承認後の発注準備');
      expect(contents).toContain('議事録作成');
    });

    test('マッチするタスクがなければパターンなし', () => {
      const todayTasks = ['メール返信', 'ドキュメント作成'];
      const historyText = 'コードレビュー\nテスト実行';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(0);
    });

    test('todayTasksが空ならパターンなし', () => {
      const todayTasks: string[] = [];
      const historyText = '設計と図面\n見積と発注';
      const result = detectDependencyPatterns(todayTasks, historyText);

      expect(result.length).toBe(0);
    });
  });

  describe('predictTasks', () => {
    test('すべてのパターン検出を統合', () => {
      // 月曜日をモック
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週報提出\nヤガイ案件1\nヤガイ案件2\nヤガイ案件3';
      const todayTasks = ['プロジェクト会議'];
      const result = predictTasks(historyText, todayTasks);

      // 週報（weekly）、ヤガイ（frequency）、議事録（dependency）が検出される
      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    test('重複するタスクは信頼度の高いものが残る', () => {
      // 月曜日をモック（週報が両方のパターンでマッチする可能性）
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週報';
      const result = predictTasks(historyText);

      // 同じcontentは1つだけ
      const weeklyReport = result.filter(r => r.content === '週報作成');
      expect(weeklyReport.length).toBeLessThanOrEqual(1);
    });

    test('信頼度0.6未満のタスクはフィルタされる', () => {
      // 信頼度が低いパターンのみの場合
      const historyText = '';
      const result = predictTasks(historyText);

      // すべての結果は信頼度0.6以上
      for (const p of result) {
        expect(p.confidence).toBeGreaterThanOrEqual(0.6);
      }
    });

    test('結果は信頼度でソートされる', () => {
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週報\nヤガイ1 ヤガイ2 ヤガイ3 ヤガイ4 ヤガイ5';
      const todayTasks = ['会議'];
      const result = predictTasks(historyText, todayTasks);

      // 信頼度の降順でソートされている
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]!.confidence).toBeGreaterThanOrEqual(result[i + 1]!.confidence);
      }
    });

    test('todayTasksを省略した場合も動作', () => {
      const mockDate = new OriginalDate('2026-02-09T10:00:00');
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      } as any;

      const historyText = '週報提出';
      const result = predictTasks(historyText);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test('空の履歴と空のタスクでは結果なし', () => {
      const result = predictTasks('', []);
      expect(result.length).toBe(0);
    });
  });

  describe('formatPredictedTasks', () => {
    test('予測タスクを読みやすい文字列にフォーマット', () => {
      const predictions: PredictedTask[] = [
        {
          content: '週報作成',
          reason: '毎週月曜日に週報を作成しています',
          confidence: 0.85,
          source: 'time-based',
        },
        {
          content: '議事録作成',
          reason: '会議の後には議事録作成が必要です',
          confidence: 0.8,
          source: 'dependency-based',
        },
      ];

      const result = formatPredictedTasks(predictions);

      expect(result).toContain('🔮');
      expect(result).toContain('予測タスク');
      expect(result).toContain('週報作成');
      expect(result).toContain('85%');
      expect(result).toContain('議事録作成');
      expect(result).toContain('80%');
      expect(result).toContain('理由');
    });

    test('信頼度に応じた絵文字が使われる', () => {
      const highConfidence: PredictedTask[] = [
        { content: '高信頼', reason: 'test', confidence: 0.85, source: 'time-based' },
      ];
      const medConfidence: PredictedTask[] = [
        { content: '中信頼', reason: 'test', confidence: 0.75, source: 'time-based' },
      ];
      const lowConfidence: PredictedTask[] = [
        { content: '低信頼', reason: 'test', confidence: 0.65, source: 'time-based' },
      ];

      expect(formatPredictedTasks(highConfidence)).toContain('🔥');
      expect(formatPredictedTasks(medConfidence)).toContain('⭐');
      expect(formatPredictedTasks(lowConfidence)).toContain('💡');
    });

    test('最大5件までフォーマットされる', () => {
      const predictions: PredictedTask[] = Array(10).fill(null).map((_, i) => ({
        content: `タスク${i}`,
        reason: `理由${i}`,
        confidence: 0.8,
        source: 'time-based' as const,
      }));

      const result = formatPredictedTasks(predictions);

      // タスク0〜4は含まれる
      expect(result).toContain('タスク0');
      expect(result).toContain('タスク4');
      // タスク5以降は含まれない
      expect(result).not.toContain('タスク5');
      expect(result).not.toContain('タスク9');
    });

    test('空配列の場合は空文字列を返す', () => {
      const result = formatPredictedTasks([]);
      expect(result).toBe('');
    });

    test('出力に承認メッセージが含まれる', () => {
      const predictions: PredictedTask[] = [
        { content: 'テスト', reason: 'test', confidence: 0.8, source: 'time-based' },
      ];

      const result = formatPredictedTasks(predictions);

      expect(result).toContain('予測タスクを追加');
    });
  });
});
