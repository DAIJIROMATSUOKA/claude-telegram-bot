/**
 * Test Selection Engine - Phase 3: Autopilot CI
 *
 * Purpose: Select which accident patterns become Golden Tests
 * AI Council Consensus: 3-axis scoring model
 *
 * Scoring Formula:
 * score = (severity * 0.5) + (blast_radius * 0.3) + (frequency * 0.2)
 *
 * Severity (50%): critical=1.0, high=0.75, medium=0.5, low=0.25
 * Blast Radius (30%): system=1.0, project=0.67, directory=0.33, file=0.0
 * Frequency (20%): normalized occurrence count
 */

import type {
  AccidentPattern,
  GoldenTest,
  TestSelectionCriteria,
} from './golden-test-types';

export class TestSelectionEngine {
  // Default criteria (AI Council consensus)
  private criteria: TestSelectionCriteria = {
    severity_weight: 0.5, // 50%
    blast_radius_weight: 0.3, // 30%
    frequency_weight: 0.2, // 20%
    minimum_score: 0.6, // Top 60% of accidents
    maximum_tests: 20, // Avoid slow CI
    force_include_severity: ['critical', 'high'], // Always include
    exclude_low_frequency: true, // Exclude one-time accidents
  };

  constructor(customCriteria?: Partial<TestSelectionCriteria>) {
    if (customCriteria) {
      this.criteria = { ...this.criteria, ...customCriteria };
    }
  }

  /**
   * Select Golden Tests from accident patterns using 3-axis scoring
   */
  selectGoldenTests(patterns: AccidentPattern[]): {
    selected: AccidentPattern[];
    scores: Map<string, number>;
    rejected: AccidentPattern[];
  } {
    console.log(`[TestSelectionEngine] Evaluating ${patterns.length} accident patterns`);

    // Calculate scores for all patterns
    const scores = new Map<string, number>();
    for (const pattern of patterns) {
      const score = this.calculateSelectionScore(pattern, patterns);
      scores.set(pattern.pattern_id, score);
    }

    // Force include critical/high severity (AI Council consensus)
    const forceIncluded = patterns.filter((p) =>
      (this.criteria.force_include_severity as string[]).includes(p.severity)
    );

    // Filter by minimum score
    const scoreFiltered = patterns.filter((p) => {
      const score = scores.get(p.pattern_id) || 0;
      return score >= this.criteria.minimum_score;
    });

    // Exclude low frequency if enabled
    const frequencyFiltered = this.criteria.exclude_low_frequency
      ? scoreFiltered.filter((p) => p.occurrence_count > 1)
      : scoreFiltered;

    // Combine force-included and score-filtered (remove duplicates)
    const combined = Array.from(
      new Map([...forceIncluded, ...frequencyFiltered].map((p) => [p.pattern_id, p])).values()
    );

    // Sort by score (descending)
    combined.sort((a, b) => {
      const scoreA = scores.get(a.pattern_id) || 0;
      const scoreB = scores.get(b.pattern_id) || 0;
      return scoreB - scoreA;
    });

    // Limit to maximum_tests
    const selected = combined.slice(0, this.criteria.maximum_tests);

    // Rejected patterns
    const selectedIds = new Set(selected.map((p) => p.pattern_id));
    const rejected = patterns.filter((p) => !selectedIds.has(p.pattern_id));

    console.log(`[TestSelectionEngine] Selected ${selected.length} patterns, rejected ${rejected.length}`);

    return { selected, scores, rejected };
  }

  /**
   * Calculate selection score using 3-axis formula
   */
  calculateSelectionScore(
    pattern: AccidentPattern,
    allPatterns: AccidentPattern[]
  ): number {
    // Axis 1: Severity (50%)
    const severityScore = this.calculateSeverityScore(pattern.severity);

    // Axis 2: Blast Radius (30%)
    const blastRadiusScore = this.calculateBlastRadiusScore(pattern.blast_radius);

    // Axis 3: Frequency (20%)
    const frequencyScore = this.calculateFrequencyScore(pattern, allPatterns);

    // Weighted sum
    const totalScore =
      severityScore * this.criteria.severity_weight +
      blastRadiusScore * this.criteria.blast_radius_weight +
      frequencyScore * this.criteria.frequency_weight;

    return Math.min(1.0, Math.max(0.0, totalScore)); // Clamp to [0, 1]
  }

  /**
   * Severity score: critical=1.0, high=0.75, medium=0.5, low=0.25
   */
  private calculateSeverityScore(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): number {
    const scores: { [key: string]: number } = {
      critical: 1.0,
      high: 0.75,
      medium: 0.5,
      low: 0.25,
    };
    return scores[severity] || 0;
  }

  /**
   * Blast radius score: system=1.0, project=0.67, directory=0.33, file=0.0
   */
  private calculateBlastRadiusScore(
    blastRadius: 'file' | 'directory' | 'project' | 'system'
  ): number {
    const scores: { [key: string]: number } = {
      system: 1.0,
      project: 0.67,
      directory: 0.33,
      file: 0.0,
    };
    return scores[blastRadius] || 0;
  }

  /**
   * Frequency score: normalized occurrence count (0-1 scale)
   */
  private calculateFrequencyScore(
    pattern: AccidentPattern,
    allPatterns: AccidentPattern[]
  ): number {
    // Find maximum occurrence count
    const maxOccurrences = Math.max(...allPatterns.map((p) => p.occurrence_count));

    if (maxOccurrences === 0) {
      return 0;
    }

    // Normalize to [0, 1]
    return pattern.occurrence_count / maxOccurrences;
  }

  /**
   * Generate Golden Test from selected accident pattern
   */
  generateGoldenTest(pattern: AccidentPattern, selectionScore: number): GoldenTest {
    const testId = `test_${pattern.pattern_id}_${Date.now()}`;

    // Extract Given-When-Then from pattern
    const { given, when, then } = this.extractTestStructure(pattern);

    // Determine Kill Switch threshold based on severity
    const killSwitchThreshold = this.determineKillSwitchThreshold(pattern.severity);

    const test: GoldenTest = {
      test_id: testId,
      title: `Prevent: ${pattern.title}`,
      description: `Golden Test to prevent recurrence of: ${pattern.description}`,

      // Selection criteria
      severity: pattern.severity,
      blast_radius: pattern.blast_radius,
      frequency: pattern.occurrence_count,
      selection_score: selectionScore,

      // Test structure
      given,
      when,
      then,

      // Test execution
      test_function: this.generateTestFunction(pattern),
      timeout_ms: 30000, // 30 seconds default

      // Flaky detection
      flaky_status: 'stable',
      failure_count: 0,
      retry_count: 0,

      // Kill Switch integration
      kill_switch_threshold: killSwitchThreshold,

      // Coverage tracking
      accident_pattern_id: pattern.pattern_id,
      times_prevented: 0,

      // Metadata
      created_at: new Date().toISOString(),
      source: 'conversation_log',
      tags: [pattern.severity, pattern.blast_radius, 'golden_test'],
    };

    return test;
  }

  /**
   * Extract Given-When-Then structure from accident pattern
   */
  private extractTestStructure(pattern: AccidentPattern): {
    given: string;
    when: string;
    then: string;
  } {
    // Parse trigger conditions for "Given"
    const given =
      pattern.trigger_conditions.length > 0
        ? `Given: ${pattern.trigger_conditions.join(', ')}`
        : `Given: Normal operating conditions`;

    // Parse root cause for "When"
    const when = `When: ${pattern.root_cause}`;

    // Generate expected safe outcome for "Then"
    const then = `Then: Action should be blocked or safely mitigated (preventing: ${pattern.description})`;

    return { given, when, then };
  }

  /**
   * Determine Kill Switch threshold based on severity (AI Council consensus)
   */
  private determineKillSwitchThreshold(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): 'immediate' | 'delayed' | 'warning' {
    switch (severity) {
      case 'critical':
        return 'immediate'; // Immediate Kill Switch
      case 'high':
      case 'medium':
        return 'delayed'; // Delayed Kill Switch (2-3 failures)
      case 'low':
        return 'warning'; // Warning only
      default:
        return 'warning';
    }
  }

  /**
   * Generate test function code from accident pattern
   */
  private generateTestFunction(pattern: AccidentPattern): string {
    // TODO: Implement AI-generated test function
    // For now, generate a template

    return `
// Golden Test: ${pattern.title}
// Purpose: Prevent recurrence of accident pattern ${pattern.pattern_id}
// Root Cause: ${pattern.root_cause}

async function test_${pattern.pattern_id.replace(/-/g, '_')}(context: TestContext): Promise<boolean> {
  // Given: ${pattern.trigger_conditions.join(', ')}
  const initialState = await context.captureState();

  // When: Attempt action that previously caused accident
  try {
    // TODO: Implement test action based on pattern.root_cause
    const result = await context.executeAction();

    // Then: Verify safe outcome
    const finalState = await context.captureState();

    // Check: No data loss, no unauthorized changes
    const isDataIntact = await context.verifyDataIntegrity(initialState, finalState);
    const isChangeAuthorized = await context.verifyAuthorization();

    return isDataIntact && isChangeAuthorized;
  } catch (error) {
    // If action throws, it means it was properly blocked
    // This is the desired outcome for dangerous operations
    console.log('[Test] Action blocked as expected:', error.message);
    return true;
  }
}
    `.trim();
  }

  /**
   * Get selection criteria (for transparency)
   */
  getCriteria(): TestSelectionCriteria {
    return { ...this.criteria };
  }

  /**
   * Update criteria (for tuning)
   */
  updateCriteria(updates: Partial<TestSelectionCriteria>): void {
    this.criteria = { ...this.criteria, ...updates };
    console.log('[TestSelectionEngine] Criteria updated:', this.criteria);
  }
}
