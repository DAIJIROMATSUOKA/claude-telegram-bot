/**
 * Action Ledger v1.2.2 - Deduplication & Retry System with Memory Gateway Persistence
 *
 * Prevents duplicate execution of autopilot tasks by tracking:
 * - Task execution history
 * - Idempotency keys
 * - Deduplication windows (time-based)
 * - Retry attempts with exponential backoff
 *
 * Strategy: Memory Gateway-first with dedupe_key enforcement for true atomic operations
 *
 * Changes in v1.2.2:
 * - Fixed recordIfNotDuplicate() to return { isDuplicate: boolean } (test compatibility)
 * - Improved race condition handling by checking Memory Gateway BEFORE in-memory ledger
 * - Memory Gateway's dedupe_key now provides true atomic guarantee
 *
 * Changes in v1.2.1:
 * - Fixed restore() to use data.items instead of data.events (Memory Gateway API compatibility)
 *
 * Changes in v1.2:
 * - Added Memory Gateway persistence for crash recovery
 * - Added recordIfNotDuplicate() atomic operation to prevent race conditions
 * - Added destroy() method for proper resource cleanup
 * - Added restore() method to recover state from Memory Gateway
 */

import { ulid } from 'ulidx';

interface LedgerEntry {
  id: string; // ledger_<ulid>
  dedupe_key: string; // Unique identifier for the action
  executed_at: string; // ISO8601
  metadata?: any; // Optional metadata (task details, etc.)
  ttl: number; // Time-to-live in milliseconds
  retry_count?: number; // Number of retry attempts
  last_error?: string; // Last error message
  next_retry_at?: string; // ISO8601 timestamp for next retry
}

export interface RetryConfig {
  maxRetries: number; // Default: 3
  baseDelay: number; // Default: 1000ms (1 second)
  maxDelay: number; // Default: 8000ms (8 seconds)
  jitterPercent: number; // Default: 20 (±20%)
}

export interface ActionLedgerOptions {
  defaultTTL?: number;
  retryConfig?: Partial<RetryConfig>;
  memoryGatewayUrl?: string;
}

export class ActionLedger {
  private ledger: Map<string, LedgerEntry> = new Map();
  private defaultTTL = 24 * 60 * 60 * 1000; // 24 hours
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 8000,
    jitterPercent: 20,
  };
  private cleanupInterval?: NodeJS.Timeout;
  private memoryGatewayUrl?: string;

  constructor(options?: ActionLedgerOptions) {
    if (options?.defaultTTL) {
      this.defaultTTL = options.defaultTTL;
    }

    if (options?.retryConfig) {
      this.retryConfig = { ...this.retryConfig, ...options.retryConfig };
    }

    this.memoryGatewayUrl = options?.memoryGatewayUrl;

    // Start cleanup interval (every hour)
    this.startCleanupInterval();
  }

  /**
   * Restore ledger state from Memory Gateway
   * Call this on bot startup to recover from crashes
   */
  async restore(): Promise<void> {
    if (!this.memoryGatewayUrl) {
      console.log('[ActionLedger] Memory Gateway URL not configured, skipping restore');
      return;
    }

    try {
      const response = await fetch(
        `${this.memoryGatewayUrl}/v1/memory/query?scope=private/jarvis/action_ledger&limit=1000`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(`Memory Gateway query failed: ${response.status}`);
      }

      const data = await response.json();
      const items = data.items || [];

      let restoredCount = 0;
      const now = Date.now();

      for (const item of items) {
        try {
          const entry: LedgerEntry = JSON.parse(item.content);

          // Check if entry is still valid (not expired)
          const executedAt = new Date(entry.executed_at).getTime();
          const age = now - executedAt;

          if (age <= entry.ttl) {
            this.ledger.set(entry.dedupe_key, entry);
            restoredCount++;
          }
        } catch (err) {
          console.error('[ActionLedger] Failed to parse ledger entry:', err);
        }
      }

      console.log(`[ActionLedger] Restored ${restoredCount} entries from Memory Gateway`);
    } catch (error) {
      console.error('[ActionLedger] Failed to restore from Memory Gateway:', error);
    }
  }

  /**
   * Record an action in the ledger (with Memory Gateway persistence)
   */
  async record(dedupeKey: string, metadata?: any, ttl?: number): Promise<string> {
    const id = `ledger_${ulid()}`;
    const entry: LedgerEntry = {
      id,
      dedupe_key: dedupeKey,
      executed_at: new Date().toISOString(),
      metadata,
      ttl: ttl || this.defaultTTL,
    };

    this.ledger.set(dedupeKey, entry);
    console.log(`[ActionLedger] Recorded action: ${dedupeKey}`);

    // Persist to Memory Gateway (fire-and-forget, don't block)
    if (this.memoryGatewayUrl) {
      this.persistToMemoryGateway(entry).catch((err) => {
        console.error('[ActionLedger] Failed to persist to Memory Gateway:', err);
      });
    }

    return id;
  }

  /**
   * Atomic operation: Record if not duplicate
   * This prevents race conditions between isDuplicate() and record()
   *
   * Strategy: Use Memory Gateway's dedupe_key enforcement for true atomic guarantee
   * 1. Try to append to Memory Gateway with dedupe_key
   * 2. If dedupe_key conflict (409), it's a duplicate
   * 3. If success (200), record in-memory ledger as well
   */
  async recordIfNotDuplicate(
    dedupeKey: string,
    metadata?: any,
    ttl?: number
  ): Promise<{ isDuplicate: boolean; recorded?: boolean; id?: string; reason?: string }> {
    const id = `ledger_${ulid()}`;
    const entry: LedgerEntry = {
      id,
      dedupe_key: dedupeKey,
      executed_at: new Date().toISOString(),
      metadata,
      ttl: ttl || this.defaultTTL,
    };

    // STEP 1: Try to append to Memory Gateway (atomic dedupe_key check)
    if (this.memoryGatewayUrl) {
      try {
        const response = await fetch(`${this.memoryGatewayUrl}/v1/memory/append`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: 'private/jarvis/action_ledger',
            dedupe_key: entry.dedupe_key,
            type: 'ledger_entry',
            title: `Action: ${entry.dedupe_key}`,
            content: JSON.stringify(entry),
            tags: ['action_ledger', 'autopilot'],
            importance: 3, // Low importance (cleanup by janitor after TTL)
            source_agent: 'jarvis',
          }),
        });

        // Handle 500 errors as potential duplicates (UNIQUE constraint violation)
        if (response.status === 500) {
          // Likely UNIQUE(scope, dedupe_key) constraint violation in concurrent requests
          console.log(`[ActionLedger] Duplicate detected (Memory Gateway 500): ${dedupeKey}`);
          return {
            isDuplicate: true,
            recorded: false,
            reason: 'Duplicate detected by Memory Gateway (UNIQUE constraint)',
          };
        }

        if (!response.ok) {
          throw new Error(`Memory Gateway append failed: ${response.status}`);
        }

        const data = await response.json();

        // Check action field: "created" = new, "updated" = duplicate
        if (data.action === 'updated') {
          // Dedupe key already exists - duplicate detected
          console.log(`[ActionLedger] Duplicate detected (Memory Gateway): ${dedupeKey}`);
          return {
            isDuplicate: true,
            recorded: false,
            reason: 'Duplicate detected by Memory Gateway (dedupe_key exists)',
          };
        }

        // Success (action === "created") - record in memory as well
        this.ledger.set(dedupeKey, entry);
        console.log(`[ActionLedger] Recorded action: ${dedupeKey}`);
        return { isDuplicate: false, recorded: true, id };
      } catch (err) {
        console.error('[ActionLedger] Memory Gateway append failed, falling back to in-memory:', err);
        // Fall through to in-memory only
      }
    }

    // STEP 2: Fallback to in-memory only (if Memory Gateway unavailable)
    const existingEntry = this.ledger.get(dedupeKey);

    if (existingEntry) {
      // Check if entry has expired
      const now = Date.now();
      const executedAt = new Date(existingEntry.executed_at).getTime();
      const age = now - executedAt;

      if (age <= existingEntry.ttl) {
        console.log(`[ActionLedger] Duplicate detected in memory: ${dedupeKey}`);
        return {
          isDuplicate: true,
          recorded: false,
          reason: `Duplicate within TTL (${Math.round(age / 1000)}s ago)`,
        };
      } else {
        // Entry expired, remove it
        this.ledger.delete(dedupeKey);
        console.log(`[ActionLedger] Expired entry removed: ${dedupeKey}`);
      }
    }

    // Not a duplicate - record in-memory
    this.ledger.set(dedupeKey, entry);
    console.log(`[ActionLedger] Recorded action (in-memory only): ${dedupeKey}`);
    return { isDuplicate: false, recorded: true, id };
  }

  /**
   * Persist an entry to Memory Gateway
   */
  private async persistToMemoryGateway(entry: LedgerEntry): Promise<void> {
    if (!this.memoryGatewayUrl) {
      return;
    }

    const response = await fetch(`${this.memoryGatewayUrl}/v1/memory/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'private/jarvis/action_ledger',
        dedupe_key: entry.dedupe_key,
        type: 'ledger_entry',
        title: `Action: ${entry.dedupe_key}`,
        content: JSON.stringify(entry),
        tags: ['action_ledger', 'autopilot'],
        importance: 3, // Low importance (cleanup by janitor after TTL)
        source_agent: 'jarvis',
      }),
    });

    if (!response.ok) {
      throw new Error(`Memory Gateway append failed: ${response.status}`);
    }
  }

  /**
   * Check if an action is a duplicate
   * @deprecated Use recordIfNotDuplicate() instead to avoid race conditions
   */
  async isDuplicate(dedupeKey: string): Promise<boolean> {
    const entry = this.ledger.get(dedupeKey);

    if (!entry) {
      return false; // Not a duplicate
    }

    // Check if entry has expired
    const now = Date.now();
    const executedAt = new Date(entry.executed_at).getTime();
    const age = now - executedAt;

    if (age > entry.ttl) {
      // Entry expired, remove it
      this.ledger.delete(dedupeKey);
      console.log(`[ActionLedger] Expired entry removed: ${dedupeKey}`);
      return false;
    }

    console.log(`[ActionLedger] Duplicate detected: ${dedupeKey}`);
    return true; // Duplicate within TTL window
  }

  /**
   * Get an entry from the ledger
   */
  async get(dedupeKey: string): Promise<LedgerEntry | null> {
    const entry = this.ledger.get(dedupeKey);
    return entry || null;
  }

  /**
   * Remove an entry from the ledger
   */
  async remove(dedupeKey: string): Promise<void> {
    this.ledger.delete(dedupeKey);
    console.log(`[ActionLedger] Removed entry: ${dedupeKey}`);
  }

  /**
   * Clear all entries from the ledger
   */
  async clear(): Promise<void> {
    this.ledger.clear();
    console.log('[ActionLedger] Cleared all entries');
  }

  /**
   * Get all entries (for debugging)
   */
  async getAll(): Promise<LedgerEntry[]> {
    return Array.from(this.ledger.values());
  }

  /**
   * Get ledger size
   */
  size(): number {
    return this.ledger.size;
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [dedupeKey, entry] of this.ledger.entries()) {
      const executedAt = new Date(entry.executed_at).getTime();
      const age = now - executedAt;

      if (age > entry.ttl) {
        this.ledger.delete(dedupeKey);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[ActionLedger] Cleanup: Removed ${removedCount} expired entries`);
    }
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);

    console.log('[ActionLedger] Started cleanup interval (1 hour)');
  }

  /**
   * Destroy the ledger and cleanup resources
   * Call this on bot shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    console.log('[ActionLedger] Destroyed cleanup interval');
  }

  /**
   * Record a failed execution attempt
   */
  async recordFailure(
    dedupeKey: string,
    error: string,
    metadata?: any
  ): Promise<{ shouldRetry: boolean; retryAfter?: number }> {
    let entry = this.ledger.get(dedupeKey);

    if (!entry) {
      // First failure - create entry
      entry = {
        id: `ledger_${ulid()}`,
        dedupe_key: dedupeKey,
        executed_at: new Date().toISOString(),
        metadata,
        ttl: this.defaultTTL,
        retry_count: 0,
        last_error: error,
      };
    }

    // Increment retry count
    entry.retry_count = (entry.retry_count || 0) + 1;
    entry.last_error = error;

    // Check if we should retry
    if (entry.retry_count >= this.retryConfig.maxRetries) {
      console.log(`[ActionLedger] Max retries reached for: ${dedupeKey}`);
      this.ledger.set(dedupeKey, entry);
      return { shouldRetry: false };
    }

    // Calculate next retry delay with exponential backoff + jitter
    const retryDelay = this.calculateRetryDelay(entry.retry_count);
    entry.next_retry_at = new Date(Date.now() + retryDelay).toISOString();

    this.ledger.set(dedupeKey, entry);

    console.log(
      `[ActionLedger] Retry ${entry.retry_count}/${this.retryConfig.maxRetries} for ${dedupeKey} in ${retryDelay}ms`
    );

    return { shouldRetry: true, retryAfter: retryDelay };
  }

  /**
   * Check if a task is ready for retry
   */
  async isReadyForRetry(dedupeKey: string): Promise<boolean> {
    const entry = this.ledger.get(dedupeKey);

    if (!entry || !entry.next_retry_at) {
      return false;
    }

    const now = Date.now();
    const retryAt = new Date(entry.next_retry_at).getTime();

    return now >= retryAt;
  }

  /**
   * Calculate retry delay with exponential backoff + jitter
   *
   * Formula: delay = min(baseDelay * 2^retryCount, maxDelay) * (1 ± jitter%)
   */
  private calculateRetryDelay(retryCount: number): number {
    const { baseDelay, maxDelay, jitterPercent } = this.retryConfig;

    // Exponential backoff: 1s → 2s → 4s → 8s
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);

    // Add jitter (±jitterPercent%)
    const jitterRange = cappedDelay * (jitterPercent / 100);
    const jitter = Math.random() * jitterRange * 2 - jitterRange; // Random between -jitterRange and +jitterRange

    const finalDelay = Math.max(0, cappedDelay + jitter);

    return Math.round(finalDelay);
  }

  /**
   * Get retry count for a task
   */
  async getRetryCount(dedupeKey: string): Promise<number> {
    const entry = this.ledger.get(dedupeKey);
    return entry?.retry_count || 0;
  }

  /**
   * Reset retry count (on successful execution)
   */
  async resetRetryCount(dedupeKey: string): Promise<void> {
    const entry = this.ledger.get(dedupeKey);
    if (entry) {
      entry.retry_count = 0;
      entry.last_error = undefined;
      entry.next_retry_at = undefined;
      this.ledger.set(dedupeKey, entry);
      console.log(`[ActionLedger] Reset retry count for: ${dedupeKey}`);
    }
  }

  /**
   * Generate a dedupe key from task properties
   */
  static generateDedupeKey(
    source: string,
    action: string,
    identifier: string
  ): string {
    return `${source}:${action}:${identifier}`;
  }

  /**
   * Generate a time-window dedupe key (for recurring tasks)
   */
  static generateTimeWindowKey(
    source: string,
    action: string,
    windowType: 'hourly' | 'daily' | 'weekly'
  ): string {
    const now = new Date();
    let window: string;

    switch (windowType) {
      case 'hourly':
        window = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
        break;
      case 'daily':
        window = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        break;
      case 'weekly':
        const weekNumber = this.getWeekNumber(now);
        window = `${now.getFullYear()}-W${weekNumber}`;
        break;
    }

    return `${source}:${action}:${window}`;
  }

  /**
   * Get ISO week number
   */
  private static getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}
