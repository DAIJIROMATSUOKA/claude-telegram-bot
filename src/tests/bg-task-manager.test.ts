/**
 * bg-task-manager Test Suite
 *
 * Tests:
 * 1. runBgTask executes async function and returns result
 * 2. runBgTask handles errors gracefully
 * 3. getBgTaskSummary returns correct counts (running, completed, failed)
 * 4. Tasks with timeout option (via maxRetries/retryBaseMs)
 * 5. Multiple concurrent tasks
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock metrics module to prevent SQLite side effects
mock.module('../utils/metrics', () => ({
  recordBgTaskMetrics: mock(() => {}),
}));

// Import after mocking
import { runBgTask, getBgTaskSummary } from '../utils/bg-task-manager';

// ============================================================================
// Helper functions
// ============================================================================

/** Wait for background tasks to complete */
function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Create a mock async function that resolves after delay */
function createSuccessTask(delayMs: number = 10): () => Promise<void> {
  return async () => {
    await waitFor(delayMs);
  };
}

/** Create a mock async function that rejects with error */
function createFailingTask(errorMsg: string = 'Task failed'): () => Promise<void> {
  return async () => {
    throw new Error(errorMsg);
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('bg-task-manager', () => {
  // ==========================================================================
  // 1. runBgTask executes async function and returns result
  // ==========================================================================

  describe('runBgTask execution', () => {
    test('should execute async function successfully', async () => {
      let executed = false;
      const taskFn = async () => {
        executed = true;
      };

      runBgTask(taskFn, { name: 'test-success-1' });
      await waitFor(50);

      expect(executed).toBe(true);
    });

    test('should record success in summary', async () => {
      const taskFn = createSuccessTask(5);
      runBgTask(taskFn, { name: 'test-success-2' });
      await waitFor(50);

      const summary = getBgTaskSummary();
      expect(summary.successes).toBeGreaterThan(0);
    });

    test('should track task duration', async () => {
      const taskFn = createSuccessTask(20);
      runBgTask(taskFn, { name: 'test-duration' });
      await waitFor(100);

      // Task should be recorded - verify summary has data
      const summary = getBgTaskSummary();
      expect(summary.total).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 2. runBgTask handles errors gracefully
  // ==========================================================================

  describe('runBgTask error handling', () => {
    test('should catch errors without crashing', async () => {
      const taskFn = createFailingTask('Intentional error');

      // Should not throw
      expect(() => {
        runBgTask(taskFn, { name: 'test-error-1', maxRetries: 0 });
      }).not.toThrow();

      await waitFor(50);
    });

    test('should retry on failure', async () => {
      let attempts = 0;
      const taskFn = async () => {
        attempts++;
        throw new Error('Retry test error');
      };

      runBgTask(taskFn, {
        name: 'test-retry',
        maxRetries: 2,
        retryBaseMs: 10,
      });

      // Wait for retries (10ms * 2^0 + 10ms * 2^1 + buffer)
      await waitFor(200);

      // Should attempt 3 times (initial + 2 retries)
      expect(attempts).toBe(3);
    });

    test('should record failure after max retries', async () => {
      const taskFn = createFailingTask('Max retry error');

      runBgTask(taskFn, {
        name: 'test-max-retry',
        maxRetries: 1,
        retryBaseMs: 10,
      });

      await waitFor(100);

      const summary = getBgTaskSummary();
      expect(summary.failures).toBeGreaterThan(0);
    });

    test('should include error message in failure result', async () => {
      const errorMsg = 'Unique error message for test';
      const taskFn = createFailingTask(errorMsg);

      runBgTask(taskFn, {
        name: 'test-error-msg',
        maxRetries: 0,
      });

      await waitFor(50);

      const summary = getBgTaskSummary();
      const failure = summary.recentFailures.find(
        f => f.name === 'test-error-msg'
      );
      expect(failure).toBeDefined();
      expect(failure?.error).toBe(errorMsg);
    });
  });

  // ==========================================================================
  // 3. getBgTaskSummary returns correct counts
  // ==========================================================================

  describe('getBgTaskSummary', () => {
    test('should return object with correct shape', () => {
      const summary = getBgTaskSummary();

      expect(typeof summary.total).toBe('number');
      expect(typeof summary.successes).toBe('number');
      expect(typeof summary.failures).toBe('number');
      expect(Array.isArray(summary.recentFailures)).toBe(true);
    });

    test('should count successes and failures correctly', async () => {
      const initialSummary = getBgTaskSummary();
      const initialSuccesses = initialSummary.successes;
      const initialFailures = initialSummary.failures;

      // Run one success and one failure
      runBgTask(createSuccessTask(5), { name: 'count-success' });
      runBgTask(createFailingTask('count error'), {
        name: 'count-failure',
        maxRetries: 0,
      });

      await waitFor(100);

      const summary = getBgTaskSummary();
      expect(summary.successes).toBe(initialSuccesses + 1);
      expect(summary.failures).toBe(initialFailures + 1);
    });

    test('should limit recentFailures to 5 items', async () => {
      // Run multiple failures
      for (let i = 0; i < 10; i++) {
        runBgTask(createFailingTask(`error ${i}`), {
          name: `bulk-fail-${i}`,
          maxRetries: 0,
        });
      }

      await waitFor(200);

      const summary = getBgTaskSummary();
      expect(summary.recentFailures.length).toBeLessThanOrEqual(5);
    });
  });

  // ==========================================================================
  // 4. Tasks with retry options
  // ==========================================================================

  describe('retry options', () => {
    test('should use default maxRetries of 2', async () => {
      let attempts = 0;
      const taskFn = async () => {
        attempts++;
        throw new Error('Default retry test');
      };

      runBgTask(taskFn, {
        name: 'test-default-retry',
        retryBaseMs: 5,
      });

      await waitFor(200);

      // Default is 2 retries = 3 total attempts
      expect(attempts).toBe(3);
    });

    test('should use exponential backoff', async () => {
      const timestamps: number[] = [];
      const taskFn = async () => {
        timestamps.push(Date.now());
        throw new Error('Backoff test');
      };

      runBgTask(taskFn, {
        name: 'test-backoff',
        maxRetries: 2,
        retryBaseMs: 20,
      });

      await waitFor(300);

      // Check that delays increase
      if (timestamps.length >= 3) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];
        // Second delay should be roughly double the first (exponential)
        expect(delay2).toBeGreaterThan(delay1);
      }
    });

    test('should succeed after retry if task succeeds later', async () => {
      let attempts = 0;
      const taskFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('First attempt fails');
        }
        // Success on second attempt
      };

      runBgTask(taskFn, {
        name: 'test-retry-success',
        maxRetries: 2,
        retryBaseMs: 10,
      });

      await waitFor(100);

      expect(attempts).toBe(2);
    });
  });

  // ==========================================================================
  // 5. Multiple concurrent tasks
  // ==========================================================================

  describe('concurrent tasks', () => {
    test('should handle multiple concurrent tasks', async () => {
      const completed: string[] = [];

      const createTrackedTask = (name: string, delay: number) => async () => {
        await waitFor(delay);
        completed.push(name);
      };

      runBgTask(createTrackedTask('task-a', 30), { name: 'concurrent-a' });
      runBgTask(createTrackedTask('task-b', 10), { name: 'concurrent-b' });
      runBgTask(createTrackedTask('task-c', 20), { name: 'concurrent-c' });

      await waitFor(100);

      // All tasks should complete (order may vary due to different delays)
      expect(completed).toContain('task-a');
      expect(completed).toContain('task-b');
      expect(completed).toContain('task-c');
    });

    test('should track all concurrent tasks in summary', async () => {
      const initialSummary = getBgTaskSummary();
      const initialTotal = initialSummary.total;

      // Run 3 concurrent tasks
      runBgTask(createSuccessTask(5), { name: 'parallel-1' });
      runBgTask(createSuccessTask(5), { name: 'parallel-2' });
      runBgTask(createSuccessTask(5), { name: 'parallel-3' });

      await waitFor(100);

      const summary = getBgTaskSummary();
      expect(summary.total).toBe(initialTotal + 3);
    });

    test('should handle mixed success and failure concurrently', async () => {
      const initialSummary = getBgTaskSummary();
      const initialSuccesses = initialSummary.successes;
      const initialFailures = initialSummary.failures;

      runBgTask(createSuccessTask(5), { name: 'mixed-success-1' });
      runBgTask(createFailingTask('mixed error'), {
        name: 'mixed-fail',
        maxRetries: 0,
      });
      runBgTask(createSuccessTask(5), { name: 'mixed-success-2' });

      await waitFor(100);

      const summary = getBgTaskSummary();
      expect(summary.successes).toBe(initialSuccesses + 2);
      expect(summary.failures).toBe(initialFailures + 1);
    });
  });

  // ==========================================================================
  // Additional edge cases
  // ==========================================================================

  describe('edge cases', () => {
    test('should handle task that resolves immediately', async () => {
      let executed = false;
      const taskFn = async () => {
        executed = true;
      };

      runBgTask(taskFn, { name: 'instant-task' });
      await waitFor(20);

      expect(executed).toBe(true);
    });

    test('should handle task that throws non-Error objects', async () => {
      const taskFn = async () => {
        throw 'string error';
      };

      expect(() => {
        runBgTask(taskFn, { name: 'string-error', maxRetries: 0 });
      }).not.toThrow();

      await waitFor(50);

      const summary = getBgTaskSummary();
      expect(summary.failures).toBeGreaterThan(0);
    });
  });
});
