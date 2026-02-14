// @ts-nocheck
/**
 * Session Summary Unit Tests
 *
 * generateSessionSummary と formatSessionSummariesForPrompt の純粋関数テスト
 * Memory Gatewayやmulti-ai依存なし
 */

import { describe, test, expect } from 'bun:test';
import {
  generateSessionSummary,
  formatSessionSummariesForPrompt,
  SessionSummary,
} from '../utils/session-summary';

describe('generateSessionSummary', () => {
  test('空配列 → 空の結果', () => {
    const result = generateSessionSummary([]);

    expect(result.topics).toEqual([]);
    expect(result.keyDecisions).toEqual([]);
    expect(result.unfinishedTasks).toEqual([]);
    expect(result.summary).toContain('メッセージ数: 0件');
  });

  test('コマンドメッセージ → トピックに「コマンド: /xxx」が含まれる', () => {
    const messages = [
      { role: 'user', content: '/status チェック', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('コマンド: /status');
  });

  test('「タスク」を含むメッセージ → トピックに「タスク管理」', () => {
    const messages = [
      { role: 'user', content: '今日のタスクを確認して', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('タスク管理');
  });

  test('「コード」を含むメッセージ → トピックに「コーディング」', () => {
    const messages = [
      { role: 'user', content: 'このコードをレビューして', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('コーディング');
  });

  test('「バグ」を含むメッセージ → トピックに「デバッグ」', () => {
    const messages = [
      { role: 'user', content: 'バグを見つけた', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('デバッグ');
  });

  test('「決定:」を含むアシスタントメッセージ → keyDecisionsに抽出', () => {
    const messages = [
      { role: 'user', content: '方針どうする？', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: '決定: TypeScriptで実装する', timestamp: '2025-02-14T10:01:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.keyDecisions).toContain('TypeScriptで実装する');
  });

  test('「Phase 1 完了」を含むアシスタントメッセージ → keyDecisionsに抽出', () => {
    const messages = [
      { role: 'user', content: '進捗は？', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: 'Phase 1 完了しました', timestamp: '2025-02-14T10:01:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.keyDecisions.some(d => d.includes('Phase 1') && d.includes('完了'))).toBe(true);
  });

  test('「次は:」を含む最後のアシスタントメッセージ → unfinishedTasksに抽出', () => {
    const messages = [
      { role: 'user', content: '進捗は？', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: '次は: テストを書く', timestamp: '2025-02-14T10:01:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.unfinishedTasks).toContain('テストを書く');
  });

  test('複数メッセージの統合テスト → summary に期間・メッセージ数・トピックが含まれる', () => {
    const messages = [
      { role: 'user', content: '/start セッション開始', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: 'セッション開始した', timestamp: '2025-02-14T10:00:30' },
      { role: 'user', content: 'このコードにバグがある', timestamp: '2025-02-14T10:05:00' },
      { role: 'assistant', content: '決定: 修正方針はXとする', timestamp: '2025-02-14T10:10:00' },
      { role: 'user', content: 'タスク完了して', timestamp: '2025-02-14T10:15:00' },
      { role: 'assistant', content: '次は: デプロイ準備', timestamp: '2025-02-14T10:20:00' },
    ];

    const result = generateSessionSummary(messages);

    // 期間
    expect(result.summary).toContain('期間:');
    expect(result.summary).toContain('2025-02-14T10:00');
    expect(result.summary).toContain('2025-02-14T10:20');

    // メッセージ数
    expect(result.summary).toContain('メッセージ数: 6件');

    // トピック
    expect(result.summary).toContain('トピック:');
    expect(result.topics).toContain('コマンド: /start');
    expect(result.topics).toContain('コーディング');
    expect(result.topics).toContain('デバッグ');
    expect(result.topics).toContain('タスク管理');

    // 決定事項
    expect(result.keyDecisions).toContain('修正方針はXとする');

    // 未完了タスク
    expect(result.unfinishedTasks).toContain('デプロイ準備');
  });

  test('200文字超の決定事項 → 200文字に切り詰め', () => {
    const longDecision = 'A'.repeat(300);
    const messages = [
      { role: 'user', content: '方針', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: `決定: ${longDecision}`, timestamp: '2025-02-14T10:01:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.keyDecisions[0].length).toBe(200);
  });

  test('英語キーワード「code」→ コーディングトピック', () => {
    const messages = [
      { role: 'user', content: 'fix the code please', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('コーディング');
  });

  test('英語キーワード「bug」→ デバッグトピック', () => {
    const messages = [
      { role: 'user', content: 'found a bug', timestamp: '2025-02-14T10:00:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.topics).toContain('デバッグ');
  });

  test('TODO を含むアシスタントメッセージ → unfinishedTasksに抽出', () => {
    const messages = [
      { role: 'user', content: '進捗は？', timestamp: '2025-02-14T10:00:00' },
      { role: 'assistant', content: 'TODO: リファクタリング', timestamp: '2025-02-14T10:01:00' },
    ];

    const result = generateSessionSummary(messages);

    expect(result.unfinishedTasks).toContain('リファクタリング');
  });
});

describe('formatSessionSummariesForPrompt', () => {
  test('空配列 → 空文字列', () => {
    const result = formatSessionSummariesForPrompt([]);

    expect(result).toBe('');
  });

  test('1件の要約 → ヘッダー + 日時 + 要約内容', () => {
    const summaries: SessionSummary[] = [
      {
        id: 'test-id-1',
        user_id: '12345',
        session_id: 'session-1',
        summary: 'テスト要約',
        topics: 'コーディング, デバッグ',
        key_decisions: '方針A採用',
        unfinished_tasks: 'テスト書く',
        created_at: '2025-02-14 10:00:00',
      },
    ];

    const result = formatSessionSummariesForPrompt(summaries);

    // ヘッダー
    expect(result).toContain('[PAST SESSION SUMMARIES');

    // 日時
    expect(result).toContain('2025-02-14 10:00:00');

    // 要約内容
    expect(result).toContain('テスト要約');
    expect(result).toContain('トピック: コーディング, デバッグ');
    expect(result).toContain('決定事項: 方針A採用');
    expect(result).toContain('未完了: テスト書く');
  });

  test('topics/key_decisions/unfinished_tasks が空文字 → 該当行が出力されない', () => {
    const summaries: SessionSummary[] = [
      {
        id: 'test-id-1',
        user_id: '12345',
        session_id: 'session-1',
        summary: 'テスト要約のみ',
        topics: '',
        key_decisions: '',
        unfinished_tasks: '',
        created_at: '2025-02-14 10:00:00',
      },
    ];

    const result = formatSessionSummariesForPrompt(summaries);

    expect(result).toContain('テスト要約のみ');
    expect(result).not.toContain('トピック:');
    expect(result).not.toContain('決定事項:');
    expect(result).not.toContain('未完了:');
  });

  test('複数件の要約 → 全件が含まれる', () => {
    const summaries: SessionSummary[] = [
      {
        id: 'test-id-1',
        user_id: '12345',
        session_id: 'session-1',
        summary: '最新セッション',
        topics: 'トピックA',
        key_decisions: '決定A',
        unfinished_tasks: 'タスクA',
        created_at: '2025-02-14 12:00:00',
      },
      {
        id: 'test-id-2',
        user_id: '12345',
        session_id: 'session-2',
        summary: '前回セッション',
        topics: 'トピックB',
        key_decisions: '決定B',
        unfinished_tasks: 'タスクB',
        created_at: '2025-02-14 10:00:00',
      },
      {
        id: 'test-id-3',
        user_id: '12345',
        session_id: 'session-3',
        summary: '古いセッション',
        topics: 'トピックC',
        key_decisions: '',
        unfinished_tasks: '',
        created_at: '2025-02-13 15:00:00',
      },
    ];

    const result = formatSessionSummariesForPrompt(summaries);

    // 全セッションが含まれる
    expect(result).toContain('最新セッション');
    expect(result).toContain('前回セッション');
    expect(result).toContain('古いセッション');

    // 各セッションの日時
    expect(result).toContain('2025-02-14 12:00:00');
    expect(result).toContain('2025-02-14 10:00:00');
    expect(result).toContain('2025-02-13 15:00:00');

    // トピック・決定事項
    expect(result).toContain('トピック: トピックA');
    expect(result).toContain('トピック: トピックB');
    expect(result).toContain('トピック: トピックC');
    expect(result).toContain('決定事項: 決定A');
    expect(result).toContain('決定事項: 決定B');
  });

  test('部分的に空のフィールドがある場合 → 空でないフィールドのみ出力', () => {
    const summaries: SessionSummary[] = [
      {
        id: 'test-id-1',
        user_id: '12345',
        session_id: 'session-1',
        summary: '要約テスト',
        topics: 'トピックあり',
        key_decisions: '',  // 空
        unfinished_tasks: '未完了あり',
        created_at: '2025-02-14 10:00:00',
      },
    ];

    const result = formatSessionSummariesForPrompt(summaries);

    expect(result).toContain('トピック: トピックあり');
    expect(result).not.toContain('決定事項:');
    expect(result).toContain('未完了: 未完了あり');
  });
});
