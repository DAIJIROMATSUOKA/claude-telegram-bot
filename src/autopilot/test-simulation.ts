/**
 * Test Simulation Engine
 *
 * Phase 4: Replay past accidents to verify Golden Tests catch them
 *
 * Purpose:
 * - Simulate past accidents in a safe environment
 * - Verify Golden Tests detect them correctly
 * - Measure test effectiveness
 * - Generate confidence scores for test quality
 *
 * Task-ID: PHASE4_TEST_SIMULATION_2026-02-04
 */

import type { GoldenTest, AccidentPattern, TestExecutionResult } from './golden-test-types';
import type { PlanBundle } from './types';
import { GoldenTestEngine } from './golden-test-engine';

export interface SimulationScenario {
  scenario_id: string;
  accident_pattern_id: string;
  accident_title: string;
  simulation_type: 'replay' | 'synthetic' | 'mutation';
  bundle: PlanBundle;
  expected_detection: boolean; // Should Golden Test catch this?
  expected_test_id?: string; // Which test should catch it?
}

export interface SimulationResult {
  scenario_id: string;
  accident_pattern_id: string;
  test_results: TestExecutionResult[];
  detected: boolean; // Was accident detected by any test?
  detected_by?: string; // Which test detected it?
  expected_detection: boolean;
  result: 'true_positive' | 'true_negative' | 'false_positive' | 'false_negative';
  executed_at: string;
  duration_ms: number;
}

export interface SimulationSummary {
  total_scenarios: number;
  true_positives: number; // Accident detected correctly
  true_negatives: number; // No accident, no detection
  false_positives: number; // False alarm
  false_negatives: number; // Missed accident
  precision: number; // TP / (TP + FP)
  recall: number; // TP / (TP + FN)
  f1_score: number; // 2 * (precision * recall) / (precision + recall)
  test_effectiveness: number; // Overall effectiveness score (0-1)
  scenarios: SimulationResult[];
}

/**
 * Test Simulation Engine
 *
 * Replays past accidents to verify Golden Tests work correctly
 */
export class TestSimulationEngine {
  private goldenTestEngine: GoldenTestEngine;
  private memoryGatewayUrl: string;

  constructor(memoryGatewayUrl: string) {
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.goldenTestEngine = new GoldenTestEngine({ memoryGatewayUrl });
  }

  /**
   * Generate simulation scenarios from accident patterns
   */
  async generateScenarios(
    accidentPatterns: AccidentPattern[],
    goldenTests: GoldenTest[]
  ): Promise<SimulationScenario[]> {
    const scenarios: SimulationScenario[] = [];

    for (const pattern of accidentPatterns) {
      // Create a PlanBundle that simulates this accident
      const bundle = this.accidentPatternToPlanBundle(pattern);

      // Find the corresponding Golden Test
      const correspondingTest = goldenTests.find(
        (test) => test.accident_pattern_id === pattern.pattern_id
      );

      scenarios.push({
        scenario_id: `sim-${pattern.pattern_id}-${Date.now()}`,
        accident_pattern_id: pattern.pattern_id,
        accident_title: pattern.title,
        simulation_type: 'replay',
        bundle,
        expected_detection: true, // Accidents should be detected
        expected_test_id: correspondingTest?.test_id,
      });
    }

    // Add negative scenarios (should NOT be detected)
    scenarios.push(...this.generateNegativeScenarios());

    return scenarios;
  }

  /**
   * Run simulation for all scenarios
   */
  async runSimulation(
    scenarios: SimulationScenario[],
    goldenTests: GoldenTest[]
  ): Promise<SimulationSummary> {
    console.log(`[TestSimulation] Running ${scenarios.length} scenarios...`);

    const results: SimulationResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario, goldenTests);
      results.push(result);
    }

    // Calculate summary metrics
    const summary = this.calculateSummary(results);

    // Store results in Memory Gateway
    await this.storeSimulationResults(summary);

    return summary;
  }

  /**
   * Run a single simulation scenario
   */
  private async runScenario(
    scenario: SimulationScenario,
    goldenTests: GoldenTest[]
  ): Promise<SimulationResult> {
    const startTime = Date.now();

    console.log(`[TestSimulation] Running scenario: ${scenario.accident_title}`);

    // Cache tests for the Golden Test Engine
    this.goldenTestEngine.cacheTests(goldenTests);

    // Execute Golden Tests on the simulated accident
    const testResult = await this.goldenTestEngine.executePreExecutionTests(
      scenario.bundle,
      goldenTests
    );

    // Determine if accident was detected
    const detected = testResult.failed_tests > 0;
    const detectedBy = testResult.results.find((r) => r.status === 'failed')?.test_id;

    // Classify result
    let resultType: 'true_positive' | 'true_negative' | 'false_positive' | 'false_negative';

    if (scenario.expected_detection && detected) {
      resultType = 'true_positive'; // Correctly detected accident
    } else if (!scenario.expected_detection && !detected) {
      resultType = 'true_negative'; // Correctly allowed safe operation
    } else if (!scenario.expected_detection && detected) {
      resultType = 'false_positive'; // False alarm
    } else {
      resultType = 'false_negative'; // Missed accident (CRITICAL!)
    }

    return {
      scenario_id: scenario.scenario_id,
      accident_pattern_id: scenario.accident_pattern_id,
      test_results: testResult.results,
      detected,
      detected_by: detectedBy,
      expected_detection: scenario.expected_detection,
      result: resultType,
      executed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Calculate summary metrics
   */
  private calculateSummary(results: SimulationResult[]): SimulationSummary {
    const truePositives = results.filter((r) => r.result === 'true_positive').length;
    const trueNegatives = results.filter((r) => r.result === 'true_negative').length;
    const falsePositives = results.filter((r) => r.result === 'false_positive').length;
    const falseNegatives = results.filter((r) => r.result === 'false_negative').length;

    // Precision: TP / (TP + FP)
    const precision =
      truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;

    // Recall: TP / (TP + FN)
    const recall =
      truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;

    // F1 Score: 2 * (precision * recall) / (precision + recall)
    const f1Score =
      precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    // Test Effectiveness: Weighted combination (prioritize recall to minimize false negatives)
    // Weight: 70% recall (catching accidents) + 30% precision (avoiding false alarms)
    const testEffectiveness = recall * 0.7 + precision * 0.3;

    return {
      total_scenarios: results.length,
      true_positives: truePositives,
      true_negatives: trueNegatives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      precision,
      recall,
      f1_score: f1Score,
      test_effectiveness: testEffectiveness,
      scenarios: results,
    };
  }

  /**
   * Convert AccidentPattern to PlanBundle for simulation
   */
  private accidentPatternToPlanBundle(pattern: AccidentPattern): PlanBundle {
    return {
      plan_id: `sim-${pattern.pattern_id}`,
      title: `Simulation: ${pattern.title}`,
      scope: 'test',
      confidence: 0.8,
      impact: pattern.severity,

      evidence: {
        rationale: `Simulating accident pattern: ${pattern.root_cause}`,
        supporting_data: {
          pattern_id: pattern.pattern_id,
          trigger_conditions: pattern.trigger_conditions,
        },
        alternative_approaches: [],
        cost_benefit_analysis: 'Simulation - no real cost',
      },

      actions: [
        {
          action_id: `sim-action-${pattern.pattern_id}`,
          type: 'custom',
          description: `Simulate: ${pattern.description}`,
          idempotency_key: `sim-${pattern.pattern_id}`,
          expected_outcome: 'Test should catch this accident',
          reversible: true,
        },
      ],

      risk: {
        identified_risks: [
          {
            risk_id: `sim-risk-${pattern.pattern_id}`,
            description: pattern.root_cause,
            likelihood: 'high',
            severity: pattern.severity,
            mitigation_strategy: 'Golden Test should prevent this',
          },
        ],
        overall_risk_score: 0.8,
        acceptable_risk_threshold: 0.3,
        mitigation_plan: 'Golden Test validation',
        rollback_plan: {
          rollback_steps: ['Test simulation - no real rollback needed'],
          estimated_rollback_time: '0s',
          data_preservation_strategy: 'N/A - simulation only',
        },
      },

      created_at: new Date().toISOString(),
    };
  }

  /**
   * Generate negative scenarios (should NOT be detected)
   */
  private generateNegativeScenarios(): SimulationScenario[] {
    const scenarios: SimulationScenario[] = [];

    // Scenario 1: Safe low-impact task
    scenarios.push({
      scenario_id: `sim-negative-safe-task-${Date.now()}`,
      accident_pattern_id: 'N/A',
      accident_title: 'Safe Low-Impact Task',
      simulation_type: 'synthetic',
      bundle: {
        plan_id: 'sim-safe-low',
        title: 'Safe low-impact task',
        scope: 'test',
        confidence: 0.95,
        impact: 'low',
        evidence: {
          rationale: 'Routine maintenance task',
          supporting_data: {},
          alternative_approaches: [],
          cost_benefit_analysis: 'Low risk, high benefit',
        },
        actions: [
          {
            action_id: 'safe-action-1',
            type: 'custom',
            description: 'Perform safe maintenance',
            idempotency_key: 'safe-maint-1',
            expected_outcome: 'Successful completion',
            reversible: true,
          },
        ],
        risk: {
          identified_risks: [],
          overall_risk_score: 0.1,
          acceptable_risk_threshold: 0.7,
          mitigation_plan: 'Standard monitoring',
          rollback_plan: {
            rollback_steps: ['Revert if needed'],
            estimated_rollback_time: '1 min',
            data_preservation_strategy: 'Full backup',
          },
        },
        created_at: new Date().toISOString(),
      },
      expected_detection: false,
    });

    return scenarios;
  }

  /**
   * Store simulation results in Memory Gateway
   */
  private async storeSimulationResults(summary: SimulationSummary): Promise<void> {
    try {
      await fetch(`${this.memoryGatewayUrl}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'private/jarvis/test_simulation',
          type: 'simulation_summary',
          title: `Test Simulation: ${summary.total_scenarios} scenarios (${(summary.test_effectiveness * 100).toFixed(0)}% effectiveness)`,
          content: JSON.stringify(summary, null, 2),
          tags: [
            'test_simulation',
            'golden_test',
            `effectiveness_${Math.floor(summary.test_effectiveness * 10)}`,
          ],
          importance: summary.test_effectiveness < 0.8 ? 9 : 5,
          source_agent: 'jarvis',
        }),
      });

      console.log('[TestSimulation] Results stored in Memory Gateway');
    } catch (error) {
      console.error('[TestSimulation] Failed to store results:', error);
    }
  }

  /**
   * Generate effectiveness report
   */
  generateReport(summary: SimulationSummary): string {
    let report = '🧪 **Golden Test Simulation Report**\\n\\n';

    report += '## Overall Effectiveness\\n\\n';
    report += `- **Total Scenarios:** ${summary.total_scenarios}\\n`;
    report += `- **Test Effectiveness:** ${(summary.test_effectiveness * 100).toFixed(1)}% ${this.getEffectivenessEmoji(summary.test_effectiveness)}\\n`;
    report += `- **F1 Score:** ${(summary.f1_score * 100).toFixed(1)}%\\n`;
    report += `- **Precision:** ${(summary.precision * 100).toFixed(1)}% (accuracy of detections)\\n`;
    report += `- **Recall:** ${(summary.recall * 100).toFixed(1)}% (% of accidents caught)\\n\\n`;

    report += '## Detection Results\\n\\n';
    report += `- ✅ **True Positives:** ${summary.true_positives} (accidents correctly detected)\\n`;
    report += `- ✅ **True Negatives:** ${summary.true_negatives} (safe operations correctly allowed)\\n`;
    report += `- ⚠️ **False Positives:** ${summary.false_positives} (false alarms)\\n`;
    report += `- 🚨 **False Negatives:** ${summary.false_negatives} (missed accidents - CRITICAL!)\\n\\n`;

    if (summary.false_negatives > 0) {
      report += '## 🚨 Critical Issues\\n\\n';
      const missedAccidents = summary.scenarios.filter((s) => s.result === 'false_negative');
      missedAccidents.forEach((scenario) => {
        report += `- **Missed:** ${scenario.accident_pattern_id} - Golden Tests failed to detect this accident\\n`;
      });
      report += '\\n';
    }

    if (summary.false_positives > 0) {
      report += '## ⚠️ False Alarms\\n\\n';
      const falseAlarms = summary.scenarios.filter((s) => s.result === 'false_positive');
      falseAlarms.forEach((scenario) => {
        report += `- **False Alarm:** ${scenario.scenario_id} - Test incorrectly flagged safe operation\\n`;
      });
      report += '\\n';
    }

    report += '## Recommendations\\n\\n';
    report += this.generateRecommendations(summary);

    report += '\\n---\\n';
    report += `*Generated: ${new Date().toISOString()}*\\n`;

    return report;
  }

  /**
   * Get emoji for effectiveness level
   */
  private getEffectivenessEmoji(effectiveness: number): string {
    if (effectiveness >= 0.95) return '🌟';
    if (effectiveness >= 0.85) return '✅';
    if (effectiveness >= 0.75) return '⚠️';
    return '🚨';
  }

  /**
   * Generate recommendations based on simulation results
   */
  private generateRecommendations(summary: SimulationSummary): string {
    let recommendations = '';

    if (summary.test_effectiveness >= 0.95) {
      recommendations += '- ✅ Excellent test effectiveness! Golden Tests are working as designed.\\n';
    } else if (summary.test_effectiveness >= 0.85) {
      recommendations += '- ✅ Good test effectiveness. Minor improvements possible.\\n';
    } else if (summary.test_effectiveness >= 0.75) {
      recommendations += '- ⚠️ Fair test effectiveness. Consider strengthening test coverage.\\n';
    } else {
      recommendations += '- 🚨 Low test effectiveness. Immediate review and improvement required.\\n';
    }

    if (summary.false_negatives > 0) {
      recommendations += `- 🚨 **CRITICAL:** ${summary.false_negatives} accidents were NOT detected. Create new Golden Tests for these patterns immediately.\\n`;
    }

    if (summary.false_positives > summary.total_scenarios * 0.1) {
      recommendations += '- ⚠️ High false positive rate (>10%). Review test sensitivity to reduce false alarms.\\n';
    }

    if (summary.recall < 0.9) {
      recommendations += '- 📈 Recall is below 90%. Focus on improving accident detection coverage.\\n';
    }

    if (summary.precision < 0.8) {
      recommendations += '- 📉 Precision is below 80%. Reduce false positives by refining test criteria.\\n';
    }

    return recommendations;
  }
}
