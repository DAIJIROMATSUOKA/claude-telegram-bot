/**
 * Chat History Manager Unit Tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Mock BEFORE importing the module under test
let mockGatewayFn = mock(() => Promise.resolve({ data: { results: [] } }));
mock.module('../handlers/ai-router', () => ({
  callMemoryGateway: (...args: unknown[]) => mockGatewayFn(...args),
}));
mock.module('ulidx', () => ({
  ulid: () => 'TEST-ULID-001',
}));

// NOW import the module under test
import {
  saveChatMessage,
  getChatHistory,
  cleanupOldHistory,
  formatChatHistoryForPrompt,
} from '../utils/chat-history';

describe('chat-history', () => {
  beforeEach(() => {
    // Reset mock between tests
    mockGatewayFn = mock(() => Promise.resolve({ data: { results: [] } }));
  });

  describe('saveChatMessage', () => {
    test('calls callMemoryGateway with INSERT SQL and correct params', async () => {
      mockGatewayFn = mock(() => Promise.resolve({ data: {} }));

      await saveChatMessage('12345', 'user', 'Hello world');

      expect(mockGatewayFn).toHaveBeenCalledTimes(1);
      const [endpoint, method, body] = mockGatewayFn.mock.calls[0];
      expect(endpoint).toBe('/v1/db/query');
      expect(method).toBe('POST');
      expect(body.sql).toContain('INSERT INTO jarvis_chat_history');
      expect(body.params[0]).toBe('TEST-ULID-001'); // id from mocked ulid
      expect(body.params[1]).toBe('12345'); // user_id
      // params[2] is timestamp (dynamic)
      expect(body.params[3]).toBe('user'); // role
      expect(body.params[4]).toBe('Hello world'); // content
    });

    test('handles gateway errors gracefully (no throw)', async () => {
      mockGatewayFn = mock(() => Promise.reject(new Error('Gateway error')));

      // Should not throw
      await expect(saveChatMessage('12345', 'assistant', 'Hi')).resolves.toBeUndefined();
    });

    test('converts numeric userId to string', async () => {
      mockGatewayFn = mock(() => Promise.resolve({ data: {} }));

      await saveChatMessage(67890, 'user', 'Test');

      const [, , body] = mockGatewayFn.mock.calls[0];
      expect(body.params[1]).toBe('67890');
    });
  });

  describe('getChatHistory', () => {
    test('returns results reversed (chronological order)', async () => {
      mockGatewayFn = mock(() =>
        Promise.resolve({
          data: {
            results: [
              { role: 'user', content: 'Second', timestamp: '2025-01-02T00:00:00Z' },
              { role: 'assistant', content: 'First', timestamp: '2025-01-01T00:00:00Z' },
            ],
          },
        })
      );

      const history = await getChatHistory('12345');

      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('First'); // reversed
      expect(history[1].content).toBe('Second');
    });

    test('returns empty array on error', async () => {
      mockGatewayFn = mock(() => Promise.reject(new Error('Network error')));

      const history = await getChatHistory('12345');

      expect(history).toEqual([]);
    });

    test('returns empty array when response has error', async () => {
      mockGatewayFn = mock(() =>
        Promise.resolve({
          error: 'Database error',
          data: null,
        })
      );

      const history = await getChatHistory('12345');

      expect(history).toEqual([]);
    });

    test('respects limit parameter', async () => {
      mockGatewayFn = mock(() => Promise.resolve({ data: { results: [] } }));

      await getChatHistory('12345', 25);

      const [, , body] = mockGatewayFn.mock.calls[0];
      expect(body.params[1]).toBe(25);
    });

    test('uses default limit of 50', async () => {
      mockGatewayFn = mock(() => Promise.resolve({ data: { results: [] } }));

      await getChatHistory('12345');

      const [, , body] = mockGatewayFn.mock.calls[0];
      expect(body.params[1]).toBe(50);
    });
  });

  describe('cleanupOldHistory', () => {
    test('calls DELETE SQL', async () => {
      mockGatewayFn = mock(() =>
        Promise.resolve({ data: { meta: { changes: 5 } } })
      );

      await cleanupOldHistory();

      expect(mockGatewayFn).toHaveBeenCalledTimes(1);
      const [endpoint, method, body] = mockGatewayFn.mock.calls[0];
      expect(endpoint).toBe('/v1/db/query');
      expect(method).toBe('POST');
      expect(body.sql).toContain('DELETE FROM jarvis_chat_history');
      expect(body.sql).toContain('-30 days');
    });

    test('handles errors gracefully', async () => {
      mockGatewayFn = mock(() => Promise.reject(new Error('Delete error')));

      // Should not throw
      await expect(cleanupOldHistory()).resolves.toBeUndefined();
    });

    test('handles response error gracefully', async () => {
      mockGatewayFn = mock(() =>
        Promise.resolve({ error: 'DB error', data: null })
      );

      // Should not throw
      await expect(cleanupOldHistory()).resolves.toBeUndefined();
    });
  });

  describe('formatChatHistoryForPrompt', () => {
    test('returns empty message for empty array', () => {
      const result = formatChatHistoryForPrompt([]);

      expect(result).toBe('（会話履歴なし）');
    });

    test('formats DJ/Jarvis labels correctly', () => {
      const history = [
        { role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hi there', timestamp: '2025-01-01T00:01:00Z' },
      ];

      const result = formatChatHistoryForPrompt(history);

      expect(result).toContain('[DJ] Hello');
      expect(result).toContain('[Jarvis] Hi there');
      expect(result).toContain('1. [DJ]');
      expect(result).toContain('2. [Jarvis]');
    });

    test('truncates old messages at 1000 chars', () => {
      // Create 20 messages so that early ones are "old" (not in last 15)
      const longContent = 'A'.repeat(1500);
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: 'user' as const,
        content: longContent,
        timestamp: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));

      const result = formatChatHistoryForPrompt(history);
      const lines = result.split('\n');

      // First 5 messages (indices 0-4) are "old" (not in last 15)
      // They should be truncated at 1000 chars
      const oldLine = lines[0]; // First message (old)
      expect(oldLine).toContain('...');
      // 1000 chars + "[DJ] " prefix + "1. " + "..."
      expect(oldLine.length).toBeLessThan(1020);
    });

    test('truncates recent messages at 2000 chars', () => {
      // Create history where all are "recent" (within last 15)
      const longContent = 'B'.repeat(2500);
      const history = [
        { role: 'user', content: longContent, timestamp: '2025-01-01T00:00:00Z' },
      ];

      const result = formatChatHistoryForPrompt(history);

      expect(result).toContain('...');
      // 2000 chars + "[DJ] " prefix + "1. " + "..."
      expect(result.length).toBeLessThan(2020);
    });

    test('does not truncate short messages', () => {
      const history = [
        { role: 'user', content: 'Short message', timestamp: '2025-01-01T00:00:00Z' },
      ];

      const result = formatChatHistoryForPrompt(history);

      expect(result).not.toContain('...');
      expect(result).toBe('1. [DJ] Short message');
    });
  });
});
