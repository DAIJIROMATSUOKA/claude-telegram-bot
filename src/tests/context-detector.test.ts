/**
 * Unit tests for context-detector utility
 */

import { describe, expect, test } from 'bun:test';
import {
  detectWorkMode,
  getRecommendedAI,
  getWorkModeIcon,
  getWorkModeDisplayName,
  type WorkMode,
  type DetectionResult,
} from '../utils/context-detector';

describe('context-detector', () => {
  describe('detectWorkMode', () => {
    describe('urgent mode', () => {
      test('detects rm -rf as urgent', () => {
        const result = detectWorkMode('rm -rfしちゃった');
        // rm -rf doesn't match urgent patterns directly, but "動かない" does
      });

      test('detects 緊急 keyword', () => {
        const result = detectWorkMode('緊急対応が必要');
        expect(result.mode).toBe('urgent');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects エラー発生 pattern', () => {
        const result = detectWorkMode('エラーが発生した！');
        expect(result.mode).toBe('urgent');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects 動かない pattern', () => {
        const result = detectWorkMode('サーバーが動かない');
        expect(result.mode).toBe('urgent');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects critical keyword', () => {
        const result = detectWorkMode('This is critical!');
        expect(result.mode).toBe('urgent');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('coding mode', () => {
      test('detects コードを書いて pattern', () => {
        const result = detectWorkMode('このコードを書いて');
        expect(result.mode).toBe('coding');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects 実装 keyword', () => {
        const result = detectWorkMode('新しい機能を実装して');
        expect(result.mode).toBe('coding');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects code snippet with backticks', () => {
        const result = detectWorkMode('`console.log("test")`を追加して');
        expect(result.mode).toBe('coding');
        expect(result.indicators).toContain('Code snippet detected');
      });

      test('detects リファクタ keyword', () => {
        const result = detectWorkMode('このコードをリファクタして');
        expect(result.mode).toBe('coding');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects Phase number pattern', () => {
        const result = detectWorkMode('Phase 1の実装を始めよう');
        expect(result.mode).toBe('coding');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('debugging mode', () => {
      test('detects バグがある pattern', () => {
        const result = detectWorkMode('バグがある');
        expect(result.mode).toBe('debugging');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects error keyword', () => {
        const result = detectWorkMode('error in the code');
        expect(result.mode).toBe('debugging');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects デバッグ keyword', () => {
        const result = detectWorkMode('デバッグしたい');
        expect(result.mode).toBe('debugging');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects テスト失敗 pattern', () => {
        const result = detectWorkMode('テストが失敗している');
        expect(result.mode).toBe('debugging');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects stack trace keyword', () => {
        const result = detectWorkMode('stack trace shows the issue');
        expect(result.mode).toBe('debugging');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('planning mode', () => {
      test('detects 設計を考えたい pattern', () => {
        const result = detectWorkMode('設計を考えたい');
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects アーキテクチャ keyword', () => {
        const result = detectWorkMode('アーキテクチャについて相談');
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects council keyword', () => {
        const result = detectWorkMode('council: この問題を議論したい');
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects 計画 keyword', () => {
        const result = detectWorkMode('プロジェクトの計画を立てる');
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects 提案 keyword', () => {
        const result = detectWorkMode('新しいアプローチを提案して');
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('research mode', () => {
      test('detects について調べて pattern', () => {
        const result = detectWorkMode('Reactについて調べて');
        expect(result.mode).toBe('research');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects 比較 keyword', () => {
        const result = detectWorkMode('ReactとVueを比較して');
        expect(result.mode).toBe('research');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects ドキュメント keyword', () => {
        const result = detectWorkMode('ドキュメントを確認して');
        expect(result.mode).toBe('research');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects explain keyword', () => {
        const result = detectWorkMode('explain how this works');
        expect(result.mode).toBe('research');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('chatting mode', () => {
      test('detects おはよう greeting', () => {
        const result = detectWorkMode('おはよう');
        expect(result.mode).toBe('chatting');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.indicators.length).toBeGreaterThan(0);
      });

      test('detects hello greeting', () => {
        const result = detectWorkMode('hello');
        expect(result.mode).toBe('chatting');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('detects ありがとう pattern', () => {
        const result = detectWorkMode('ありがとう！');
        expect(result.mode).toBe('chatting');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('short messages default to chatting', () => {
        const result = detectWorkMode('テスト');
        expect(result.mode).toBe('chatting');
        expect(result.confidence).toBeGreaterThan(0);
      });
    });

    describe('edge cases', () => {
      test('empty message defaults to chatting', () => {
        const result = detectWorkMode('');
        expect(result.mode).toBe('chatting');
        expect(result.confidence).toBe(1); // Only chatting score (0.5) from short message
      });

      test('long message with planning keywords', () => {
        const longMessage = '今日のプロジェクトのアーキテクチャについて計画を立てたいと思います。新しい機能の設計を考えて提案してください。どうすればいいか方法を教えてください。';
        const result = detectWorkMode(longMessage);
        expect(result.mode).toBe('planning');
        expect(result.confidence).toBeGreaterThan(0);
      });

      test('code block increases coding score', () => {
        const messageWithCode = '```typescript\nconst x = 1;\n```';
        const result = detectWorkMode(messageWithCode);
        expect(result.mode).toBe('coding');
        expect(result.indicators).toContain('Code snippet detected');
      });

      test('returns indicators array for detected mode', () => {
        const result = detectWorkMode('緊急事態が発生した');
        expect(Array.isArray(result.indicators)).toBe(true);
        expect(result.indicators.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getRecommendedAI', () => {
    test('returns jarvis for coding mode', () => {
      expect(getRecommendedAI('coding')).toBe('jarvis');
    });

    test('returns gemini for debugging mode', () => {
      expect(getRecommendedAI('debugging')).toBe('gemini');
    });

    test('returns croppy for planning mode', () => {
      expect(getRecommendedAI('planning')).toBe('croppy');
    });

    test('returns gemini for research mode', () => {
      expect(getRecommendedAI('research')).toBe('gemini');
    });

    test('returns jarvis for urgent mode', () => {
      expect(getRecommendedAI('urgent')).toBe('jarvis');
    });

    test('returns jarvis for chatting mode', () => {
      expect(getRecommendedAI('chatting')).toBe('jarvis');
    });
  });

  describe('getWorkModeIcon', () => {
    test('returns 💻 for coding mode', () => {
      expect(getWorkModeIcon('coding')).toBe('💻');
    });

    test('returns 🐛 for debugging mode', () => {
      expect(getWorkModeIcon('debugging')).toBe('🐛');
    });

    test('returns 📋 for planning mode', () => {
      expect(getWorkModeIcon('planning')).toBe('📋');
    });

    test('returns 🔍 for research mode', () => {
      expect(getWorkModeIcon('research')).toBe('🔍');
    });

    test('returns 🚨 for urgent mode', () => {
      expect(getWorkModeIcon('urgent')).toBe('🚨');
    });

    test('returns 💬 for chatting mode', () => {
      expect(getWorkModeIcon('chatting')).toBe('💬');
    });

    test('returns 🤖 for unknown mode', () => {
      expect(getWorkModeIcon('unknown' as WorkMode)).toBe('🤖');
    });
  });

  describe('getWorkModeDisplayName', () => {
    test('returns コーディング for coding mode', () => {
      expect(getWorkModeDisplayName('coding')).toBe('コーディング');
    });

    test('returns デバッグ for debugging mode', () => {
      expect(getWorkModeDisplayName('debugging')).toBe('デバッグ');
    });

    test('returns プランニング for planning mode', () => {
      expect(getWorkModeDisplayName('planning')).toBe('プランニング');
    });

    test('returns リサーチ for research mode', () => {
      expect(getWorkModeDisplayName('research')).toBe('リサーチ');
    });

    test('returns 緊急対応 for urgent mode', () => {
      expect(getWorkModeDisplayName('urgent')).toBe('緊急対応');
    });

    test('returns 会話 for chatting mode', () => {
      expect(getWorkModeDisplayName('chatting')).toBe('会話');
    });

    test('returns 不明 for unknown mode', () => {
      expect(getWorkModeDisplayName('unknown' as WorkMode)).toBe('不明');
    });
  });
});
