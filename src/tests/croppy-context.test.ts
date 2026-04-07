// @ts-nocheck
/**
 * Unit tests for croppy-context.ts
 */

import { mock, spyOn, describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as aiRouterModule from '../handlers/ai-router';

// Mock functions - declare before mock.module
let mockGetJarvisContext = mock(() =>
  Promise.resolve({ currentTasks: ['task1'], recentActions: ['action1'], systemStatus: 'ok' })
);
let mockFormatContextForPrompt = mock((_ctx: unknown) => 'Formatted jarvis context');
let mockGetChatHistory = mock(() =>
  Promise.resolve([{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00Z' }])
);
let mockFormatChatHistoryForPrompt = mock((_h: unknown) => '1. [DJ] hello');
let mockGetMemoryPack = mock(() =>
  Promise.resolve('AI memory content')
);

// Mock modules BEFORE importing module under test
// Use paths relative to the module under test (croppy-context.ts)
mock.module('../utils/jarvis-context', () => ({
  getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
  formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
}));
mock.module('../utils/chat-history', () => ({
  getChatHistory: (...args: unknown[]) => mockGetChatHistory(...args),
  formatChatHistoryForPrompt: (...args: unknown[]) => mockFormatChatHistoryForPrompt(...args),
}));
const getMemoryPackSpy = spyOn(aiRouterModule, 'getMemoryPack').mockImplementation(
  (...args: unknown[]) => mockGetMemoryPack(...args)
);

// Import module under test AFTER mocking
import {
  getCroppyContext,
  buildCroppyPrompt,
  formatCroppyDebugOutput,
} from '../utils/croppy-context';

describe('croppy-context', () => {
  beforeEach(() => {
    // Reset all mocks
    mockGetJarvisContext = mock(() =>
      Promise.resolve({ currentTasks: ['task1'], recentActions: ['action1'], systemStatus: 'ok' })
    );
    mockFormatContextForPrompt = mock((_ctx: unknown) => 'Formatted jarvis context');
    mockGetChatHistory = mock(() =>
      Promise.resolve([{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00Z' }])
    );
    mockFormatChatHistoryForPrompt = mock((_h: unknown) => '1. [DJ] hello');
    mockGetMemoryPack = mock(() =>
      Promise.resolve('AI memory content')
    );

    // Re-register mocks after reset
    mock.module('../utils/jarvis-context', () => ({
      getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
      formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
    }));
    mock.module('../utils/chat-history', () => ({
      getChatHistory: (...args: unknown[]) => mockGetChatHistory(...args),
      formatChatHistoryForPrompt: (...args: unknown[]) => mockFormatChatHistoryForPrompt(...args),
    }));
  });

  describe('getCroppyContext', () => {
    test('returns object with context, history, aiMemory', async () => {
      const result = await getCroppyContext('user123');

      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('history');
      expect(result).toHaveProperty('aiMemory');
      expect(typeof result.context).toBe('string');
      expect(typeof result.history).toBe('string');
      expect(typeof result.aiMemory).toBe('string');
    });

    test('calls all 3 data sources', async () => {
      await getCroppyContext('user123');

      expect(mockGetJarvisContext).toHaveBeenCalled();
      expect(mockGetChatHistory).toHaveBeenCalled();
      expect(mockGetMemoryPack).toHaveBeenCalled();
    });

    test('handles errors in individual sources gracefully', async () => {
      // Make getJarvisContext throw an error
      mockGetJarvisContext = mock(() => Promise.reject(new Error('Jarvis context error')));
      mock.module('../utils/jarvis-context', () => ({
        getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
        formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
      }));

      const result = await getCroppyContext('user123');

      // Should return degraded mode result with error info
      expect(result).toHaveProperty('error');
      expect(result.context).toBe('（取得失敗）');
      expect(result.history).toBe('（取得失敗）');
      expect(result.aiMemory).toBe('（取得失敗）');
    });
  });

  describe('buildCroppyPrompt', () => {
    test('returns string combining user message with context', async () => {
      const result = await buildCroppyPrompt('test question', 'user123');

      expect(typeof result).toBe('string');
      expect(result).toContain('test question');
    });

    test('includes chat history section', async () => {
      const result = await buildCroppyPrompt('test question', 'user123');

      expect(result).toContain('=== 💬 直近の会話（10件） ===');
      expect(result).toContain('1. [DJ] hello');
    });

    test('includes jarvis context section', async () => {
      const result = await buildCroppyPrompt('test question', 'user123');

      expect(result).toContain('=== 📋 現在の状態 ===');
      expect(result).toContain('Formatted jarvis context');
    });

    test('includes user question section', async () => {
      const result = await buildCroppyPrompt('my specific question', 'user123');

      expect(result).toContain('=== ❓ DJの質問 ===');
      expect(result).toContain('my specific question');
    });

    test('includes AI_MEMORY section when available', async () => {
      const result = await buildCroppyPrompt('test', 'user123');

      expect(result).toContain('=== 🧠 AI_MEMORY ===');
    });

    test('shows warning when context has error', async () => {
      mockGetJarvisContext = mock(() => Promise.reject(new Error('Error')));
      mock.module('../utils/jarvis-context', () => ({
        getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
        formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
      }));

      const result = await buildCroppyPrompt('test', 'user123');

      expect(result).toContain('⚠️ 注意:');
    });
  });

  describe('formatCroppyDebugOutput', () => {
    test('returns formatted debug string', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(typeof result).toBe('string');
      expect(result).toContain('📊 <b>croppy文脈デバッグ</b>');
    });

    test('shows data source status', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('<b>[status]</b>');
      expect(result).toContain('- context:');
      expect(result).toContain('- history:');
      expect(result).toContain('- ai_memory:');
    });

    test('includes jarvis_context section', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('<b>[jarvis_context]</b>');
      expect(result).toContain('<pre>');
    });

    test('includes chat_history section', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('<b>[chat_history] 直近10件</b>');
    });

    test('includes AI_MEMORY section', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('<b>[AI_MEMORY]</b>');
    });

    test('shows OK status when sources succeed', async () => {
      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('context: OK');
      expect(result).toContain('history: OK');
      expect(result).toContain('ai_memory: OK');
    });

    test('shows ERROR status when sources fail', async () => {
      mockGetJarvisContext = mock(() => Promise.reject(new Error('Error')));
      mock.module('../utils/jarvis-context', () => ({
        getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
        formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
      }));

      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('context: ERROR');
      expect(result).toContain('history: ERROR');
      expect(result).toContain('ai_memory: ERROR');
    });

    test('escapes HTML characters', async () => {
      mockFormatContextForPrompt = mock(() => '<script>alert("xss")</script>');
      mock.module('../utils/jarvis-context', () => ({
        getJarvisContext: (...args: unknown[]) => mockGetJarvisContext(...args),
        formatContextForPrompt: (...args: unknown[]) => mockFormatContextForPrompt(...args),
      }));

      const result = await formatCroppyDebugOutput('user123');

      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });
});

afterAll(() => {
  getMemoryPackSpy.mockRestore();
});
