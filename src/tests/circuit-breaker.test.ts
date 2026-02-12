/**
 * CircuitBreaker Test Suite
 *
 * Tests:
 * 1. Initial state is CLOSED
 * 2. Transitions to OPEN after failureThreshold consecutive failures
 * 3. Transitions to HALF_OPEN after resetTimeoutMs
 * 4. Returns to CLOSED on success in HALF_OPEN
 * 5. Returns to OPEN on failure in HALF_OPEN
 * 6. getStats() returns correct statistics
 * 7. reset() clears state
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { CircuitBreaker, type CircuitState } from '../utils/circuit-breaker.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** 成功するPromiseを返す関数 */
const successFn = async (): Promise<string> => 'success';

/** 失敗するPromiseを返す関数 */
const failFn = async (): Promise<string> => {
  throw new Error('Test failure');
};

/** 指定回数失敗させる */
async function failNTimes(
  breaker: CircuitBreaker,
  n: number
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await breaker.execute(failFn, 'fallback');
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'TestBreaker',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
  });

  // ==========================================================================
  // 1. Initial state is CLOSED
  // ==========================================================================

  test('should start in CLOSED state', () => {
    const status = breaker.getStatus();
    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
    expect(status.totalCalls).toBe(0);
    expect(status.totalFailures).toBe(0);
    expect(status.successRate).toBe(100);
  });

  // ==========================================================================
  // 2. Transitions to OPEN after failureThreshold consecutive failures
  // ==========================================================================

  test('should transition to OPEN after failureThreshold consecutive failures', async () => {
    // Fail twice (below threshold)
    await failNTimes(breaker, 2);
    expect(breaker.getStatus().state).toBe('CLOSED');

    // Third failure triggers OPEN
    await breaker.execute(failFn, 'fallback');
    expect(breaker.getStatus().state).toBe('OPEN');
    expect(breaker.getStatus().failureCount).toBe(3);
  });

  test('should not transition to OPEN if successes reset failure count', async () => {
    // 2 failures
    await failNTimes(breaker, 2);
    expect(breaker.getStatus().failureCount).toBe(2);

    // Success resets failure count
    await breaker.execute(successFn, 'fallback');
    expect(breaker.getStatus().failureCount).toBe(0);
    expect(breaker.getStatus().state).toBe('CLOSED');

    // 2 more failures
    await failNTimes(breaker, 2);
    expect(breaker.getStatus().state).toBe('CLOSED');
  });

  test('should return fallback immediately when OPEN', async () => {
    // Transition to OPEN
    await failNTimes(breaker, 3);
    expect(breaker.getStatus().state).toBe('OPEN');

    const callsBefore = breaker.getStatus().totalCalls;

    // Should return fallback without executing fn
    const result = await breaker.execute(successFn, 'fallback');
    expect(result).toBe('fallback');

    // totalCalls increments, but failureCount doesn't change
    expect(breaker.getStatus().totalCalls).toBe(callsBefore + 1);
  });

  // ==========================================================================
  // 3. Transitions to HALF_OPEN after resetTimeoutMs
  // ==========================================================================

  test('should transition to HALF_OPEN after resetTimeoutMs', async () => {
    // Create breaker with short timeout
    const shortBreaker = new CircuitBreaker({
      name: 'ShortTimeout',
      failureThreshold: 2,
      resetTimeoutMs: 50, // 50ms
    });

    // Transition to OPEN
    await failNTimes(shortBreaker, 2);
    expect(shortBreaker.getStatus().state).toBe('OPEN');

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next call triggers HALF_OPEN transition and executes
    const result = await shortBreaker.execute(successFn, 'fallback');
    expect(result).toBe('success');
    // After success in HALF_OPEN, it goes to CLOSED
    expect(shortBreaker.getStatus().state).toBe('CLOSED');
  });

  test('should stay OPEN if resetTimeoutMs has not elapsed', async () => {
    const shortBreaker = new CircuitBreaker({
      name: 'ShortTimeout',
      failureThreshold: 2,
      resetTimeoutMs: 500,
    });

    // Transition to OPEN
    await failNTimes(shortBreaker, 2);
    expect(shortBreaker.getStatus().state).toBe('OPEN');

    // Wait less than timeout
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should still be OPEN, return fallback
    const result = await shortBreaker.execute(successFn, 'fallback');
    expect(result).toBe('fallback');
    expect(shortBreaker.getStatus().state).toBe('OPEN');
  });

  // ==========================================================================
  // 4. Returns to CLOSED on success in HALF_OPEN
  // ==========================================================================

  test('should return to CLOSED on success in HALF_OPEN', async () => {
    const shortBreaker = new CircuitBreaker({
      name: 'HalfOpenSuccess',
      failureThreshold: 2,
      resetTimeoutMs: 30,
    });

    // Transition to OPEN
    await failNTimes(shortBreaker, 2);
    expect(shortBreaker.getStatus().state).toBe('OPEN');

    // Wait for timeout to allow HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Success in HALF_OPEN -> CLOSED
    const result = await shortBreaker.execute(successFn, 'fallback');
    expect(result).toBe('success');
    expect(shortBreaker.getStatus().state).toBe('CLOSED');
    expect(shortBreaker.getStatus().failureCount).toBe(0);
  });

  // ==========================================================================
  // 5. Returns to OPEN on failure in HALF_OPEN
  // ==========================================================================

  test('should return to OPEN on failure in HALF_OPEN', async () => {
    const shortBreaker = new CircuitBreaker({
      name: 'HalfOpenFail',
      failureThreshold: 2,
      resetTimeoutMs: 30,
    });

    // Transition to OPEN
    await failNTimes(shortBreaker, 2);
    expect(shortBreaker.getStatus().state).toBe('OPEN');

    // Wait for timeout to allow HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Failure in HALF_OPEN -> back to OPEN
    const result = await shortBreaker.execute(failFn, 'fallback');
    expect(result).toBe('fallback');
    expect(shortBreaker.getStatus().state).toBe('OPEN');
    expect(shortBreaker.getStatus().failureCount).toBe(3); // 2 + 1
  });

  // ==========================================================================
  // 6. getStatus() returns correct statistics
  // ==========================================================================

  test('should return correct statistics via getStatus()', async () => {
    // Initial state
    let status = breaker.getStatus();
    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
    expect(status.totalCalls).toBe(0);
    expect(status.totalFailures).toBe(0);
    expect(status.successRate).toBe(100);

    // 2 successes
    await breaker.execute(successFn, 'fallback');
    await breaker.execute(successFn, 'fallback');

    status = breaker.getStatus();
    expect(status.totalCalls).toBe(2);
    expect(status.totalFailures).toBe(0);
    expect(status.successRate).toBe(100);

    // 1 failure
    await breaker.execute(failFn, 'fallback');

    status = breaker.getStatus();
    expect(status.totalCalls).toBe(3);
    expect(status.totalFailures).toBe(1);
    expect(status.failureCount).toBe(1);
    expect(status.successRate).toBe(67); // (1 - 1/3) * 100 = 66.67 -> 67

    // 1 success (resets consecutive failures but not totalFailures)
    await breaker.execute(successFn, 'fallback');

    status = breaker.getStatus();
    expect(status.totalCalls).toBe(4);
    expect(status.totalFailures).toBe(1);
    expect(status.failureCount).toBe(0); // Reset by success
    expect(status.successRate).toBe(75); // (1 - 1/4) * 100 = 75
  });

  test('should calculate successRate correctly with many calls', async () => {
    // 10 calls: 7 success, 3 failure
    for (let i = 0; i < 7; i++) {
      await breaker.execute(successFn, 'fallback');
    }

    // Reset breaker to allow more failures without OPEN
    breaker.reset();

    // 3 failures (doesn't hit threshold of 3 because reset in between)
    await breaker.execute(failFn, 'fallback');
    await breaker.execute(successFn, 'fallback');
    await breaker.execute(failFn, 'fallback');
    await breaker.execute(successFn, 'fallback');
    await breaker.execute(failFn, 'fallback');

    const status = breaker.getStatus();
    // Total: 7 + 5 = 12 calls, 3 failures
    expect(status.totalCalls).toBe(12);
    expect(status.totalFailures).toBe(3);
    expect(status.successRate).toBe(75); // (1 - 3/12) * 100 = 75
  });

  // ==========================================================================
  // 7. reset() clears state
  // ==========================================================================

  test('should reset state to CLOSED and clear failureCount', async () => {
    // Transition to OPEN
    await failNTimes(breaker, 3);
    expect(breaker.getStatus().state).toBe('OPEN');
    expect(breaker.getStatus().failureCount).toBe(3);

    // Reset
    breaker.reset();

    const status = breaker.getStatus();
    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
    // Note: totalCalls and totalFailures are NOT reset
    expect(status.totalCalls).toBe(3);
    expect(status.totalFailures).toBe(3);
  });

  test('should allow normal operation after reset', async () => {
    // Transition to OPEN
    await failNTimes(breaker, 3);
    expect(breaker.getStatus().state).toBe('OPEN');

    // Reset
    breaker.reset();

    // Should execute normally
    const result = await breaker.execute(successFn, 'fallback');
    expect(result).toBe('success');
    expect(breaker.getStatus().state).toBe('CLOSED');
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  test('should handle execute returning fallback on error in CLOSED state', async () => {
    const result = await breaker.execute(failFn, 'my-fallback');
    expect(result).toBe('my-fallback');
    expect(breaker.getStatus().state).toBe('CLOSED'); // 1 failure, not enough for OPEN
    expect(breaker.getStatus().failureCount).toBe(1);
  });

  test('should pass through successful result', async () => {
    const customFn = async () => ({ data: 'test-data', count: 42 });
    const result = await breaker.execute(customFn, { data: 'fallback', count: 0 });
    expect(result).toEqual({ data: 'test-data', count: 42 });
  });

  test('should handle threshold of 1', async () => {
    const sensitiveBreaker = new CircuitBreaker({
      name: 'Sensitive',
      failureThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Single failure -> OPEN
    await sensitiveBreaker.execute(failFn, 'fallback');
    expect(sensitiveBreaker.getStatus().state).toBe('OPEN');
  });

  test('should track name correctly', () => {
    const namedBreaker = new CircuitBreaker({
      name: 'MyService',
      failureThreshold: 5,
      resetTimeoutMs: 2000,
    });

    expect(namedBreaker.name).toBe('MyService');
  });
});
