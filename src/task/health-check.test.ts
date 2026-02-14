import { describe, test, expect } from 'bun:test';
import { getClaudeVersion } from '../task/health-check';

describe('health-check', () => {
  test('getClaudeVersion returns object with version string', () => {
    const result = getClaudeVersion();
    expect(typeof result.version).toBe('string');
    if (result.error) {
      expect(typeof result.error).toBe('string');
    }
  });

  test('getClaudeVersion returns version when claude CLI is available', () => {
    const result = getClaudeVersion();
    if (result.error) {
      console.log('Claude CLI not available, skipping:', result.error);
      expect(result.version).toBe('');
    } else {
      expect(result.version).toBeTruthy();
      expect(result.version.length).toBeGreaterThan(0);
    }
  });
});
