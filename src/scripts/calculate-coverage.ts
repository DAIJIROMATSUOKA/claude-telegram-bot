#!/usr/bin/env bun
/**
 * Calculate Test Coverage Script
 *
 * Calculates Golden Test coverage percentage and outputs it to stdout
 * Used by CI/CD pipeline and pre-commit hooks
 */

import { TestCoverageTracker } from '../autopilot/test-coverage-tracker';
import { AccidentPatternExtractor } from '../autopilot/accident-pattern-extractor';

const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

async function main() {
  try {
    const tracker = new TestCoverageTracker(MEMORY_GATEWAY_URL);
    const extractor = new AccidentPatternExtractor(MEMORY_GATEWAY_URL);

    // Load accident patterns from Memory Gateway
    const patterns = await extractor.extractFromMemoryGateway();

    // Load Golden Tests (mocked for now - replace with actual loading)
    const tests: any[] = []; // TODO: Load from storage

    // Calculate coverage
    const metrics = await tracker.calculateCoverage(patterns, tests);

    // Output coverage percentage (for CI/CD scripts)
    console.log(metrics.coverage_percentage);

    // Output detailed report (stderr for logging, stdout for scripts)
    console.error(`
📊 Test Coverage Report
========================
Overall Coverage: ${metrics.coverage_percentage}%
Covered Patterns: ${metrics.covered_accident_patterns}/${metrics.total_accident_patterns}

By Severity:
  Critical: ${metrics.critical_covered}/${metrics.critical_total} (${metrics.critical_total > 0 ? Math.round((metrics.critical_covered / metrics.critical_total) * 100) : 0}%)
  High:     ${metrics.high_covered}/${metrics.high_total} (${metrics.high_total > 0 ? Math.round((metrics.high_covered / metrics.high_total) * 100) : 0}%)
  Medium:   ${metrics.medium_covered}/${metrics.medium_total} (${metrics.medium_total > 0 ? Math.round((metrics.medium_covered / metrics.medium_total) * 100) : 0}%)
  Low:      ${metrics.low_covered}/${metrics.low_total} (${metrics.low_total > 0 ? Math.round((metrics.low_covered / metrics.low_total) * 100) : 0}%)
`);

    // Store metrics in Memory Gateway
    await tracker.storeCoverageMetrics(metrics);

    // Exit with status based on threshold
    const threshold = 70;
    if (metrics.coverage_percentage < threshold) {
      console.error(`⚠️  Coverage (${metrics.coverage_percentage}%) is below threshold (${threshold}%)`);
      process.exit(0); // Warning only, don't fail
    }

    process.exit(0);
  } catch (error) {
    console.error('Error calculating coverage:', error);
    process.exit(1);
  }
}

main();
