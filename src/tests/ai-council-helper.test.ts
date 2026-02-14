// @ts-nocheck
/**
 * Unit tests for ai-council-helper module
 */

import { mock, describe, test, expect, beforeEach } from 'bun:test';

// Mock ai-router at the TOP before importing module under test
let mockGetMemoryPack = mock(() =>
  Promise.resolve({ aiMemory: 'test', memoryGateway: 'test' })
);
let mockCallAICouncil = mock(() =>
  Promise.resolve({
    advisorResponses: 'Advisor responses here',
    fullResponses: [
      { provider: 'gemini', content: 'Gemini says do X first' },
      { provider: 'croppy', content: 'Croppy agrees with approach' },
      { provider: 'gpt', content: 'GPT suggests Y alternative' },
    ],
  })
);

mock.module('../handlers/ai-router', () => ({
  callAICouncil: (...args: any[]) => mockCallAICouncil(...args),
  getMemoryPack: (...args: any[]) => mockGetMemoryPack(...args),
}));

import { consultAICouncil, askCouncil } from '../utils/ai-council-helper';

describe('ai-council-helper', () => {
  beforeEach(() => {
    mockGetMemoryPack.mockClear();
    mockCallAICouncil.mockClear();
  });

  describe('consultAICouncil', () => {
    test('returns advisorResponses and summary', async () => {
      const mockBot = { sendMessage: mock(() => Promise.resolve()) } as any;
      const result = await consultAICouncil(mockBot, 12345, 'Test question', {
        sendToUser: false,
      });

      expect(result.advisorResponses).toBe('Advisor responses here');
      expect(result.summary).toContain('ジェミー💎');
      expect(result.summary).toContain('クロッピー🦞');
      expect(result.summary).toContain('チャッピー🧠');
    });

    test('calls getMemoryPack with env variables', async () => {
      const originalCredPath = process.env.GOOGLE_DOCS_CREDENTIALS_PATH;
      const originalDocId = process.env.AI_MEMORY_DOC_ID;

      process.env.GOOGLE_DOCS_CREDENTIALS_PATH = '/test/creds.json';
      process.env.AI_MEMORY_DOC_ID = 'test-doc-id';

      try {
        await consultAICouncil(null, 12345, 'Test question', {
          sendToUser: false,
        });

        expect(mockGetMemoryPack).toHaveBeenCalledWith(
          '/test/creds.json',
          'test-doc-id'
        );
      } finally {
        process.env.GOOGLE_DOCS_CREDENTIALS_PATH = originalCredPath;
        process.env.AI_MEMORY_DOC_ID = originalDocId;
      }
    });

    test('sends messages to user when sendToUser=true and bot provided', async () => {
      const mockBot = { sendMessage: mock(() => Promise.resolve()) } as any;

      await consultAICouncil(mockBot, 12345, 'Test question', {
        sendToUser: true,
      });

      expect(mockBot.sendMessage).toHaveBeenCalledTimes(2);
      // First call: notification
      expect(mockBot.sendMessage.mock.calls[0][0]).toBe(12345);
      expect(mockBot.sendMessage.mock.calls[0][1]).toContain(
        'AI Councilに相談中...'
      );
      // Second call: advisor responses
      expect(mockBot.sendMessage.mock.calls[1][0]).toBe(12345);
      expect(mockBot.sendMessage.mock.calls[1][1]).toBe('Advisor responses here');
    });

    test('skips sending when sendToUser=false', async () => {
      const mockBot = { sendMessage: mock(() => Promise.resolve()) } as any;

      await consultAICouncil(mockBot, 12345, 'Test question', {
        sendToUser: false,
      });

      expect(mockBot.sendMessage).not.toHaveBeenCalled();
    });

    test('skips sending when bot is null', async () => {
      // Should not throw even when bot is null
      const result = await consultAICouncil(null, 12345, 'Test question', {
        sendToUser: true,
      });

      expect(result.advisorResponses).toBe('Advisor responses here');
    });

    test('summary truncates long responses at 100 chars', async () => {
      const longContent = 'A'.repeat(150);
      mockCallAICouncil.mockImplementationOnce(() =>
        Promise.resolve({
          advisorResponses: 'Advisor responses',
          fullResponses: [{ provider: 'gemini', content: longContent }],
        })
      );

      const result = await consultAICouncil(null, 12345, 'Test question', {
        sendToUser: false,
      });

      // Should be truncated to 100 chars + "..."
      expect(result.summary).toContain('A'.repeat(100) + '...');
      expect(result.summary).not.toContain('A'.repeat(101));
    });

    test('summary uses correct provider names', async () => {
      const result = await consultAICouncil(null, 12345, 'Test question', {
        sendToUser: false,
      });

      expect(result.summary).toContain('ジェミー💎');
      expect(result.summary).toContain('クロッピー🦞');
      expect(result.summary).toContain('チャッピー🧠');
    });

    test('handles errors (throws)', async () => {
      mockCallAICouncil.mockImplementationOnce(() =>
        Promise.reject(new Error('Council error'))
      );

      await expect(
        consultAICouncil(null, 12345, 'Test question', { sendToUser: false })
      ).rejects.toThrow('Council error');
    });

    test('summary handles all-error responses', async () => {
      mockCallAICouncil.mockImplementationOnce(() =>
        Promise.resolve({
          advisorResponses: 'All errors',
          fullResponses: [
            { provider: 'gemini', content: '', error: 'Error 1' },
            { provider: 'croppy', content: '', error: 'Error 2' },
            { provider: 'gpt', content: '', error: 'Error 3' },
          ],
        })
      );

      const result = await consultAICouncil(null, 12345, 'Test question', {
        sendToUser: false,
      });

      expect(result.summary).toBe(
        'AI Councilから有効な応答が得られませんでした。'
      );
    });
  });

  describe('askCouncil', () => {
    test('returns summary string', async () => {
      const result = await askCouncil('Test question', 12345);

      expect(typeof result).toBe('string');
      expect(result).toContain('ジェミー💎');
      expect(mockCallAICouncil).toHaveBeenCalled();
    });

    test('works without chatId', async () => {
      const result = await askCouncil('Test question');

      expect(typeof result).toBe('string');
      expect(result).toContain('ジェミー💎');
    });
  });
});
