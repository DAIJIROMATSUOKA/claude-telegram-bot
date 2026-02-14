/**
 * learned-memory.ts の純粋関数テスト
 */

import { describe, test, expect } from 'bun:test';
import {
  extractLearnableContent,
  filterRelevantMemories,
  formatLearnedMemoryForPrompt,
  LearnedMemory,
} from '../utils/learned-memory';

// テスト用のLearnedMemoryファクトリ
function createMemory(
  overrides: Partial<LearnedMemory> = {}
): LearnedMemory {
  return {
    id: 'test-id-' + Math.random().toString(36).slice(2, 9),
    user_id: 'test-user',
    category: 'rule',
    content: 'テスト内容',
    source_message: 'テストメッセージ',
    confidence: 0.8,
    created_at: new Date().toISOString(),
    active: 1,
    ...overrides,
  };
}

describe('extractLearnableContent', () => {
  describe('基本ケース', () => {
    test('空文字 → 空配列', () => {
      const result = extractLearnableContent('', '');
      expect(result).toEqual([]);
    });

    test('空白のみ → 空配列', () => {
      const result = extractLearnableContent('   ', '');
      expect(result).toEqual([]);
    });
  });

  describe('ルール系パターン（category=rule）', () => {
    test('「〜するな」パターン → category=rule, confidence>=0.9', () => {
      const result = extractLearnableContent('敬語使うな', '');
      expect(result.length).toBeGreaterThan(0);
      const ruleItem = result.find(r => r.category === 'rule');
      expect(ruleItem).toBeDefined();
      expect(ruleItem!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('「しないで」パターン → category=rule', () => {
      const result = extractLearnableContent('エラーを無視しないで', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'rule')).toBeDefined();
    });

    test('「禁止」パターン → category=rule', () => {
      const result = extractLearnableContent('コメントの追加禁止', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'rule')).toBeDefined();
    });

    test('「必ず〜しろ」パターン → category=rule', () => {
      // 「必ず〜しろ/して/すること/使え」にマッチ
      const result = extractLearnableContent('必ずテストしろ', '');
      expect(result.length).toBeGreaterThan(0);
      const ruleItem = result.find(r => r.category === 'rule');
      expect(ruleItem).toBeDefined();
    });

    test('「絶対に〜すること」パターン → category=rule', () => {
      const result = extractLearnableContent('絶対に型チェックすること', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'rule')).toBeDefined();
    });

    test('「〜は禁止」パターン → category=rule', () => {
      const result = extractLearnableContent('APIキーのハードコードは禁止', '');
      expect(result.length).toBeGreaterThan(0);
      const ruleItem = result.find(r => r.category === 'rule');
      expect(ruleItem).toBeDefined();
      expect(ruleItem!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('「〜はNG」パターン → category=rule', () => {
      const result = extractLearnableContent('console.logはNG', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'rule')).toBeDefined();
    });
  });

  describe('好み系パターン（category=preference）', () => {
    test('「〜がいい」パターン → category=preference', () => {
      const result = extractLearnableContent('シンプルな実装がいい', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'preference')).toBeDefined();
    });

    test('「〜にして」パターン → category=preference', () => {
      const result = extractLearnableContent('コードはシンプルにして', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'preference')).toBeDefined();
    });

    test('「〜嫌い」パターン → category=preference', () => {
      const result = extractLearnableContent('長いコメント嫌い', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'preference')).toBeDefined();
    });
  });

  describe('修正系パターン（category=correction）', () => {
    test('「違う、〜じゃなくて〜」パターン → category=correction', () => {
      const result = extractLearnableContent(
        '違う、そうじゃなくてこっちを使え',
        '前回の応答'
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'correction')).toBeDefined();
    });

    test('「そうじゃない」パターン → category=correction', () => {
      const result = extractLearnableContent('そうじゃない', '何か前の応答');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'correction')).toBeDefined();
    });

    test('assistantResponseが空の場合 → correctionは抽出されない', () => {
      const result = extractLearnableContent('違う', '');
      const correctionItem = result.find(r => r.category === 'correction');
      expect(correctionItem).toBeUndefined();
    });
  });

  describe('ワークフロー系パターン（category=workflow）', () => {
    test('「いつも〜」パターン → category=workflow', () => {
      const result = extractLearnableContent('いつもテストを先に書く', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'workflow')).toBeDefined();
    });

    test('「毎回〜」パターン → category=workflow', () => {
      const result = extractLearnableContent('毎回ビルド確認する', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'workflow')).toBeDefined();
    });
  });

  describe('事実系パターン（category=fact）', () => {
    test('「俺は〜」パターン → category=fact', () => {
      const result = extractLearnableContent('俺はバックエンドエンジニアだ', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'fact')).toBeDefined();
    });

    test('「うちは〜」パターン → category=fact', () => {
      const result = extractLearnableContent('うちはスタートアップだ', '');
      expect(result.length).toBeGreaterThan(0);
      expect(result.find(r => r.category === 'fact')).toBeDefined();
    });
  });

  describe('複数パターンの抽出', () => {
    test('フラストレーション + ルール → 複数抽出される', () => {
      const result = extractLearnableContent('もう嫌だ敬語使うなって言ってるだろ', '');
      // フラストレーションパターンとルールパターン両方にマッチ
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 【重要】マーク付きの高優先度ルールが含まれる
      const importantRule = result.find(r => r.content.includes('【重要】'));
      expect(importantRule).toBeDefined();
    });

    test('「覚えて」パターン → confidence=1.0の最重要ルール', () => {
      const result = extractLearnableContent('覚えてくれ、型チェックは必須だ', '');
      expect(result.length).toBeGreaterThan(0);
      const importantItem = result.find(r => r.confidence === 1.0);
      expect(importantItem).toBeDefined();
      expect(importantItem!.content).toContain('【重要】');
    });
  });

  describe('エッジケース', () => {
    test('パターンに一致しない通常メッセージ → 空配列', () => {
      const result = extractLearnableContent('今日の天気はどう？', '');
      expect(result).toEqual([]);
    });

    test('短いが明確なルール指示 → 抽出される', () => {
      const result = extractLearnableContent('敬語禁止', '');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('filterRelevantMemories', () => {
  describe('基本ケース', () => {
    test('空配列 → 空配列', () => {
      const result = filterRelevantMemories([], 'test message');
      expect(result).toEqual([]);
    });

    test('maxItems以下の場合 → そのまま返す', () => {
      const memories = [
        createMemory({ content: 'メモリ1' }),
        createMemory({ content: 'メモリ2' }),
      ];
      const result = filterRelevantMemories(memories, 'test', 10);
      expect(result).toHaveLength(2);
    });
  });

  describe('active=0のフィルタリング', () => {
    test('filterRelevantMemoriesはactive状態を見ない（DBレイヤーで処理済み前提）', () => {
      // 注意: filterRelevantMemoriesはactiveフィールドをチェックしない
      // active=0のフィルタリングはDB側(getLearnedMemories)で行われる
      const memories = [
        createMemory({ content: 'アクティブ', active: 1 }),
        createMemory({ content: '非アクティブ', active: 0 }),
      ];
      const result = filterRelevantMemories(memories, 'test', 10);
      // 両方返される（activeフィルタはDB層の責務）
      expect(result).toHaveLength(2);
    });
  });

  describe('関連度によるフィルタリング', () => {
    test('ruleカテゴリは常に含まれる', () => {
      const memories = [
        createMemory({ category: 'rule', content: 'ルール内容', confidence: 0.5 }),
        createMemory({ category: 'preference', content: '好み内容', confidence: 0.9 }),
        createMemory({ category: 'fact', content: '事実内容', confidence: 0.9 }),
      ];
      // maxItems=2でもruleは必ず含まれる
      const result = filterRelevantMemories(memories, 'unrelated', 2);
      expect(result.find(m => m.category === 'rule')).toBeDefined();
    });

    test('キーワードが一致するメモリが優先される', () => {
      const memories: LearnedMemory[] = [];
      // 16件作成してmaxItemsを超えさせる
      for (let i = 0; i < 16; i++) {
        memories.push(
          createMemory({
            category: 'preference',
            content: `通常メモリ番号${i}です`,
            confidence: 0.5,
          })
        );
      }
      // 1件だけキーワードが一致するものを追加（キーワードを複数含める）
      memories.push(
        createMemory({
          category: 'preference',
          content: 'typescript 型チェック typescript 必須',
          confidence: 0.5,
        })
      );

      const result = filterRelevantMemories(memories, 'typescript 型チェック', 10);
      // キーワード一致するメモリが含まれている
      expect(result.find(m => m.content.includes('typescript'))).toBeDefined();
    });

    test('【重要】マーク付きは高スコア', () => {
      const memories: LearnedMemory[] = [
        ...Array(15).fill(null).map((_, i) =>
          createMemory({
            category: 'preference',
            content: `通常メモリ${i}`,
            confidence: 0.9,
          })
        ),
        createMemory({
          category: 'preference',
          content: '【重要】絶対に守るべきこと',
          confidence: 0.5,
        }),
      ];

      const result = filterRelevantMemories(memories, 'unrelated', 5);
      // 【重要】付きが含まれる（高スコアのため）
      const importantItem = result.find(m => m.content.includes('【重要】'));
      expect(importantItem).toBeDefined();
    });
  });

  describe('maxItems制限', () => {
    test('maxItemsを超える場合はフィルタリングされる', () => {
      const memories = Array(20)
        .fill(null)
        .map((_, i) =>
          createMemory({
            category: 'preference',
            content: `メモリ${i}`,
          })
        );

      const result = filterRelevantMemories(memories, 'test', 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('formatLearnedMemoryForPrompt', () => {
  describe('基本ケース', () => {
    test('空配列 → 空文字列', () => {
      const result = formatLearnedMemoryForPrompt([]);
      expect(result).toBe('');
    });
  });

  describe('単一カテゴリ', () => {
    test('1件のruleメモリ → ヘッダー + ルール: + 内容', () => {
      const memories = [createMemory({ category: 'rule', content: '敬語禁止' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('[DJ LEARNED PREFERENCES');
      expect(result).toContain('ルール:');
      expect(result).toContain('- 敬語禁止');
    });

    test('1件のpreferenceメモリ → ヘッダー + 好み: + 内容', () => {
      const memories = [createMemory({ category: 'preference', content: 'シンプルがいい' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('好み:');
      expect(result).toContain('- シンプルがいい');
    });

    test('1件のcorrectionメモリ → ヘッダー + 過去の修正: + 内容', () => {
      const memories = [createMemory({ category: 'correction', content: '前回の修正' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('過去の修正:');
      expect(result).toContain('- 前回の修正');
    });

    test('1件のfactメモリ → ヘッダー + DJについて: + 内容', () => {
      const memories = [createMemory({ category: 'fact', content: '俺はエンジニアだ' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('DJについて:');
      expect(result).toContain('- 俺はエンジニアだ');
    });

    test('1件のworkflowメモリ → ヘッダー + ワークフロー: + 内容', () => {
      const memories = [createMemory({ category: 'workflow', content: '毎回テストする' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('ワークフロー:');
      expect(result).toContain('- 毎回テストする');
    });
  });

  describe('複数カテゴリのグループ化', () => {
    test('複数カテゴリ → カテゴリ別にグループ化', () => {
      const memories = [
        createMemory({ category: 'rule', content: 'ルール1' }),
        createMemory({ category: 'rule', content: 'ルール2' }),
        createMemory({ category: 'preference', content: '好み1' }),
        createMemory({ category: 'fact', content: '事実1' }),
        createMemory({ category: 'workflow', content: 'ワークフロー1' }),
        createMemory({ category: 'correction', content: '修正1' }),
      ];
      const result = formatLearnedMemoryForPrompt(memories);

      // 全カテゴリが含まれる
      expect(result).toContain('ルール:');
      expect(result).toContain('好み:');
      expect(result).toContain('過去の修正:');
      expect(result).toContain('DJについて:');
      expect(result).toContain('ワークフロー:');

      // 各アイテムが含まれる
      expect(result).toContain('- ルール1');
      expect(result).toContain('- ルール2');
      expect(result).toContain('- 好み1');
      expect(result).toContain('- 事実1');
      expect(result).toContain('- ワークフロー1');
      expect(result).toContain('- 修正1');
    });

    test('同じカテゴリの複数アイテム → 順番に列挙', () => {
      const memories = [
        createMemory({ category: 'rule', content: '第一のルール' }),
        createMemory({ category: 'rule', content: '第二のルール' }),
        createMemory({ category: 'rule', content: '第三のルール' }),
      ];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('- 第一のルール');
      expect(result).toContain('- 第二のルール');
      expect(result).toContain('- 第三のルール');

      // ルール:は1回だけ出現
      const ruleHeaderCount = (result.match(/ルール:/g) || []).length;
      expect(ruleHeaderCount).toBe(1);
    });
  });

  describe('フォーマット検証', () => {
    test('ヘッダーに「絶対に守れ」が含まれる', () => {
      const memories = [createMemory({ category: 'rule', content: 'test' })];
      const result = formatLearnedMemoryForPrompt(memories);

      expect(result).toContain('絶対に守れ');
    });

    test('各アイテムは「- 」で始まる', () => {
      const memories = [
        createMemory({ category: 'rule', content: 'content1' }),
        createMemory({ category: 'preference', content: 'content2' }),
      ];
      const result = formatLearnedMemoryForPrompt(memories);

      const lines = result.split('\n');
      const itemLines = lines.filter(line => line.startsWith('- '));
      expect(itemLines.length).toBe(2);
    });
  });
});
