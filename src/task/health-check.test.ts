import { describe, test, expect } from 'bun:test';
import { getClaudeVersion, runHealthCheck } from '../task/health-check';

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

  test('runHealthCheck returns passed=true when claude CLI is available', () => {
    const result = runHealthCheck();
    if (result.errors.length > 0) {
      console.log('Claude CLI not available, skipping:', result.errors);
      expect(result.passed).toBe(false);
    } else {
      expect(result.passed).toBe(true);
    }
  }, 35_000);

  test('runHealthCheck returns empty errors array on success', () => {
    const result = runHealthCheck();
    expect(Array.isArray(result.errors)).toBe(true);
    if (result.passed) {
      expect(result.errors).toEqual([]);
    }
  }, 35_000);

  test('getClaudeVersion returns version string with dot (version format)', () => {
    const result = getClaudeVersion();
    if (result.error) {
      console.log('Claude CLI not available, skipping:', result.error);
      expect(result.version).toBe('');
    } else {
      expect(result.version).toContain('.');
    }
  });

  test('runHealthCheck result includes claudeVersion field', () => {
    const result = runHealthCheck();
    expect('claudeVersion' in result).toBe(true);
    expect(typeof result.claudeVersion).toBe('string');
  }, 35_000);
});
