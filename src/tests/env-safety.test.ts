/**
 * env-safety Test Suite
 *
 * Tests:
 * 1. TELEGRAM_BOT_TOKEN is either undefined or a non-empty string
 * 2. HOME environment variable is set
 */

import { describe, test, expect } from 'bun:test';

// ============================================================================
// Test Suite
// ============================================================================

describe('env-safety', () => {
  // ==========================================================================
  // 1. TELEGRAM_BOT_TOKEN validation
  // ==========================================================================

  describe('TELEGRAM_BOT_TOKEN', () => {
    test('should be either undefined or a non-empty string', () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;

      if (token === undefined) {
        // undefined is acceptable
        expect(token).toBeUndefined();
      } else {
        // If defined, must be a non-empty string
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // 2. HOME environment variable
  // ==========================================================================

  describe('HOME', () => {
    test('should be set', () => {
      const home = process.env.HOME;
      expect(home).toBeDefined();
      expect(typeof home).toBe('string');
      expect(home!.length).toBeGreaterThan(0);
    });
  });
});
