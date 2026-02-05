/**
 * Test Coverage Tracker - Phase 3: Autopilot CI
 *
 * Purpose: Track which accident patterns are covered by Golden Tests
 * Identify gaps and recommend new tests
 */

import type {
  AccidentPattern,
  GoldenTest,
  TestCoverageMetrics,
} from './golden-test-types';

export class TestCoverageTracker {
  private readonly MEMORY_GATEWAY_URL: string;

  constructor(memoryGatewayUrl: string) {
    this.MEMORY_GATEWAY_URL = memoryGatewayUrl;
  }

  /**
   * Calculate test coverage metrics
   */
  async calculateCoverage(
    allPatterns: AccidentPattern[],
    allTests: GoldenTest[]
  ): Promise<TestCoverageMetrics> {
    console.log('[TestCoverageTracker] Calculating coverage metrics...');

    // Build pattern coverage map
    const coveredPatternIds = new Set(
      allTests.map((test) => test.accident_pattern_id).filter(Boolean)
    );

    // Overall coverage
    const totalPatterns = allPatterns.length;
    const coveredPatterns = allPatterns.filter((p) =>
      coveredPatternIds.has(p.pattern_id)
    ).length;
    const coveragePercentage =
      totalPatterns > 0 ? (coveredPatterns / totalPatterns) * 100 : 0;

    // Coverage by severity
    const bySeverity = {
      critical: this.calculateSeverityCoverage(allPatterns, coveredPatternIds, 'critical'),
      high: this.calculateSeverityCoverage(allPatterns, coveredPatternIds, 'high'),
      medium: this.calculateSeverityCoverage(allPatterns, coveredPatternIds, 'medium'),
      low: this.calculateSeverityCoverage(allPatterns, coveredPatternIds, 'low'),
    };

    // Uncovered patterns
    const uncoveredPatterns = allPatterns.filter(
      (p) => !coveredPatternIds.has(p.pattern_id)
    );

    // Recommend new tests (prioritize high severity uncovered patterns)
    const recommendedNewTests = uncoveredPatterns
      .filter((p) => p.severity === 'critical' || p.severity === 'high')
      .sort((a, b) => {
        // Sort by severity (critical > high) and then by occurrence count
        const severities = ['critical', 'high', 'medium', 'low'];
        const aSeverity = severities.indexOf(a.severity);
        const bSeverity = severities.indexOf(b.severity);
        if (aSeverity !== bSeverity) {
          return aSeverity - bSeverity;
        }
        return b.occurrence_count - a.occurrence_count;
      })
      .slice(0, 5) // Top 5 recommendations
      .map((p) => `[${p.severity}] ${p.title} (occurred ${p.occurrence_count}x)`);

    const metrics: TestCoverageMetrics = {
      total_accident_patterns: totalPatterns,
      covered_accident_patterns: coveredPatterns,
      coverage_percentage: Math.round(coveragePercentage * 10) / 10,
      critical_covered: bySeverity.critical.covered,
      critical_total: bySeverity.critical.total,
      high_covered: bySeverity.high.covered,
      high_total: bySeverity.high.total,
      medium_covered: bySeverity.medium.covered,
      medium_total: bySeverity.medium.total,
      low_covered: bySeverity.low.covered,
      low_total: bySeverity.low.total,
      uncovered_patterns: uncoveredPatterns,
      recommended_new_tests: recommendedNewTests,
      calculated_at: new Date().toISOString(),
    };

    console.log(`[TestCoverageTracker] Coverage: ${metrics.coverage_percentage}% (${coveredPatterns}/${totalPatterns})`);

    return metrics;
  }

  /**
   * Calculate coverage for specific severity
   */
  private calculateSeverityCoverage(
    allPatterns: AccidentPattern[],
    coveredPatternIds: Set<string>,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): { covered: number; total: number } {
    const patternsOfSeverity = allPatterns.filter((p) => p.severity === severity);
    const total = patternsOfSeverity.length;
    const covered = patternsOfSeverity.filter((p) =>
      coveredPatternIds.has(p.pattern_id)
    ).length;

    return { covered, total };
  }

  /**
   * Generate coverage report (human-readable)
   */
  generateCoverageReport(metrics: TestCoverageMetrics): string {
    let report = `# Golden Test Coverage Report\n\n`;
    report += `**Generated:** ${metrics.calculated_at}\n\n`;

    // Overall coverage
    report += `## Overall Coverage\n\n`;
    report += `- **Coverage:** ${metrics.coverage_percentage}% (${metrics.covered_accident_patterns}/${metrics.total_accident_patterns} patterns)\n\n`;

    // Coverage by severity
    report += `## Coverage by Severity\n\n`;
    report += `| Severity | Covered | Total | Percentage |\n`;
    report += `|----------|---------|-------|------------|\n`;

    const severities: Array<'critical' | 'high' | 'medium' | 'low'> = [
      'critical',
      'high',
      'medium',
      'low',
    ];

    for (const severity of severities) {
      const covered =
        severity === 'critical'
          ? metrics.critical_covered
          : severity === 'high'
            ? metrics.high_covered
            : severity === 'medium'
              ? metrics.medium_covered
              : metrics.low_covered;

      const total =
        severity === 'critical'
          ? metrics.critical_total
          : severity === 'high'
            ? metrics.high_total
            : severity === 'medium'
              ? metrics.medium_total
              : metrics.low_total;

      const percentage = total > 0 ? Math.round((covered / total) * 100) : 0;

      report += `| **${severity.toUpperCase()}** | ${covered} | ${total} | ${percentage}% |\n`;
    }

    report += `\n`;

    // Gaps (uncovered critical/high)
    const criticalGaps = metrics.uncovered_patterns.filter(
      (p) => p.severity === 'critical'
    );
    const highGaps = metrics.uncovered_patterns.filter((p) => p.severity === 'high');

    if (criticalGaps.length > 0 || highGaps.length > 0) {
      report += `## ⚠️ Coverage Gaps\n\n`;

      if (criticalGaps.length > 0) {
        report += `### Critical Severity (URGENT)\n\n`;
        for (const pattern of criticalGaps.slice(0, 5)) {
          report += `- **${pattern.title}** (occurred ${pattern.occurrence_count}x)\n`;
          report += `  - Pattern ID: ${pattern.pattern_id}\n`;
          report += `  - Blast Radius: ${pattern.blast_radius}\n\n`;
        }
      }

      if (highGaps.length > 0) {
        report += `### High Severity\n\n`;
        for (const pattern of highGaps.slice(0, 5)) {
          report += `- **${pattern.title}** (occurred ${pattern.occurrence_count}x)\n`;
          report += `  - Pattern ID: ${pattern.pattern_id}\n`;
          report += `  - Blast Radius: ${pattern.blast_radius}\n\n`;
        }
      }
    }

    // Recommendations
    if (metrics.recommended_new_tests.length > 0) {
      report += `## 🎯 Recommended New Tests\n\n`;
      for (const recommendation of metrics.recommended_new_tests) {
        report += `- ${recommendation}\n`;
      }
      report += `\n`;
    }

    // Summary
    report += `## Summary\n\n`;
    if (metrics.coverage_percentage >= 90) {
      report += `✅ **Excellent coverage!** Continue monitoring for new patterns.\n`;
    } else if (metrics.coverage_percentage >= 70) {
      report += `⚠️ **Good coverage, but gaps remain.** Focus on critical/high severity patterns.\n`;
    } else if (metrics.coverage_percentage >= 50) {
      report += `⚠️ **Moderate coverage.** Significant gaps exist, especially in critical/high severity.\n`;
    } else {
      report += `🚨 **Poor coverage.** Urgent action needed to cover critical accident patterns.\n`;
    }

    return report;
  }

  /**
   * Store coverage metrics in Memory Gateway
   */
  async storeCoverageMetrics(metrics: TestCoverageMetrics): Promise<void> {
    try {
      await fetch(`${this.MEMORY_GATEWAY_URL}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: `private/jarvis/golden_tests/coverage`,
          type: 'coverage_metrics',
          title: `Test Coverage: ${metrics.coverage_percentage}% (${metrics.calculated_at})`,
          content: JSON.stringify(metrics, null, 2),
          tags: ['coverage', 'metrics', 'golden_tests'],
          importance: metrics.coverage_percentage < 70 ? 7 : 5,
          pin: metrics.coverage_percentage < 50,
          source_agent: 'jarvis',
        }),
      });

      console.log('[TestCoverageTracker] Stored coverage metrics');
    } catch (error) {
      console.error('[TestCoverageTracker] Failed to store coverage metrics:', error);
    }
  }

  /**
   * Get coverage trend (compare with previous metrics)
   */
  async getCoverageTrend(): Promise<{
    current: number;
    previous: number;
    change: number;
    trend: 'improving' | 'declining' | 'stable';
  }> {
    try {
      // Query last 2 coverage metrics
      const response = await fetch(
        `${this.MEMORY_GATEWAY_URL}/v1/memory/query?` +
          `scope=private/jarvis/golden_tests/coverage&` +
          `type=coverage_metrics&` +
          `limit=2`
      );

      if (!response.ok) {
        throw new Error('Failed to query coverage history');
      }

      const data = await response.json();
      const items = data.items || [];

      if (items.length < 2) {
        return {
          current: 0,
          previous: 0,
          change: 0,
          trend: 'stable',
        };
      }

      const current = JSON.parse(items[0].content).coverage_percentage;
      const previous = JSON.parse(items[1].content).coverage_percentage;
      const change = current - previous;

      const trend =
        Math.abs(change) < 1 ? 'stable' : change > 0 ? 'improving' : 'declining';

      return { current, previous, change, trend };
    } catch (error) {
      console.error('[TestCoverageTracker] Failed to get coverage trend:', error);
      return {
        current: 0,
        previous: 0,
        change: 0,
        trend: 'stable',
      };
    }
  }

  /**
   * Generate coverage warning (if coverage drops or critical gaps exist)
   */
  async generateCoverageWarning(metrics: TestCoverageMetrics): Promise<string | null> {
    // Check for critical gaps
    const criticalGaps = metrics.uncovered_patterns.filter(
      (p) => p.severity === 'critical'
    );

    if (criticalGaps.length > 0) {
      return (
        `🚨 **CRITICAL COVERAGE GAP**\n\n` +
        `${criticalGaps.length} critical accident pattern(s) are NOT covered by Golden Tests!\n\n` +
        `Uncovered critical patterns:\n` +
        criticalGaps
          .slice(0, 3)
          .map((p) => `- ${p.title} (occurred ${p.occurrence_count}x)`)
          .join('\n') +
        (criticalGaps.length > 3 ? `\n- ...and ${criticalGaps.length - 3} more` : '')
      );
    }

    // Check coverage trend
    const trend = await this.getCoverageTrend();
    if (trend.trend === 'declining' && trend.change < -10) {
      return (
        `⚠️ **COVERAGE DECLINING**\n\n` +
        `Test coverage dropped from ${trend.previous.toFixed(1)}% to ${trend.current.toFixed(1)}%.\n` +
        `Review recently added accident patterns and ensure they have Golden Tests.`
      );
    }

    // No warning needed
    return null;
  }
}
