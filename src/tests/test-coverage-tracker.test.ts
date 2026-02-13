/**
 * Unit tests for TestCoverageTracker class
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { TestCoverageTracker } from '../autopilot/test-coverage-tracker';
import type { AccidentPattern, GoldenTest, TestCoverageMetrics } from '../autopilot/golden-test-types';

// Mock fetch
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
);

const originalFetch = globalThis.fetch;

describe('TestCoverageTracker', () => {
  let tracker: TestCoverageTracker;
  const MOCK_GATEWAY_URL = 'http://localhost:8080';

  // Mock AccidentPatterns
  const createMockPattern = (
    id: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    occurrenceCount: number = 1
  ): AccidentPattern => ({
    pattern_id: id,
    title: `Pattern ${id}`,
    description: `Description for ${id}`,
    severity,
    blast_radius: 'file',
    first_occurred_at: '2025-01-01T00:00:00Z',
    last_occurred_at: '2025-01-15T00:00:00Z',
    occurrence_count: occurrenceCount,
    root_cause: 'Test root cause',
    trigger_conditions: ['condition1', 'condition2'],
    conversation_ids: ['conv1'],
    extracted_from: 'manual_report',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-15T00:00:00Z',
  });

  // Mock GoldenTests
  const createMockTest = (
    testId: string,
    patternId: string
  ): GoldenTest => ({
    test_id: testId,
    title: `Test ${testId}`,
    description: `Description for ${testId}`,
    severity: 'medium',
    blast_radius: 'file',
    frequency: 1,
    selection_score: 0.5,
    given: 'given state',
    when: 'action',
    then: 'expected',
    test_function: '() => true',
    timeout_ms: 5000,
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,
    kill_switch_threshold: 'delayed',
    accident_pattern_id: patternId,
    times_prevented: 0,
    created_at: '2025-01-01T00:00:00Z',
    source: 'manual',
    tags: ['test'],
  });

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockClear();
    tracker = new TestCoverageTracker(MOCK_GATEWAY_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('calculateCoverage', () => {
    test('calculates coverage_percentage correctly', async () => {
      const patterns = [
        createMockPattern('p1', 'critical'),
        createMockPattern('p2', 'high'),
        createMockPattern('p3', 'medium'),
        createMockPattern('p4', 'low'),
      ];

      const tests = [
        createMockTest('t1', 'p1'),
        createMockTest('t2', 'p2'),
      ];

      const metrics = await tracker.calculateCoverage(patterns, tests);

      expect(metrics.total_accident_patterns).toBe(4);
      expect(metrics.covered_accident_patterns).toBe(2);
      expect(metrics.coverage_percentage).toBe(50);
    });

    test('handles empty patterns', async () => {
      const metrics = await tracker.calculateCoverage([], []);

      expect(metrics.total_accident_patterns).toBe(0);
      expect(metrics.covered_accident_patterns).toBe(0);
      expect(metrics.coverage_percentage).toBe(0);
    });

    test('calculates severity breakdown correctly', async () => {
      const patterns = [
        createMockPattern('p1', 'critical'),
        createMockPattern('p2', 'critical'),
        createMockPattern('p3', 'high'),
        createMockPattern('p4', 'medium'),
        createMockPattern('p5', 'low'),
      ];

      const tests = [
        createMockTest('t1', 'p1'), // covers critical p1
        createMockTest('t2', 'p4'), // covers medium p4
      ];

      const metrics = await tracker.calculateCoverage(patterns, tests);

      expect(metrics.critical_covered).toBe(1);
      expect(metrics.critical_total).toBe(2);
      expect(metrics.high_covered).toBe(0);
      expect(metrics.high_total).toBe(1);
      expect(metrics.medium_covered).toBe(1);
      expect(metrics.medium_total).toBe(1);
      expect(metrics.low_covered).toBe(0);
      expect(metrics.low_total).toBe(1);
    });

    test('identifies coverage gaps (uncovered patterns)', async () => {
      const patterns = [
        createMockPattern('p1', 'critical', 5),
        createMockPattern('p2', 'high', 3),
        createMockPattern('p3', 'medium', 2),
      ];

      const tests = [createMockTest('t1', 'p1')]; // only p1 covered

      const metrics = await tracker.calculateCoverage(patterns, tests);

      expect(metrics.uncovered_patterns.length).toBe(2);
      expect(metrics.uncovered_patterns.map((p) => p.pattern_id)).toContain('p2');
      expect(metrics.uncovered_patterns.map((p) => p.pattern_id)).toContain('p3');
    });

    test('generates recommended_new_tests for critical/high uncovered patterns', async () => {
      const patterns = [
        createMockPattern('p1', 'critical', 10),
        createMockPattern('p2', 'high', 5),
        createMockPattern('p3', 'medium', 3),
        createMockPattern('p4', 'low', 1),
      ];

      const tests: GoldenTest[] = []; // no tests

      const metrics = await tracker.calculateCoverage(patterns, tests);

      // Should recommend critical and high, sorted by severity then occurrence
      expect(metrics.recommended_new_tests.length).toBe(2);
      expect(metrics.recommended_new_tests[0]).toContain('critical');
      expect(metrics.recommended_new_tests[0]).toContain('10x');
      expect(metrics.recommended_new_tests[1]).toContain('high');
    });

    test('sets calculated_at timestamp', async () => {
      const before = new Date().toISOString();
      const metrics = await tracker.calculateCoverage([], []);
      const after = new Date().toISOString();

      expect(metrics.calculated_at >= before).toBe(true);
      expect(metrics.calculated_at <= after).toBe(true);
    });
  });

  describe('calculateSeverityCoverage', () => {
    test('returns correct covered/total for each severity', async () => {
      const patterns = [
        createMockPattern('p1', 'critical'),
        createMockPattern('p2', 'critical'),
        createMockPattern('p3', 'critical'),
        createMockPattern('p4', 'high'),
        createMockPattern('p5', 'high'),
      ];

      // Cover 2 of 3 critical patterns
      const tests = [
        createMockTest('t1', 'p1'),
        createMockTest('t2', 'p2'),
      ];

      const metrics = await tracker.calculateCoverage(patterns, tests);

      expect(metrics.critical_covered).toBe(2);
      expect(metrics.critical_total).toBe(3);
      expect(metrics.high_covered).toBe(0);
      expect(metrics.high_total).toBe(2);
    });
  });

  describe('identifyCoverageGaps (via uncovered_patterns)', () => {
    test('returns uncovered patterns sorted by severity', async () => {
      const patterns = [
        createMockPattern('p1', 'low', 1),
        createMockPattern('p2', 'critical', 5),
        createMockPattern('p3', 'medium', 2),
        createMockPattern('p4', 'high', 3),
      ];

      const tests: GoldenTest[] = []; // no tests

      const metrics = await tracker.calculateCoverage(patterns, tests);

      // uncovered_patterns should contain all patterns
      expect(metrics.uncovered_patterns.length).toBe(4);

      // recommended_new_tests should prioritize critical > high
      expect(metrics.recommended_new_tests[0]).toContain('critical');
      expect(metrics.recommended_new_tests[1]).toContain('high');
    });
  });

  describe('storeCoverageMetrics', () => {
    test('calls fetch with correct payload', async () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 10,
        covered_accident_patterns: 8,
        coverage_percentage: 80,
        critical_covered: 2,
        critical_total: 2,
        high_covered: 3,
        high_total: 4,
        medium_covered: 2,
        medium_total: 3,
        low_covered: 1,
        low_total: 1,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      await tracker.storeCoverageMetrics(metrics);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${MOCK_GATEWAY_URL}/v1/memory/append`);
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.scope).toBe('private/jarvis/golden_tests/coverage');
      expect(body.type).toBe('coverage_metrics');
      expect(body.title).toContain('80%');
      expect(body.tags).toContain('coverage');
      expect(body.source_agent).toBe('jarvis');
    });

    test('sets importance=7 and pin=true for low coverage (<70%)', async () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 10,
        covered_accident_patterns: 4,
        coverage_percentage: 40,
        critical_covered: 0,
        critical_total: 2,
        high_covered: 1,
        high_total: 3,
        medium_covered: 2,
        medium_total: 3,
        low_covered: 1,
        low_total: 2,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      await tracker.storeCoverageMetrics(metrics);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.importance).toBe(7);
      expect(body.pin).toBe(true);
    });

    test('handles fetch error gracefully', async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

      // Should not throw
      await tracker.storeCoverageMetrics({
        total_accident_patterns: 0,
        covered_accident_patterns: 0,
        coverage_percentage: 0,
        critical_covered: 0,
        critical_total: 0,
        high_covered: 0,
        high_total: 0,
        medium_covered: 0,
        medium_total: 0,
        low_covered: 0,
        low_total: 0,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      });
    });
  });

  describe('getCoverageTrend', () => {
    test('returns stable trend with zeros when no data', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.current).toBe(0);
      expect(trend.previous).toBe(0);
      expect(trend.change).toBe(0);
      expect(trend.trend).toBe('stable');
    });

    test('returns stable trend when only one data point exists', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [{ content: JSON.stringify({ coverage_percentage: 75 }) }],
            }),
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.current).toBe(0);
      expect(trend.previous).toBe(0);
      expect(trend.trend).toBe('stable');
    });

    test('calculates improving trend correctly', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                { content: JSON.stringify({ coverage_percentage: 85 }) },
                { content: JSON.stringify({ coverage_percentage: 70 }) },
              ],
            }),
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.current).toBe(85);
      expect(trend.previous).toBe(70);
      expect(trend.change).toBe(15);
      expect(trend.trend).toBe('improving');
    });

    test('calculates declining trend correctly', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                { content: JSON.stringify({ coverage_percentage: 60 }) },
                { content: JSON.stringify({ coverage_percentage: 80 }) },
              ],
            }),
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.current).toBe(60);
      expect(trend.previous).toBe(80);
      expect(trend.change).toBe(-20);
      expect(trend.trend).toBe('declining');
    });

    test('returns stable trend for small changes (<1%)', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                { content: JSON.stringify({ coverage_percentage: 75.5 }) },
                { content: JSON.stringify({ coverage_percentage: 75 }) },
              ],
            }),
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.change).toBe(0.5);
      expect(trend.trend).toBe('stable');
    });

    test('handles fetch error gracefully', async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

      const trend = await tracker.getCoverageTrend();

      expect(trend.current).toBe(0);
      expect(trend.previous).toBe(0);
      expect(trend.change).toBe(0);
      expect(trend.trend).toBe('stable');
    });

    test('handles non-ok response', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        })
      );

      const trend = await tracker.getCoverageTrend();

      expect(trend.trend).toBe('stable');
    });
  });

  describe('generateCoverageWarning', () => {
    test('returns critical gap warning when uncovered critical patterns exist', async () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 5,
        covered_accident_patterns: 3,
        coverage_percentage: 60,
        critical_covered: 0,
        critical_total: 2,
        high_covered: 2,
        high_total: 2,
        medium_covered: 1,
        medium_total: 1,
        low_covered: 0,
        low_total: 0,
        uncovered_patterns: [
          createMockPattern('p1', 'critical', 5),
          createMockPattern('p2', 'critical', 3),
        ],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const warning = await tracker.generateCoverageWarning(metrics);

      expect(warning).not.toBeNull();
      expect(warning).toContain('CRITICAL COVERAGE GAP');
      expect(warning).toContain('2 critical');
    });

    test('returns declining coverage warning when trend drops >10%', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                { content: JSON.stringify({ coverage_percentage: 55 }) },
                { content: JSON.stringify({ coverage_percentage: 70 }) },
              ],
            }),
        })
      );

      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 5,
        covered_accident_patterns: 3,
        coverage_percentage: 55,
        critical_covered: 1,
        critical_total: 1,
        high_covered: 1,
        high_total: 1,
        medium_covered: 1,
        medium_total: 2,
        low_covered: 0,
        low_total: 1,
        uncovered_patterns: [
          createMockPattern('p1', 'medium', 2),
          createMockPattern('p2', 'low', 1),
        ],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const warning = await tracker.generateCoverageWarning(metrics);

      expect(warning).not.toBeNull();
      expect(warning).toContain('COVERAGE DECLINING');
      expect(warning).toContain('70.0%');
      expect(warning).toContain('55.0%');
    });

    test('returns null when no warnings needed', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                { content: JSON.stringify({ coverage_percentage: 90 }) },
                { content: JSON.stringify({ coverage_percentage: 88 }) },
              ],
            }),
        })
      );

      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 5,
        covered_accident_patterns: 5,
        coverage_percentage: 90,
        critical_covered: 1,
        critical_total: 1,
        high_covered: 2,
        high_total: 2,
        medium_covered: 1,
        medium_total: 1,
        low_covered: 1,
        low_total: 1,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const warning = await tracker.generateCoverageWarning(metrics);

      expect(warning).toBeNull();
    });

    test('prioritizes critical gap warning over declining trend', async () => {
      // Even if trend is declining, critical gaps should be shown first
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 5,
        covered_accident_patterns: 2,
        coverage_percentage: 40,
        critical_covered: 0,
        critical_total: 1,
        high_covered: 1,
        high_total: 2,
        medium_covered: 1,
        medium_total: 1,
        low_covered: 0,
        low_total: 1,
        uncovered_patterns: [createMockPattern('p1', 'critical', 10)],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const warning = await tracker.generateCoverageWarning(metrics);

      expect(warning).toContain('CRITICAL COVERAGE GAP');
      expect(warning).not.toContain('DECLINING');
    });

    test('shows up to 3 critical patterns with ellipsis for more', async () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 5,
        covered_accident_patterns: 0,
        coverage_percentage: 0,
        critical_covered: 0,
        critical_total: 5,
        high_covered: 0,
        high_total: 0,
        medium_covered: 0,
        medium_total: 0,
        low_covered: 0,
        low_total: 0,
        uncovered_patterns: [
          createMockPattern('p1', 'critical', 5),
          createMockPattern('p2', 'critical', 4),
          createMockPattern('p3', 'critical', 3),
          createMockPattern('p4', 'critical', 2),
          createMockPattern('p5', 'critical', 1),
        ],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const warning = await tracker.generateCoverageWarning(metrics);

      expect(warning).toContain('5 critical');
      expect(warning).toContain('...and 2 more');
    });
  });

  describe('generateCoverageReport', () => {
    test('generates markdown report with all sections', () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 10,
        covered_accident_patterns: 7,
        coverage_percentage: 70,
        critical_covered: 2,
        critical_total: 2,
        high_covered: 3,
        high_total: 4,
        medium_covered: 1,
        medium_total: 2,
        low_covered: 1,
        low_total: 2,
        uncovered_patterns: [
          createMockPattern('p1', 'high', 5),
          createMockPattern('p2', 'medium', 3),
        ],
        recommended_new_tests: ['[high] Pattern p1 (occurred 5x)'],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const report = tracker.generateCoverageReport(metrics);

      expect(report).toContain('# Golden Test Coverage Report');
      expect(report).toContain('## Overall Coverage');
      expect(report).toContain('70%');
      expect(report).toContain('## Coverage by Severity');
      expect(report).toContain('CRITICAL');
      expect(report).toContain('HIGH');
      expect(report).toContain('MEDIUM');
      expect(report).toContain('LOW');
      expect(report).toContain('## ⚠️ Coverage Gaps');
      expect(report).toContain('## 🎯 Recommended New Tests');
      expect(report).toContain('## Summary');
    });

    test('shows excellent coverage message for 90%+', () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 10,
        covered_accident_patterns: 9,
        coverage_percentage: 90,
        critical_covered: 2,
        critical_total: 2,
        high_covered: 3,
        high_total: 3,
        medium_covered: 2,
        medium_total: 3,
        low_covered: 2,
        low_total: 2,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const report = tracker.generateCoverageReport(metrics);

      expect(report).toContain('✅ **Excellent coverage!**');
    });

    test('shows poor coverage message for <50%', () => {
      const metrics: TestCoverageMetrics = {
        total_accident_patterns: 10,
        covered_accident_patterns: 3,
        coverage_percentage: 30,
        critical_covered: 0,
        critical_total: 2,
        high_covered: 1,
        high_total: 3,
        medium_covered: 1,
        medium_total: 3,
        low_covered: 1,
        low_total: 2,
        uncovered_patterns: [],
        recommended_new_tests: [],
        calculated_at: '2025-01-15T10:00:00Z',
      };

      const report = tracker.generateCoverageReport(metrics);

      expect(report).toContain('🚨 **Poor coverage.**');
    });
  });
});
