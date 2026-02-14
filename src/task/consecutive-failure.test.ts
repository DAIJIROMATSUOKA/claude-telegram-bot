import { describe, test, expect } from 'bun:test';

// orchestrate.tsのメインループと同じロジックをシミュレート
function simulateConsecutiveFailures(results: ('success' | 'failed')[]): { stopped: boolean; stoppedAtIndex: number | null } {
  let consecutiveFailures = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i] === 'success') {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }
    if (consecutiveFailures >= 2) {
      return { stopped: true, stoppedAtIndex: i };
    }
  }
  return { stopped: false, stoppedAtIndex: null };
}

describe('Consecutive Failure Stop Logic', () => {
  test('all success - should not stop', () => {
    const result = simulateConsecutiveFailures(['success', 'success']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('single failure followed by success - should not stop (reset)', () => {
    const result = simulateConsecutiveFailures(['failed', 'success']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('two consecutive failures - should stop at index 1', () => {
    const result = simulateConsecutiveFailures(['failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(1);
  });

  test('success then two consecutive failures - should stop at index 2', () => {
    const result = simulateConsecutiveFailures(['success', 'failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(2);
  });

  test('failure, success, failure - should not stop (success resets counter)', () => {
    const result = simulateConsecutiveFailures(['failed', 'success', 'failed']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('two successes then two failures - should stop at index 3', () => {
    const result = simulateConsecutiveFailures(['success', 'success', 'failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(3);
  });

  test('empty array - should not stop', () => {
    const result = simulateConsecutiveFailures([]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('single failure - should not stop (only 1 failure)', () => {
    const result = simulateConsecutiveFailures(['failed']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });
});
