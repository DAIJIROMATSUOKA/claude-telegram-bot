/**
 * Unit tests for ContextManager class
 * Tests Memory Gateway integration with mocked fetch
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ContextManager } from '../autopilot/context-manager';
import type { MemoryAppendRequest, MemoryQueryParams } from '../autopilot/types';

describe('ContextManager', () => {
  let contextManager: ContextManager;
  let mockFetch: any;
  const testGatewayUrl = 'http://localhost:3000';

  beforeEach(() => {
    // Reset mock fetch before each test
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, events: [], items: [], snapshot: '' }),
      })
    );
    globalThis.fetch = mockFetch;
    contextManager = new ContextManager(testGatewayUrl);
  });

  describe('Constructor', () => {
    it('sets memoryGatewayUrl correctly', () => {
      const manager = new ContextManager('http://test-gateway:8080');
      // Verify by calling a method that uses the URL
      manager.getSnapshot({});
      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl.startsWith('http://test-gateway:8080')).toBe(true);
    });
  });

  describe('getContext', () => {
    it('returns AutopilotContext with required fields', async () => {
      // Mock responses for snapshot and query calls
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              snapshot: '# Memory Snapshot\n- Item 1',
              items: [],
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext();

      expect(context).toHaveProperty('snapshot');
      expect(context).toHaveProperty('task_history');
      expect(Array.isArray(context.task_history)).toBe(true);
    });

    it('includes pinned memories when includePinned is true', async () => {
      const pinnedItems = [
        { id: 'pinned-1', title: 'Important Note', content: 'Remember this', pinned: true },
      ];

      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              snapshot: '',
              items: pinnedItems,
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext({ includePinned: true });

      expect(context.query_results).toBeDefined();
    });

    it('includes query results when includeQuery is true with queryParams', async () => {
      const queryItems = [{ id: 'query-1', title: 'Query Result', content: 'Found data' }];

      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              snapshot: '',
              items: queryItems,
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext({
        tokenBudget: 0, // Use legacy behavior
        includeQuery: true,
        queryParams: { scope: 'test/scope', q: 'search term' },
      });

      // Should have called fetch multiple times (snapshot + task history + query)
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('builds context from multiple data sources', async () => {
      let callCount = 0;
      mockFetch = mock(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => {
            // Different responses based on URL
            if (callCount === 1) {
              return Promise.resolve({
                snapshot: '# Snapshot Data',
                items: [],
              });
            }
            return Promise.resolve({
              items: [{ id: `item-${callCount}`, title: `Item ${callCount}` }],
            });
          },
        });
      });
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext({
        includePinned: true,
        queryKeywords: ['test', 'keyword'],
      });

      // Should have made multiple fetch calls
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
      expect(context.snapshot).toBeDefined();
    });
  });

  describe('getSnapshot', () => {
    it('calls fetch with correct URL params', async () => {
      await contextManager.getSnapshot({
        scope: 'shared/global',
        max_items: 100,
      });

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`${testGatewayUrl}/v1/memory/snapshot`);
      expect(calledUrl).toContain('format=prompt');
      expect(calledUrl).toContain('scope=shared%2Fglobal');
      expect(calledUrl).toContain('max_items=100');
    });

    it('includes scope_prefix when provided', async () => {
      await contextManager.getSnapshot({
        scope_prefix: 'shared/',
        max_items: 50,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('scope_prefix=shared%2F');
    });

    it('returns snapshot string from response', async () => {
      const expectedSnapshot = '# Memory Snapshot\n- Important item\n- Another item';
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ snapshot: expectedSnapshot }),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.getSnapshot({ scope: 'test' });

      expect(result).toBe(expectedSnapshot);
    });

    it('returns empty string when snapshot is undefined', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.getSnapshot({});

      expect(result).toBe('');
    });
  });

  describe('query', () => {
    it('calls fetch with correct query params', async () => {
      const queryParams: MemoryQueryParams = {
        scope: 'test/scope',
        type: 'note',
        pinned: true,
        since: '2024-01-01T00:00:00Z',
        until: '2024-12-31T23:59:59Z',
        q: 'search term',
        limit: 25,
        cursor: 'next-page-cursor',
      };

      await contextManager.query(queryParams);

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`${testGatewayUrl}/v1/memory/query`);
      expect(calledUrl).toContain('scope=test%2Fscope');
      expect(calledUrl).toContain('type=note');
      expect(calledUrl).toContain('pinned=true');
      expect(calledUrl).toContain('since=2024-01-01T00%3A00%3A00Z');
      expect(calledUrl).toContain('until=2024-12-31T23%3A59%3A59Z');
      expect(calledUrl).toContain('q=search+term');
      expect(calledUrl).toContain('limit=25');
      expect(calledUrl).toContain('cursor=next-page-cursor');
    });

    it('handles multiple scopes and tags', async () => {
      const queryParams: MemoryQueryParams = {
        scopes: ['scope1', 'scope2'],
        tags: ['tag1', 'tag2', 'tag3'],
      };

      await contextManager.query(queryParams);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('scopes=scope1');
      expect(calledUrl).toContain('scopes=scope2');
      expect(calledUrl).toContain('tags=tag1');
      expect(calledUrl).toContain('tags=tag2');
      expect(calledUrl).toContain('tags=tag3');
    });

    it('returns items array from response', async () => {
      const expectedItems = [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
      ];
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: expectedItems }),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.query({ scope: 'test' });

      expect(result).toEqual(expectedItems);
    });

    it('returns empty array when items is undefined', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.query({});

      expect(result).toEqual([]);
    });
  });

  describe('appendMemory', () => {
    it('calls fetch POST with correct body', async () => {
      const appendRequest: MemoryAppendRequest = {
        scope: 'test/scope',
        type: 'note',
        title: 'Test Memory',
        content: 'This is test content',
        tags: ['test', 'unit-test'],
        importance: 0.8,
        pin: true,
        source_agent: 'jarvis',
        dedupe_key: 'unique-key-123',
      };

      await contextManager.appendMemory(appendRequest);

      expect(mockFetch).toHaveBeenCalled();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${testGatewayUrl}/v1/memory/append`);
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.scope).toBe('test/scope');
      expect(body.type).toBe('note');
      expect(body.title).toBe('Test Memory');
      expect(body.content).toBe('This is test content');
      expect(body.tags).toEqual(['test', 'unit-test']);
      expect(body.importance).toBe(0.8);
      expect(body.pin).toBe(true);
      expect(body.source_agent).toBe('jarvis');
      expect(body.dedupe_key).toBe('unique-key-123');
    });

    it('succeeds with minimal request', async () => {
      const appendRequest: MemoryAppendRequest = {
        scope: 'minimal/scope',
        content: 'Minimal content',
      };

      await expect(contextManager.appendMemory(appendRequest)).resolves.toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('returns empty string when fetch rejects in getSnapshot', async () => {
      mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch;

      const result = await contextManager.getSnapshot({ scope: 'test' });

      expect(result).toBe('');
    });

    it('returns empty array when fetch rejects in query', async () => {
      mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch;

      const result = await contextManager.query({ scope: 'test' });

      expect(result).toEqual([]);
    });

    it('throws error when fetch rejects in appendMemory', async () => {
      mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch;

      await expect(
        contextManager.appendMemory({ scope: 'test', content: 'test' })
      ).rejects.toThrow('Network error');
    });

    it('returns empty string when response is not ok in getSnapshot', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.getSnapshot({ scope: 'test' });

      expect(result).toBe('');
    });

    it('returns empty array when response is not ok in query', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.query({ scope: 'test' });

      expect(result).toEqual([]);
    });

    it('throws error when response is not ok in appendMemory', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: () => Promise.resolve({ error: { message: 'Invalid scope format' } }),
        })
      );
      globalThis.fetch = mockFetch;

      await expect(
        contextManager.appendMemory({ scope: 'invalid', content: 'test' })
      ).rejects.toThrow('Append request failed: 400 Invalid scope format');
    });

    it('handles non-ok response without error message in appendMemory', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({}),
        })
      );
      globalThis.fetch = mockFetch;

      await expect(
        contextManager.appendMemory({ scope: 'test', content: 'test' })
      ).rejects.toThrow('Append request failed: 500 Internal Server Error');
    });
  });

  describe('getPinnedMemories', () => {
    it('queries with pinned=true parameter', async () => {
      await contextManager.getPinnedMemories('shared');

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('pinned=true');
      expect(calledUrl).toContain('scope_prefix=shared');
      expect(calledUrl).toContain('limit=20');
    });

    it('returns pinned items from response', async () => {
      const pinnedItems = [
        { id: 'pin-1', title: 'Pinned 1', pinned: true },
        { id: 'pin-2', title: 'Pinned 2', pinned: true },
      ];
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: pinnedItems }),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.getPinnedMemories();

      expect(result).toEqual(pinnedItems);
    });
  });

  describe('queryByKeywords', () => {
    it('joins keywords with space for query', async () => {
      await contextManager.queryByKeywords(['keyword1', 'keyword2', 'keyword3'], 'shared');

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('q=keyword1+keyword2+keyword3');
      expect(calledUrl).toContain('scope_prefix=shared');
      expect(calledUrl).toContain('limit=10');
    });

    it('returns empty array for empty keywords', async () => {
      const result = await contextManager.queryByKeywords([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('wasRecentlyExecuted', () => {
    it('returns true when matching execution found', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [{ id: 'exec-1', type: 'execution_log', title: 'Test execution' }],
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.wasRecentlyExecuted('maintenance', 'daily backup');

      expect(result).toBe(true);
    });

    it('returns false when no matching execution found', async () => {
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
      );
      globalThis.fetch = mockFetch;

      const result = await contextManager.wasRecentlyExecuted('maintenance', 'never executed');

      expect(result).toBe(false);
    });

    it('queries with correct parameters including since date', async () => {
      await contextManager.wasRecentlyExecuted('predictive', 'some task');

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('scope=shared%2Fautopilot_log');
      expect(calledUrl).toContain('type=execution_log');
      expect(calledUrl).toContain('since=');
      expect(calledUrl).toContain('q=predictive+some+task');
      expect(calledUrl).toContain('limit=1');
    });

    it('returns false when fetch fails', async () => {
      mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch;

      const result = await contextManager.wasRecentlyExecuted('maintenance', 'test');

      expect(result).toBe(false);
    });
  });

  describe('Token budget management', () => {
    it('respects token budget when assembling context', async () => {
      // Mock with large responses
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              snapshot: 'A'.repeat(1000), // ~250 tokens
              items: [{ id: '1', title: 'Item', content: 'Content' }],
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext({
        tokenBudget: 500,
        includePinned: true,
      });

      // Should still return a valid context
      expect(context).toHaveProperty('snapshot');
      expect(context).toHaveProperty('task_history');
    });

    it('truncates snapshot when exceeding budget', async () => {
      // Large snapshot that exceeds budget
      const largeSnapshot = 'X'.repeat(20000); // ~5000 tokens
      mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              snapshot: largeSnapshot,
              items: [],
            }),
        })
      );
      globalThis.fetch = mockFetch;

      const context = await contextManager.getContext({
        tokenBudget: 100, // Very small budget
        includePinned: false,
      });

      // Snapshot should be truncated
      expect(context.snapshot.length).toBeLessThan(largeSnapshot.length);
      expect(context.snapshot).toContain('[... truncated due to token budget ...]');
    });
  });
});
