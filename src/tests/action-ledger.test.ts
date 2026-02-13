/**
 * ActionLedger Test Suite
 *
 * Tests in-memory behavior only (no Memory Gateway URL configured):
 * 1. Constructor with default options
 * 2. record() stores entries with dedupeKey
 * 3. isDuplicate() returns true for recorded keys, false for unknown
 * 4. recordIfNotDuplicate() returns isDuplicate=false on first call, isDuplicate=true on second
 * 5. get() retrieves stored entries
 * 6. remove() deletes entries
 * 7. clear() removes all entries
 * 8. TTL expiry - entries expire after TTL
 * 9. generateTimeWindowKey() produces consistent keys
 * 10. destroy() cleans up intervals
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ActionLedger } from '../utils/action-ledger';

// ============================================================================
// Test Suite
// ============================================================================

describe('ActionLedger', () => {
  let ledger: ActionLedger;

  beforeEach(() => {
    // Create ledger WITHOUT memoryGatewayUrl to test pure in-memory behavior
    ledger = new ActionLedger({
      defaultTTL: 60000, // 1 minute default for tests
    });
  });

  afterEach(() => {
    // Clean up to prevent interval leaks
    ledger.destroy();
  });

  // ==========================================================================
  // 1. Constructor with default options
  // ==========================================================================

  describe('Constructor', () => {
    test('should create ledger with default options', () => {
      const defaultLedger = new ActionLedger();
      expect(defaultLedger.size()).toBe(0);
      defaultLedger.destroy();
    });

    test('should create ledger with custom defaultTTL', () => {
      const customLedger = new ActionLedger({ defaultTTL: 5000 });
      expect(customLedger.size()).toBe(0);
      customLedger.destroy();
    });

    test('should create ledger with custom retryConfig', () => {
      const customLedger = new ActionLedger({
        retryConfig: {
          maxRetries: 5,
          baseDelay: 2000,
        },
      });
      expect(customLedger.size()).toBe(0);
      customLedger.destroy();
    });
  });

  // ==========================================================================
  // 2. record() stores entries with dedupeKey
  // ==========================================================================

  describe('record()', () => {
    test('should store entry and return id', async () => {
      const id = await ledger.record('test-key-1');
      expect(id).toMatch(/^ledger_/);
      expect(ledger.size()).toBe(1);
    });

    test('should store entry with metadata', async () => {
      const metadata = { taskId: 'task-123', action: 'send_notification' };
      const id = await ledger.record('test-key-2', metadata);

      expect(id).toMatch(/^ledger_/);
      const entry = await ledger.get('test-key-2');
      expect(entry).not.toBeNull();
      expect(entry?.metadata).toEqual(metadata);
    });

    test('should store entry with custom TTL', async () => {
      const id = await ledger.record('test-key-3', undefined, 30000);
      const entry = await ledger.get('test-key-3');
      expect(entry?.ttl).toBe(30000);
    });

    test('should overwrite existing entry with same key', async () => {
      await ledger.record('duplicate-key', { version: 1 });
      await ledger.record('duplicate-key', { version: 2 });

      expect(ledger.size()).toBe(1);
      const entry = await ledger.get('duplicate-key');
      expect(entry?.metadata).toEqual({ version: 2 });
    });
  });

  // ==========================================================================
  // 3. isDuplicate() returns true for recorded keys, false for unknown
  // ==========================================================================

  describe('isDuplicate()', () => {
    test('should return false for unknown key', async () => {
      const result = await ledger.isDuplicate('unknown-key');
      expect(result).toBe(false);
    });

    test('should return true for recorded key within TTL', async () => {
      await ledger.record('known-key');
      const result = await ledger.isDuplicate('known-key');
      expect(result).toBe(true);
    });

    test('should return false for expired key', async () => {
      // Create ledger with very short TTL
      const shortTTLLedger = new ActionLedger({ defaultTTL: 50 });
      await shortTTLLedger.record('expiring-key');

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 60));

      const result = await shortTTLLedger.isDuplicate('expiring-key');
      expect(result).toBe(false);
      shortTTLLedger.destroy();
    });
  });

  // ==========================================================================
  // 4. recordIfNotDuplicate() returns isDuplicate=false on first, true on second
  // ==========================================================================

  describe('recordIfNotDuplicate()', () => {
    test('should return isDuplicate=false on first call', async () => {
      const result = await ledger.recordIfNotDuplicate('new-key');
      expect(result.isDuplicate).toBe(false);
      expect(result.recorded).toBe(true);
      expect(result.id).toMatch(/^ledger_/);
    });

    test('should return isDuplicate=true on second call with same key', async () => {
      // First call
      const result1 = await ledger.recordIfNotDuplicate('same-key');
      expect(result1.isDuplicate).toBe(false);
      expect(result1.recorded).toBe(true);

      // Second call
      const result2 = await ledger.recordIfNotDuplicate('same-key');
      expect(result2.isDuplicate).toBe(true);
      expect(result2.recorded).toBe(false);
      expect(result2.reason).toBeDefined();
    });

    test('should store metadata when recording', async () => {
      const metadata = { source: 'test' };
      await ledger.recordIfNotDuplicate('meta-key', metadata);

      const entry = await ledger.get('meta-key');
      expect(entry?.metadata).toEqual(metadata);
    });

    test('should use custom TTL', async () => {
      await ledger.recordIfNotDuplicate('ttl-key', undefined, 5000);

      const entry = await ledger.get('ttl-key');
      expect(entry?.ttl).toBe(5000);
    });

    test('should allow recording after expired entry', async () => {
      const shortTTLLedger = new ActionLedger({ defaultTTL: 50 });

      // First record
      const result1 = await shortTTLLedger.recordIfNotDuplicate('expiry-test');
      expect(result1.isDuplicate).toBe(false);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should allow new record
      const result2 = await shortTTLLedger.recordIfNotDuplicate('expiry-test');
      expect(result2.isDuplicate).toBe(false);
      expect(result2.recorded).toBe(true);

      shortTTLLedger.destroy();
    });
  });

  // ==========================================================================
  // 5. get() retrieves stored entries
  // ==========================================================================

  describe('get()', () => {
    test('should return null for non-existent key', async () => {
      const entry = await ledger.get('non-existent');
      expect(entry).toBeNull();
    });

    test('should return entry for existing key', async () => {
      await ledger.record('get-test-key', { data: 'test' });

      const entry = await ledger.get('get-test-key');
      expect(entry).not.toBeNull();
      expect(entry?.dedupe_key).toBe('get-test-key');
      expect(entry?.metadata).toEqual({ data: 'test' });
      expect(entry?.id).toMatch(/^ledger_/);
      expect(entry?.executed_at).toBeDefined();
    });
  });

  // ==========================================================================
  // 6. remove() deletes entries
  // ==========================================================================

  describe('remove()', () => {
    test('should remove existing entry', async () => {
      await ledger.record('remove-test');
      expect(ledger.size()).toBe(1);

      await ledger.remove('remove-test');
      expect(ledger.size()).toBe(0);

      const entry = await ledger.get('remove-test');
      expect(entry).toBeNull();
    });

    test('should handle removing non-existent key gracefully', async () => {
      // Should not throw
      await ledger.remove('non-existent-key');
      expect(ledger.size()).toBe(0);
    });
  });

  // ==========================================================================
  // 7. clear() removes all entries
  // ==========================================================================

  describe('clear()', () => {
    test('should remove all entries', async () => {
      await ledger.record('key-1');
      await ledger.record('key-2');
      await ledger.record('key-3');
      expect(ledger.size()).toBe(3);

      await ledger.clear();
      expect(ledger.size()).toBe(0);
    });

    test('should handle clearing empty ledger', async () => {
      expect(ledger.size()).toBe(0);
      await ledger.clear();
      expect(ledger.size()).toBe(0);
    });
  });

  // ==========================================================================
  // 8. TTL expiry - entries expire after TTL
  // ==========================================================================

  describe('TTL Expiry', () => {
    test('should expire entries after TTL (short TTL)', async () => {
      const shortLedger = new ActionLedger({ defaultTTL: 100 });

      await shortLedger.record('ttl-test');
      expect(await shortLedger.isDuplicate('ttl-test')).toBe(true);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Entry should be expired now
      expect(await shortLedger.isDuplicate('ttl-test')).toBe(false);
      shortLedger.destroy();
    });

    test('should not expire entries before TTL', async () => {
      const longLedger = new ActionLedger({ defaultTTL: 10000 });

      await longLedger.record('no-expire-test');

      // Wait a short time
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should still be valid
      expect(await longLedger.isDuplicate('no-expire-test')).toBe(true);
      longLedger.destroy();
    });

    test('should use entry-specific TTL over default', async () => {
      // Default is 60000ms but we set entry-specific to 100ms
      await ledger.record('custom-ttl', undefined, 100);

      expect(await ledger.isDuplicate('custom-ttl')).toBe(true);

      // Wait for entry-specific TTL
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await ledger.isDuplicate('custom-ttl')).toBe(false);
    });
  });

  // ==========================================================================
  // 9. generateTimeWindowKey() produces consistent keys
  // ==========================================================================

  describe('generateTimeWindowKey()', () => {
    test('should generate hourly key with consistent format', () => {
      const key1 = ActionLedger.generateTimeWindowKey('source', 'action', 'hourly');
      const key2 = ActionLedger.generateTimeWindowKey('source', 'action', 'hourly');

      // Should be identical within same hour
      expect(key1).toBe(key2);

      // Should contain expected parts
      expect(key1).toContain('source:action:');
      expect(key1).toMatch(/source:action:\d{4}-\d{1,2}-\d{1,2}-\d{1,2}/);
    });

    test('should generate daily key with consistent format', () => {
      const key = ActionLedger.generateTimeWindowKey('test', 'daily_task', 'daily');

      expect(key).toContain('test:daily_task:');
      expect(key).toMatch(/test:daily_task:\d{4}-\d{1,2}-\d{1,2}$/);
    });

    test('should generate weekly key with consistent format', () => {
      const key = ActionLedger.generateTimeWindowKey('weekly', 'report', 'weekly');

      expect(key).toContain('weekly:report:');
      expect(key).toMatch(/weekly:report:\d{4}-W\d{1,2}$/);
    });

    test('should produce different keys for different sources', () => {
      const key1 = ActionLedger.generateTimeWindowKey('source1', 'action', 'daily');
      const key2 = ActionLedger.generateTimeWindowKey('source2', 'action', 'daily');

      expect(key1).not.toBe(key2);
    });

    test('should produce different keys for different actions', () => {
      const key1 = ActionLedger.generateTimeWindowKey('source', 'action1', 'daily');
      const key2 = ActionLedger.generateTimeWindowKey('source', 'action2', 'daily');

      expect(key1).not.toBe(key2);
    });
  });

  // ==========================================================================
  // 10. destroy() cleans up intervals
  // ==========================================================================

  describe('destroy()', () => {
    test('should clean up cleanup interval', () => {
      const testLedger = new ActionLedger();

      // destroy should not throw
      testLedger.destroy();

      // Calling destroy multiple times should be safe
      testLedger.destroy();
    });
  });

  // ==========================================================================
  // Additional: Static helper methods
  // ==========================================================================

  describe('generateDedupeKey()', () => {
    test('should generate correct dedupe key format', () => {
      const key = ActionLedger.generateDedupeKey('telegram', 'send_message', 'chat-123');
      expect(key).toBe('telegram:send_message:chat-123');
    });

    test('should produce different keys for different inputs', () => {
      const key1 = ActionLedger.generateDedupeKey('a', 'b', 'c');
      const key2 = ActionLedger.generateDedupeKey('a', 'b', 'd');
      const key3 = ActionLedger.generateDedupeKey('x', 'b', 'c');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  // ==========================================================================
  // Additional: getAll() and size()
  // ==========================================================================

  describe('getAll()', () => {
    test('should return all entries', async () => {
      await ledger.record('key-a', { data: 'a' });
      await ledger.record('key-b', { data: 'b' });

      const all = await ledger.getAll();
      expect(all.length).toBe(2);

      const keys = all.map((e) => e.dedupe_key);
      expect(keys).toContain('key-a');
      expect(keys).toContain('key-b');
    });

    test('should return empty array when no entries', async () => {
      const all = await ledger.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('size()', () => {
    test('should return correct count', async () => {
      expect(ledger.size()).toBe(0);

      await ledger.record('size-1');
      expect(ledger.size()).toBe(1);

      await ledger.record('size-2');
      expect(ledger.size()).toBe(2);

      await ledger.remove('size-1');
      expect(ledger.size()).toBe(1);
    });
  });

  // ==========================================================================
  // Additional: Retry functionality
  // ==========================================================================

  describe('Retry functionality', () => {
    test('should record failure and track retry count', async () => {
      const result = await ledger.recordFailure('retry-test', 'Test error');

      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfter).toBeDefined();

      const count = await ledger.getRetryCount('retry-test');
      expect(count).toBe(1);
    });

    test('should stop retrying after maxRetries', async () => {
      const limitedLedger = new ActionLedger({
        retryConfig: { maxRetries: 2 },
      });

      // First failure
      const result1 = await limitedLedger.recordFailure('max-retry', 'Error 1');
      expect(result1.shouldRetry).toBe(true);

      // Second failure
      const result2 = await limitedLedger.recordFailure('max-retry', 'Error 2');
      expect(result2.shouldRetry).toBe(false);

      limitedLedger.destroy();
    });

    test('should reset retry count on success', async () => {
      await ledger.recordFailure('reset-test', 'Error');
      expect(await ledger.getRetryCount('reset-test')).toBe(1);

      await ledger.resetRetryCount('reset-test');
      expect(await ledger.getRetryCount('reset-test')).toBe(0);
    });

    test('should check if ready for retry', async () => {
      const result = await ledger.recordFailure('ready-test', 'Error');

      // Initially not ready (need to wait retryAfter)
      const readyBefore = await ledger.isReadyForRetry('ready-test');
      expect(readyBefore).toBe(false);

      // Wait for retry delay
      await new Promise((resolve) => setTimeout(resolve, result.retryAfter! + 50));

      const readyAfter = await ledger.isReadyForRetry('ready-test');
      expect(readyAfter).toBe(true);
    });
  });
});
