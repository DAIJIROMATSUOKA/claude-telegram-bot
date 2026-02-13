/**
 * Unit tests for TestSelectionEngine
 *
 * Tests the 3-axis scoring formula (Severity 50% + Blast Radius 30% + Frequency 20%)
 * for selecting and prioritizing Golden Tests from AccidentPattern data.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { TestSelectionEngine } from '../autopilot/test-selection-engine';
import type { AccidentPattern, TestSelectionCriteria } from '../autopilot/golden-test-types';

/**
 * Helper to create mock AccidentPattern
 */
function createMockPattern(overrides: Partial<AccidentPattern> = {}): AccidentPattern {
  const defaults: AccidentPattern = {
    pattern_id: `pattern-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Pattern',
    description: 'A test accident pattern',
    severity: 'medium',
    blast_radius: 'file',
    first_occurred_at: new Date().toISOString(),
    last_occurred_at: new Date().toISOString(),
    occurrence_count: 1,
    root_cause: 'Test root cause',
    trigger_conditions: ['condition1', 'condition2'],
    conversation_ids: ['conv-1'],
    extracted_from: 'manual_report',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return { ...defaults, ...overrides };
}

describe('TestSelectionEngine', () => {
  let engine: TestSelectionEngine;

  beforeEach(() => {
    engine = new TestSelectionEngine();
  });

  describe('calculateSelectionScore', () => {
    it('calculates score using 3-axis formula: Severity 50% + Blast Radius 30% + Frequency 20%', () => {
      // Critical severity (1.0), system blast radius (1.0), max frequency (1.0)
      const pattern = createMockPattern({
        pattern_id: 'test-critical',
        severity: 'critical',
        blast_radius: 'system',
        occurrence_count: 10,
      });
      const allPatterns = [pattern];

      const score = engine.calculateSelectionScore(pattern, allPatterns);

      // Expected: 1.0 * 0.5 + 1.0 * 0.3 + 1.0 * 0.2 = 1.0
      expect(score).toBe(1.0);
    });

    it('correctly scores severity axis: critical=1.0, high=0.75, medium=0.5, low=0.25', () => {
      const createPatternWithSeverity = (severity: 'critical' | 'high' | 'medium' | 'low') =>
        createMockPattern({
          pattern_id: `test-${severity}`,
          severity,
          blast_radius: 'file', // 0 blast radius score
          occurrence_count: 1,
        });

      const patterns = [
        createPatternWithSeverity('critical'),
        createPatternWithSeverity('high'),
        createPatternWithSeverity('medium'),
        createPatternWithSeverity('low'),
      ];

      // All have same frequency (1), so frequency score = 1/1 = 1.0 for all
      // blast_radius = file = 0
      // score = severity * 0.5 + 0 * 0.3 + 1.0 * 0.2

      const criticalScore = engine.calculateSelectionScore(patterns[0], patterns);
      const highScore = engine.calculateSelectionScore(patterns[1], patterns);
      const mediumScore = engine.calculateSelectionScore(patterns[2], patterns);
      const lowScore = engine.calculateSelectionScore(patterns[3], patterns);

      expect(criticalScore).toBeCloseTo(1.0 * 0.5 + 0 + 0.2, 5); // 0.7
      expect(highScore).toBeCloseTo(0.75 * 0.5 + 0 + 0.2, 5);    // 0.575
      expect(mediumScore).toBeCloseTo(0.5 * 0.5 + 0 + 0.2, 5);   // 0.45
      expect(lowScore).toBeCloseTo(0.25 * 0.5 + 0 + 0.2, 5);     // 0.325
    });

    it('correctly scores blast radius axis: system=1.0, project=0.67, directory=0.33, file=0.0', () => {
      const createPatternWithBlastRadius = (blast_radius: 'system' | 'project' | 'directory' | 'file') =>
        createMockPattern({
          pattern_id: `test-${blast_radius}`,
          severity: 'low', // 0.25 severity score
          blast_radius,
          occurrence_count: 1,
        });

      const patterns = [
        createPatternWithBlastRadius('system'),
        createPatternWithBlastRadius('project'),
        createPatternWithBlastRadius('directory'),
        createPatternWithBlastRadius('file'),
      ];

      // severity = low = 0.25, frequency = 1.0 (all same count)
      // score = 0.25 * 0.5 + blast_radius * 0.3 + 1.0 * 0.2

      const systemScore = engine.calculateSelectionScore(patterns[0], patterns);
      const projectScore = engine.calculateSelectionScore(patterns[1], patterns);
      const directoryScore = engine.calculateSelectionScore(patterns[2], patterns);
      const fileScore = engine.calculateSelectionScore(patterns[3], patterns);

      expect(systemScore).toBeCloseTo(0.125 + 1.0 * 0.3 + 0.2, 5);     // 0.625
      expect(projectScore).toBeCloseTo(0.125 + 0.67 * 0.3 + 0.2, 5);   // 0.526
      expect(directoryScore).toBeCloseTo(0.125 + 0.33 * 0.3 + 0.2, 5); // 0.424
      expect(fileScore).toBeCloseTo(0.125 + 0 + 0.2, 5);               // 0.325
    });

    it('correctly scores frequency axis: normalized occurrence count', () => {
      const patternLow = createMockPattern({
        pattern_id: 'test-low-freq',
        severity: 'low',
        blast_radius: 'file',
        occurrence_count: 2,
      });
      const patternHigh = createMockPattern({
        pattern_id: 'test-high-freq',
        severity: 'low',
        blast_radius: 'file',
        occurrence_count: 10,
      });

      const allPatterns = [patternLow, patternHigh];

      // severity = 0.25, blast_radius = 0
      // frequency for low: 2/10 = 0.2
      // frequency for high: 10/10 = 1.0

      const lowFreqScore = engine.calculateSelectionScore(patternLow, allPatterns);
      const highFreqScore = engine.calculateSelectionScore(patternHigh, allPatterns);

      expect(lowFreqScore).toBeCloseTo(0.25 * 0.5 + 0 + 0.2 * 0.2, 5);  // 0.165
      expect(highFreqScore).toBeCloseTo(0.25 * 0.5 + 0 + 1.0 * 0.2, 5); // 0.325
    });

    it('clamps score to [0, 1] range', () => {
      const pattern = createMockPattern({
        severity: 'critical',
        blast_radius: 'system',
        occurrence_count: 100,
      });

      const score = engine.calculateSelectionScore(pattern, [pattern]);

      expect(score).toBeLessThanOrEqual(1.0);
      expect(score).toBeGreaterThanOrEqual(0.0);
    });

    it('handles zero max occurrences', () => {
      const pattern = createMockPattern({
        occurrence_count: 0,
      });

      const score = engine.calculateSelectionScore(pattern, [pattern]);

      // frequency score should be 0 when max occurrences is 0
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('selectGoldenTests', () => {
    it('returns selected patterns sorted by score descending', () => {
      const lowPattern = createMockPattern({
        pattern_id: 'low-score',
        severity: 'low',
        blast_radius: 'file',
        occurrence_count: 2,
      });
      const highPattern = createMockPattern({
        pattern_id: 'high-score',
        severity: 'critical',
        blast_radius: 'system',
        occurrence_count: 10,
      });
      const mediumPattern = createMockPattern({
        pattern_id: 'medium-score',
        severity: 'medium',
        blast_radius: 'project',
        occurrence_count: 5,
      });

      const patterns = [lowPattern, highPattern, mediumPattern];
      const { selected, scores } = engine.selectGoldenTests(patterns);

      // Verify sorted by score descending
      for (let i = 0; i < selected.length - 1; i++) {
        const scoreA = scores.get(selected[i].pattern_id) || 0;
        const scoreB = scores.get(selected[i + 1].pattern_id) || 0;
        expect(scoreA).toBeGreaterThanOrEqual(scoreB);
      }

      // High score pattern should be first
      expect(selected[0].pattern_id).toBe('high-score');
    });

    it('filters patterns below minimum_score threshold', () => {
      const engine = new TestSelectionEngine({
        minimum_score: 0.8,
        force_include_severity: [], // Disable force include to test threshold
        exclude_low_frequency: false,
      });

      const lowScorePattern = createMockPattern({
        pattern_id: 'low-score',
        severity: 'low',
        blast_radius: 'file',
        occurrence_count: 1,
      });
      const highScorePattern = createMockPattern({
        pattern_id: 'high-score',
        severity: 'critical',
        blast_radius: 'system',
        occurrence_count: 10,
      });

      const { selected, rejected } = engine.selectGoldenTests([lowScorePattern, highScorePattern]);

      expect(selected.some(p => p.pattern_id === 'high-score')).toBe(true);
      expect(rejected.some(p => p.pattern_id === 'low-score')).toBe(true);
    });

    it('force includes critical and high severity patterns', () => {
      const engine = new TestSelectionEngine({
        minimum_score: 1.0, // Very high threshold
        force_include_severity: ['critical', 'high'],
        exclude_low_frequency: false,
      });

      const criticalPattern = createMockPattern({
        pattern_id: 'critical',
        severity: 'critical',
        blast_radius: 'file',
        occurrence_count: 1,
      });
      const highPattern = createMockPattern({
        pattern_id: 'high',
        severity: 'high',
        blast_radius: 'file',
        occurrence_count: 1,
      });
      const lowPattern = createMockPattern({
        pattern_id: 'low',
        severity: 'low',
        blast_radius: 'file',
        occurrence_count: 1,
      });

      const { selected } = engine.selectGoldenTests([criticalPattern, highPattern, lowPattern]);

      // Critical and high should be force included despite not meeting threshold
      expect(selected.some(p => p.pattern_id === 'critical')).toBe(true);
      expect(selected.some(p => p.pattern_id === 'high')).toBe(true);
    });

    it('excludes low frequency patterns when enabled', () => {
      const engine = new TestSelectionEngine({
        minimum_score: 0.0,
        force_include_severity: [],
        exclude_low_frequency: true,
      });

      const oneTimePattern = createMockPattern({
        pattern_id: 'one-time',
        severity: 'medium',
        occurrence_count: 1, // Single occurrence
      });
      const frequentPattern = createMockPattern({
        pattern_id: 'frequent',
        severity: 'medium',
        occurrence_count: 5,
      });

      const { selected, rejected } = engine.selectGoldenTests([oneTimePattern, frequentPattern]);

      expect(selected.some(p => p.pattern_id === 'frequent')).toBe(true);
      expect(rejected.some(p => p.pattern_id === 'one-time')).toBe(true);
    });

    it('respects maximum_tests limit', () => {
      const engine = new TestSelectionEngine({
        maximum_tests: 3,
        minimum_score: 0.0,
        force_include_severity: [],
        exclude_low_frequency: false,
      });

      const patterns = Array.from({ length: 10 }, (_, i) =>
        createMockPattern({
          pattern_id: `pattern-${i}`,
          severity: 'critical',
          occurrence_count: i + 1,
        })
      );

      const { selected } = engine.selectGoldenTests(patterns);

      expect(selected.length).toBe(3);
    });

    it('handles empty patterns array', () => {
      const { selected, scores, rejected } = engine.selectGoldenTests([]);

      expect(selected).toEqual([]);
      expect(scores.size).toBe(0);
      expect(rejected).toEqual([]);
    });

    it('handles single pattern', () => {
      const pattern = createMockPattern({
        pattern_id: 'single',
        severity: 'critical',
        blast_radius: 'system',
        occurrence_count: 5,
      });

      const { selected, scores } = engine.selectGoldenTests([pattern]);

      expect(selected.length).toBe(1);
      expect(selected[0].pattern_id).toBe('single');
      expect(scores.has('single')).toBe(true);
    });

    it('handles all patterns with same score', () => {
      const patterns = Array.from({ length: 5 }, (_, i) =>
        createMockPattern({
          pattern_id: `pattern-${i}`,
          severity: 'medium',
          blast_radius: 'project',
          occurrence_count: 3,
        })
      );

      const { selected, scores } = engine.selectGoldenTests(patterns);

      // All should have same score
      const scoreValues = Array.from(scores.values());
      const firstScore = scoreValues[0];
      expect(scoreValues.every(s => Math.abs(s - firstScore) < 0.001)).toBe(true);

      // All should be selected (within default maximum_tests)
      expect(selected.length).toBe(5);
    });
  });

  describe('generateGoldenTest', () => {
    it('generates a GoldenTest from AccidentPattern with correct structure', () => {
      const pattern = createMockPattern({
        pattern_id: 'test-pattern',
        title: 'Test Accident',
        description: 'Something went wrong',
        severity: 'high',
        blast_radius: 'project',
        occurrence_count: 3,
        root_cause: 'Missing validation',
        trigger_conditions: ['condition A', 'condition B'],
      });

      const test = engine.generateGoldenTest(pattern, 0.85);

      expect(test.test_id).toContain('test_test-pattern');
      expect(test.title).toBe('Prevent: Test Accident');
      expect(test.description).toContain('Something went wrong');
      expect(test.severity).toBe('high');
      expect(test.blast_radius).toBe('project');
      expect(test.frequency).toBe(3);
      expect(test.selection_score).toBe(0.85);
      expect(test.accident_pattern_id).toBe('test-pattern');
    });

    it('extracts Given-When-Then test structure from pattern', () => {
      const pattern = createMockPattern({
        trigger_conditions: ['user input', 'network timeout'],
        root_cause: 'Race condition in async handler',
        description: 'Data corruption occurred',
      });

      const test = engine.generateGoldenTest(pattern, 0.5);

      expect(test.given).toContain('user input');
      expect(test.given).toContain('network timeout');
      expect(test.when).toContain('Race condition in async handler');
      expect(test.then).toContain('Data corruption occurred');
    });

    it('handles empty trigger conditions', () => {
      const pattern = createMockPattern({
        trigger_conditions: [],
        root_cause: 'Unknown cause',
      });

      const test = engine.generateGoldenTest(pattern, 0.5);

      expect(test.given).toContain('Normal operating conditions');
    });

    it('determines kill switch threshold based on severity', () => {
      const criticalPattern = createMockPattern({ severity: 'critical' });
      const highPattern = createMockPattern({ severity: 'high' });
      const mediumPattern = createMockPattern({ severity: 'medium' });
      const lowPattern = createMockPattern({ severity: 'low' });

      const criticalTest = engine.generateGoldenTest(criticalPattern, 0.9);
      const highTest = engine.generateGoldenTest(highPattern, 0.8);
      const mediumTest = engine.generateGoldenTest(mediumPattern, 0.6);
      const lowTest = engine.generateGoldenTest(lowPattern, 0.4);

      expect(criticalTest.kill_switch_threshold).toBe('immediate');
      expect(highTest.kill_switch_threshold).toBe('delayed');
      expect(mediumTest.kill_switch_threshold).toBe('delayed');
      expect(lowTest.kill_switch_threshold).toBe('warning');
    });

    it('includes generated test function code', () => {
      const pattern = createMockPattern({
        pattern_id: 'func-test',
        title: 'Function Test Pattern',
        root_cause: 'Memory leak',
      });

      const test = engine.generateGoldenTest(pattern, 0.7);

      expect(test.test_function).toContain('Golden Test');
      expect(test.test_function).toContain('func-test');
      expect(test.test_function).toContain('Memory leak');
      expect(test.test_function).toContain('async function');
    });

    it('sets correct default values and metadata', () => {
      const pattern = createMockPattern({ severity: 'medium' });

      const test = engine.generateGoldenTest(pattern, 0.6);

      expect(test.timeout_ms).toBe(30000);
      expect(test.flaky_status).toBe('stable');
      expect(test.failure_count).toBe(0);
      expect(test.retry_count).toBe(0);
      expect(test.times_prevented).toBe(0);
      expect(test.source).toBe('conversation_log');
      expect(test.tags).toContain('golden_test');
      expect(test.tags).toContain('medium');
      expect(test.created_at).toBeDefined();
    });
  });

  describe('getCriteria / updateCriteria', () => {
    it('returns default criteria', () => {
      const criteria = engine.getCriteria();

      expect(criteria.severity_weight).toBe(0.5);
      expect(criteria.blast_radius_weight).toBe(0.3);
      expect(criteria.frequency_weight).toBe(0.2);
      expect(criteria.minimum_score).toBe(0.6);
      expect(criteria.maximum_tests).toBe(20);
      expect(criteria.force_include_severity).toContain('critical');
      expect(criteria.force_include_severity).toContain('high');
      expect(criteria.exclude_low_frequency).toBe(true);
    });

    it('allows custom criteria via constructor', () => {
      const customEngine = new TestSelectionEngine({
        severity_weight: 0.6,
        minimum_score: 0.8,
      });

      const criteria = customEngine.getCriteria();

      expect(criteria.severity_weight).toBe(0.6);
      expect(criteria.minimum_score).toBe(0.8);
      // Other defaults should remain
      expect(criteria.blast_radius_weight).toBe(0.3);
    });

    it('updates criteria dynamically', () => {
      engine.updateCriteria({ maximum_tests: 10 });

      const criteria = engine.getCriteria();
      expect(criteria.maximum_tests).toBe(10);
    });

    it('getCriteria returns a copy (not reference)', () => {
      const criteria = engine.getCriteria();
      criteria.maximum_tests = 999;

      const criteriaAgain = engine.getCriteria();
      expect(criteriaAgain.maximum_tests).toBe(20); // Original unchanged
    });
  });

  describe('edge cases and integration scenarios', () => {
    it('handles patterns with negative occurrence count', () => {
      const pattern = createMockPattern({
        occurrence_count: -1,
      });

      // Should not throw
      const score = engine.calculateSelectionScore(pattern, [pattern]);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('handles very large occurrence counts', () => {
      const pattern = createMockPattern({
        occurrence_count: Number.MAX_SAFE_INTEGER,
      });

      const score = engine.calculateSelectionScore(pattern, [pattern]);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('maintains consistent scoring across multiple calls', () => {
      const pattern = createMockPattern({
        severity: 'high',
        blast_radius: 'project',
        occurrence_count: 5,
      });
      const patterns = [pattern];

      const score1 = engine.calculateSelectionScore(pattern, patterns);
      const score2 = engine.calculateSelectionScore(pattern, patterns);
      const score3 = engine.calculateSelectionScore(pattern, patterns);

      expect(score1).toBe(score2);
      expect(score2).toBe(score3);
    });

    it('correctly separates selected and rejected patterns', () => {
      const patterns = Array.from({ length: 10 }, (_, i) =>
        createMockPattern({
          pattern_id: `pattern-${i}`,
          severity: i < 5 ? 'critical' : 'low',
          blast_radius: i < 5 ? 'system' : 'file',
          occurrence_count: i + 1,
        })
      );

      const { selected, rejected } = engine.selectGoldenTests(patterns);

      // No overlap between selected and rejected
      const selectedIds = new Set(selected.map(p => p.pattern_id));
      const rejectedIds = new Set(rejected.map(p => p.pattern_id));

      for (const id of selectedIds) {
        expect(rejectedIds.has(id)).toBe(false);
      }

      // All patterns accounted for
      expect(selected.length + rejected.length).toBe(patterns.length);
    });
  });
});
