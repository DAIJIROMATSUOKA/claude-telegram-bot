/**
 * danger-detector Test Suite
 *
 * Tests:
 * 1. detectDangerousCommand returns isDangerous=false and level='safe' for any input
 * 2. getDangerEmoji returns correct emoji for each DangerLevel
 * 3. DangerResult type has correct shape
 */

import { describe, test, expect } from 'bun:test';
import {
  detectDangerousCommand,
  getDangerEmoji,
  type DangerLevel,
  type DangerResult,
} from '../utils/danger-detector';

// ============================================================================
// Test Suite
// ============================================================================

describe('danger-detector', () => {
  // ==========================================================================
  // 1. detectDangerousCommand returns isDangerous=false and level='safe'
  // ==========================================================================

  describe('detectDangerousCommand', () => {
    test('should return isDangerous=false for any command', () => {
      const result = detectDangerousCommand('rm -rf /');
      expect(result.isDangerous).toBe(false);
    });

    test('should return level="safe" for any command', () => {
      const result = detectDangerousCommand('sudo shutdown -h now');
      expect(result.level).toBe('safe');
    });

    test('should return needsApproval=false for any command', () => {
      const result = detectDangerousCommand('dd if=/dev/zero of=/dev/sda');
      expect(result.needsApproval).toBe(false);
    });

    test('should return empty matches array for any command', () => {
      const result = detectDangerousCommand('chmod 777 /');
      expect(result.matches).toEqual([]);
    });

    test('should handle empty string', () => {
      const result = detectDangerousCommand('');
      expect(result.isDangerous).toBe(false);
      expect(result.level).toBe('safe');
    });

    test('should handle normal commands', () => {
      const result = detectDangerousCommand('ls -la');
      expect(result.isDangerous).toBe(false);
      expect(result.level).toBe('safe');
    });
  });

  // ==========================================================================
  // 2. getDangerEmoji returns correct emoji for each DangerLevel
  // ==========================================================================

  describe('getDangerEmoji', () => {
    test('should return 🚨 for critical level', () => {
      expect(getDangerEmoji('critical')).toBe('🚨');
    });

    test('should return ⚠️ for high level', () => {
      expect(getDangerEmoji('high')).toBe('⚠️');
    });

    test('should return ⚡ for medium level', () => {
      expect(getDangerEmoji('medium')).toBe('⚡');
    });

    test('should return ✅ for safe level', () => {
      expect(getDangerEmoji('safe')).toBe('✅');
    });
  });

  // ==========================================================================
  // 3. DangerResult type has correct shape
  // ==========================================================================

  describe('DangerResult type shape', () => {
    test('should have all required properties', () => {
      const result: DangerResult = detectDangerousCommand('test');

      // Verify all properties exist and have correct types
      expect(typeof result.isDangerous).toBe('boolean');
      expect(typeof result.level).toBe('string');
      expect(typeof result.needsApproval).toBe('boolean');
      expect(Array.isArray(result.matches)).toBe(true);
    });

    test('should have level as valid DangerLevel', () => {
      const result = detectDangerousCommand('test');
      const validLevels: DangerLevel[] = ['safe', 'medium', 'high', 'critical'];
      expect(validLevels).toContain(result.level);
    });
  });
});
