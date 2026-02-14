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

  // === 追加テスト ===

  test('counter reset then count up again - should stop correctly', () => {
    // 失敗→成功(リセット)→失敗→失敗 → index 3で停止
    const result = simulateConsecutiveFailures(['failed', 'success', 'failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(3);
  });

  test('threshold exactly (2 consecutive failures) - should stop', () => {
    // 閾値ちょうど2回連続失敗
    const result = simulateConsecutiveFailures(['failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(1);
  });

  test('threshold - 1 (1 consecutive failure) - should not stop', () => {
    // 閾値-1 = 1回の連続失敗では停止しない
    const result = simulateConsecutiveFailures(['success', 'failed']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('alternating success and failure - counter resets each time', () => {
    // 成功と失敗が交互 → 毎回リセットされるため停止しない
    const result = simulateConsecutiveFailures(['success', 'failed', 'success', 'failed', 'success', 'failed']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('initial state with no results - counter is 0', () => {
    // 空配列の場合、カウンターは0のまま（停止しない）
    const result = simulateConsecutiveFailures([]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('multiple reset cycles before final stop', () => {
    // 複数回リセット後に最終的に停止
    // 失敗→成功→失敗→成功→失敗→失敗 → index 5で停止
    const result = simulateConsecutiveFailures(['failed', 'success', 'failed', 'success', 'failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(5);
  });

  test('long sequence without consecutive failures - should not stop', () => {
    // 長いシーケンスでも連続失敗がなければ停止しない
    const result = simulateConsecutiveFailures([
      'failed', 'success', 'failed', 'success', 'failed', 'success',
      'failed', 'success', 'failed', 'success'
    ]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('all failures - should stop at second failure', () => {
    // 全て失敗 → 2番目で停止（index 1）
    const result = simulateConsecutiveFailures(['failed', 'failed', 'failed', 'failed']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(1);
  });

  // === エッジケース追加テスト ===

  test('edge case: empty array returns stopped=false and stoppedAtIndex=null', () => {
    const result = simulateConsecutiveFailures([]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('edge case: single success element returns stopped=false', () => {
    const result = simulateConsecutiveFailures(['success']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('edge case: single failed element returns stopped=false (1 failure is not enough)', () => {
    const result = simulateConsecutiveFailures(['failed']);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('edge case: long sequence of 10 successes returns stopped=false', () => {
    const result = simulateConsecutiveFailures([
      'success', 'success', 'success', 'success', 'success',
      'success', 'success', 'success', 'success', 'success'
    ]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });

  test('edge case: first two elements are failed returns stopped=true at index 1', () => {
    const result = simulateConsecutiveFailures(['failed', 'failed', 'success', 'success']);
    expect(result.stopped).toBe(true);
    expect(result.stoppedAtIndex).toBe(1);
  });

  test('edge case: alternating failed-success 5 times returns stopped=false', () => {
    const result = simulateConsecutiveFailures([
      'failed', 'success', 'failed', 'success', 'failed',
      'success', 'failed', 'success', 'failed', 'success'
    ]);
    expect(result.stopped).toBe(false);
    expect(result.stoppedAtIndex).toBeNull();
  });
});
