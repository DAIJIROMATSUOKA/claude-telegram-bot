/**
 * confidence-router Test Suite
 *
 * Tests:
 * 1. ConfidenceRouter constructor sets default thresholds
 * 2. route() returns auto_approve for high confidence + low impact
 * 3. route() returns red_team_required for low confidence + critical impact
 * 4. route() returns review_required for medium confidence
 * 5. routeProposal convenience function works correctly
 * 6. Edge cases: confidence=0.0, confidence=1.0, all impact levels, all task types
 */

import { describe, test, expect } from 'bun:test';
import {
  ConfidenceRouter,
  routeProposal,
  DEFAULT_THRESHOLDS,
  type TaskType,
  type ImpactLevel,
  type RoutingDecision,
  type RoutingResult,
  type ConfidenceThresholds,
} from '../utils/confidence-router';
import type { PluginProposal } from '../autopilot/types';

// ============================================================================
// Helper: Create a mock PluginProposal
// ============================================================================

function createMockProposal(
  confidence: number,
  impact: ImpactLevel,
  taskType: string = 'maintenance',
  approvalRequired: boolean = false
): PluginProposal {
  return {
    task: {
      id: 'test-task-001',
      type: taskType,
      title: 'Test Task',
      description: 'A test task for unit testing',
      reason: 'Unit test',
      confidence,
      impact,
      created_at: new Date().toISOString(),
      status: 'pending',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Step 1', 'Step 2'],
    estimated_duration: '5 minutes',
    risks: ['Minimal risk'],
    approval_required: approvalRequired,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('confidence-router', () => {
  // ==========================================================================
  // 1. ConfidenceRouter constructor sets default thresholds
  // ==========================================================================

  describe('ConfidenceRouter constructor', () => {
    test('should set default thresholds when no arguments provided', () => {
      const router = new ConfidenceRouter();
      const thresholds = router.getThresholds();

      expect(thresholds.maintenance).toBe(0.9);
      expect(thresholds.predictive).toBe(0.8);
      expect(thresholds.recovery).toBe(0.7);
      expect(thresholds.monitoring).toBe(0.85);
      expect(thresholds.optimization).toBe(0.8);
      expect(thresholds.feature).toBe(0.85);
      expect(thresholds.bugfix).toBe(0.8);
      expect(thresholds.default).toBe(0.85);
    });

    test('should merge custom thresholds with defaults', () => {
      const router = new ConfidenceRouter({ maintenance: 0.95, recovery: 0.6 });
      const thresholds = router.getThresholds();

      expect(thresholds.maintenance).toBe(0.95);
      expect(thresholds.recovery).toBe(0.6);
      // Others should remain default
      expect(thresholds.predictive).toBe(0.8);
      expect(thresholds.default).toBe(0.85);
    });

    test('should return a copy of thresholds, not the internal object', () => {
      const router = new ConfidenceRouter();
      const thresholds1 = router.getThresholds();
      const thresholds2 = router.getThresholds();

      expect(thresholds1).not.toBe(thresholds2);
      expect(thresholds1).toEqual(thresholds2);
    });
  });

  // ==========================================================================
  // 2. route() returns auto_approve for high confidence + low impact
  // ==========================================================================

  describe('route() auto_approve cases', () => {
    test('should return auto_approve for high confidence (0.95) + low impact', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.95, 'low', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('auto_approve');
      expect(result.requiresRedTeam).toBe(false);
      expect(result.metadata.autoApproved).toBe(true);
    });

    test('should return auto_approve for confidence=0.9 + low impact + maintenance', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.9, 'low', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('auto_approve');
    });

    test('should return auto_approve for confidence=0.85 + low impact + predictive', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.85, 'low', 'predictive');
      const result = router.route(proposal);

      expect(result.decision).toBe('auto_approve');
    });

    test('should not auto_approve if approval_required is true', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.95, 'low', 'maintenance', true);
      const result = router.route(proposal);

      expect(result.decision).toBe('review_required');
      expect(result.reason).toContain('Manual approval required by plugin');
    });
  });

  // ==========================================================================
  // 3. route() returns red_team_required for low confidence + critical impact
  // ==========================================================================

  describe('route() red_team_required cases', () => {
    test('should return red_team_required for low confidence (0.5) + critical impact', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.5, 'critical', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('red_team_required');
      expect(result.requiresRedTeam).toBe(true);
      expect(result.reason).toContain('Red Team review required');
    });

    test('should return red_team_required for confidence < 0.8 regardless of impact', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.79, 'low', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('red_team_required');
      expect(result.reason).toContain('confidence 0.79 < 0.8');
    });

    test('should return red_team_required for high impact regardless of confidence', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.95, 'high', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('red_team_required');
      expect(result.reason).toContain('high impact task');
    });

    test('should return red_team_required for critical impact regardless of confidence', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.99, 'critical', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('red_team_required');
      expect(result.reason).toContain('critical impact task');
    });

    test('should include both reasons when confidence low AND impact high', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.5, 'critical', 'maintenance');
      const result = router.route(proposal);

      expect(result.reason).toContain('confidence 0.50 < 0.8');
      expect(result.reason).toContain('critical impact task');
    });
  });

  // ==========================================================================
  // 4. route() returns review_required for medium confidence
  // ==========================================================================

  describe('route() review_required cases', () => {
    test('should return review_required when confidence below threshold for maintenance', () => {
      const router = new ConfidenceRouter();
      // maintenance threshold is 0.9, so 0.85 should require review
      // But 0.85 >= 0.8, so no red team required
      // However confidence < threshold, so review_required
      const proposal = createMockProposal(0.85, 'low', 'maintenance');
      const result = router.route(proposal);

      // confidence 0.85 >= 0.8 means no red team, but 0.85 < 0.9 (maintenance threshold)
      expect(result.decision).toBe('review_required');
      expect(result.reason).toContain('below threshold');
    });

    test('should return review_required when approval_required flag is set', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.95, 'low', 'maintenance', true);
      const result = router.route(proposal);

      expect(result.decision).toBe('review_required');
      expect(result.reason).toBe('Manual approval required by plugin');
    });

    test('should return review_required for confidence=0.82 + low impact + maintenance', () => {
      const router = new ConfidenceRouter();
      // 0.82 >= 0.8, so no red team
      // 0.82 < 0.9 (maintenance threshold), so review_required
      const proposal = createMockProposal(0.82, 'low', 'maintenance');
      const result = router.route(proposal);

      expect(result.decision).toBe('review_required');
    });
  });

  // ==========================================================================
  // 5. routeProposal convenience function works correctly
  // ==========================================================================

  describe('routeProposal convenience function', () => {
    test('should route proposal using default router', () => {
      const proposal = createMockProposal(0.95, 'low', 'maintenance');
      const result = routeProposal(proposal);

      expect(result).toBeDefined();
      expect(result.decision).toBe('auto_approve');
    });

    test('should return same result as ConfidenceRouter instance', () => {
      const router = new ConfidenceRouter();
      const proposal = createMockProposal(0.5, 'critical', 'recovery');

      const instanceResult = router.route(proposal);
      const functionResult = routeProposal(proposal);

      expect(functionResult.decision).toBe(instanceResult.decision);
      expect(functionResult.requiresRedTeam).toBe(instanceResult.requiresRedTeam);
    });

    test('should use default thresholds', () => {
      const proposal = createMockProposal(0.89, 'low', 'maintenance');
      const result = routeProposal(proposal);

      // 0.89 < 0.9 (maintenance threshold), so review_required
      expect(result.threshold).toBe(0.9);
    });
  });

  // ==========================================================================
  // 6. Edge cases: confidence=0.0, confidence=1.0, all impact levels, all task types
  // ==========================================================================

  describe('Edge cases', () => {
    describe('confidence boundaries', () => {
      test('should handle confidence=0.0', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.0, 'low', 'maintenance');
        const result = router.route(proposal);

        expect(result.decision).toBe('red_team_required');
        expect(result.confidence).toBe(0.0);
        expect(result.metadata.confidenceGap).toBeLessThan(0);
      });

      test('should handle confidence=1.0 with low impact', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(1.0, 'low', 'maintenance');
        const result = router.route(proposal);

        expect(result.decision).toBe('auto_approve');
        expect(result.confidence).toBe(1.0);
        expect(result.metadata.confidenceGap).toBeGreaterThan(0);
      });

      test('should handle confidence=1.0 with critical impact (still red team)', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(1.0, 'critical', 'maintenance');
        const result = router.route(proposal);

        // Even max confidence requires red team for critical impact
        expect(result.decision).toBe('red_team_required');
      });

      test('should handle confidence=0.8 exactly (boundary)', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.8, 'low', 'predictive');
        const result = router.route(proposal);

        // 0.8 >= 0.8 means no red team
        // 0.8 >= 0.8 (predictive threshold), so auto_approve
        expect(result.decision).toBe('auto_approve');
        expect(result.requiresRedTeam).toBe(false);
      });

      test('should handle confidence=0.79999 (just below boundary)', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.79999, 'low', 'maintenance');
        const result = router.route(proposal);

        // 0.79999 < 0.8, so red team required
        expect(result.decision).toBe('red_team_required');
        expect(result.requiresRedTeam).toBe(true);
      });
    });

    describe('all impact levels', () => {
      test('should handle low impact correctly', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.95, 'low', 'maintenance');
        const result = router.route(proposal);

        expect(result.metadata.impact).toBe('low');
        expect(result.requiresRedTeam).toBe(false);
      });

      test('should handle medium impact correctly', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.95, 'medium', 'maintenance');
        const result = router.route(proposal);

        expect(result.metadata.impact).toBe('medium');
        expect(result.requiresRedTeam).toBe(false);
      });

      test('should handle high impact correctly', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.95, 'high', 'maintenance');
        const result = router.route(proposal);

        expect(result.metadata.impact).toBe('high');
        expect(result.requiresRedTeam).toBe(true);
      });

      test('should handle critical impact correctly', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.95, 'critical', 'maintenance');
        const result = router.route(proposal);

        expect(result.metadata.impact).toBe('critical');
        expect(result.requiresRedTeam).toBe(true);
      });
    });

    describe('all task types', () => {
      const taskTypes: TaskType[] = [
        'maintenance',
        'predictive',
        'recovery',
        'monitoring',
        'optimization',
        'feature',
        'bugfix',
      ];

      for (const taskType of taskTypes) {
        test(`should route ${taskType} task with correct threshold`, () => {
          const router = new ConfidenceRouter();
          const expectedThreshold = DEFAULT_THRESHOLDS[taskType];
          const proposal = createMockProposal(0.95, 'low', taskType);
          const result = router.route(proposal);

          expect(result.threshold).toBe(expectedThreshold);
          expect(result.metadata.taskType).toBe(taskType);
        });
      }

      test('should use default threshold for unknown task type', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.95, 'low', 'unknown_type');
        const result = router.route(proposal);

        expect(result.threshold).toBe(DEFAULT_THRESHOLDS.default);
      });
    });

    describe('RoutingResult metadata', () => {
      test('should include all metadata fields', () => {
        const router = new ConfidenceRouter();
        const proposal = createMockProposal(0.85, 'medium', 'predictive');
        const result = router.route(proposal);

        expect(result.metadata).toBeDefined();
        expect(result.metadata.taskType).toBe('predictive');
        expect(result.metadata.impact).toBe('medium');
        expect(typeof result.metadata.confidenceGap).toBe('number');
        expect(typeof result.metadata.autoApproved).toBe('boolean');
      });

      test('should calculate correct confidence gap (positive)', () => {
        const router = new ConfidenceRouter();
        // predictive threshold is 0.8, confidence is 0.9
        const proposal = createMockProposal(0.9, 'low', 'predictive');
        const result = router.route(proposal);

        expect(result.metadata.confidenceGap).toBeCloseTo(0.1, 5);
      });

      test('should calculate correct confidence gap (negative)', () => {
        const router = new ConfidenceRouter();
        // maintenance threshold is 0.9, confidence is 0.85
        // but 0.85 >= 0.8 so no red team required
        const proposal = createMockProposal(0.85, 'low', 'maintenance');
        const result = router.route(proposal);

        expect(result.metadata.confidenceGap).toBeCloseTo(-0.05, 5);
      });
    });
  });

  // ==========================================================================
  // Additional: updateThresholds and recommendThresholdAdjustment
  // ==========================================================================

  describe('updateThresholds', () => {
    test('should update thresholds dynamically', () => {
      const router = new ConfidenceRouter();
      router.updateThresholds({ maintenance: 0.95 });

      expect(router.getThresholds().maintenance).toBe(0.95);
    });

    test('should preserve other thresholds when updating', () => {
      const router = new ConfidenceRouter();
      const originalPredictive = router.getThresholds().predictive;
      router.updateThresholds({ maintenance: 0.95 });

      expect(router.getThresholds().predictive).toBe(originalPredictive);
    });
  });

  describe('recommendThresholdAdjustment', () => {
    test('should recommend lowering threshold for high success rate (>0.95)', () => {
      const router = new ConfidenceRouter();
      const adjustment = router.recommendThresholdAdjustment('maintenance', 0.96);

      expect(adjustment).toBe(-0.05);
    });

    test('should recommend raising threshold for low success rate (<0.85)', () => {
      const router = new ConfidenceRouter();
      const adjustment = router.recommendThresholdAdjustment('maintenance', 0.80);

      expect(adjustment).toBe(0.05);
    });

    test('should recommend no change for acceptable success rate (0.85-0.95)', () => {
      const router = new ConfidenceRouter();
      const adjustment = router.recommendThresholdAdjustment('maintenance', 0.90);

      expect(adjustment).toBe(0);
    });

    test('should work with boundary values', () => {
      const router = new ConfidenceRouter();

      expect(router.recommendThresholdAdjustment('maintenance', 0.95)).toBe(0);
      expect(router.recommendThresholdAdjustment('maintenance', 0.85)).toBe(0);
      expect(router.recommendThresholdAdjustment('maintenance', 0.9501)).toBe(-0.05);
      expect(router.recommendThresholdAdjustment('maintenance', 0.8499)).toBe(0.05);
    });
  });

  describe('analyzeProposals', () => {
    test('should analyze empty proposals array', () => {
      const router = new ConfidenceRouter();
      const stats = router.analyzeProposals([]);

      expect(stats.total).toBe(0);
      expect(stats.autoApproved).toBe(0);
      expect(stats.reviewRequired).toBe(0);
      expect(stats.redTeamRequired).toBe(0);
      expect(isNaN(stats.averageConfidence)).toBe(true); // 0/0 = NaN
    });

    test('should count routing decisions correctly', () => {
      const router = new ConfidenceRouter();
      const proposals = [
        createMockProposal(0.95, 'low', 'maintenance'),      // auto_approve
        createMockProposal(0.85, 'low', 'maintenance'),      // review_required
        createMockProposal(0.5, 'critical', 'maintenance'),  // red_team_required
      ];

      const stats = router.analyzeProposals(proposals);

      expect(stats.total).toBe(3);
      expect(stats.autoApproved).toBe(1);
      expect(stats.reviewRequired).toBe(1);
      expect(stats.redTeamRequired).toBe(1);
    });

    test('should count by task type correctly', () => {
      const router = new ConfidenceRouter();
      const proposals = [
        createMockProposal(0.95, 'low', 'maintenance'),
        createMockProposal(0.95, 'low', 'maintenance'),
        createMockProposal(0.95, 'low', 'bugfix'),
      ];

      const stats = router.analyzeProposals(proposals);

      expect(stats.byTaskType['maintenance']).toBe(2);
      expect(stats.byTaskType['bugfix']).toBe(1);
    });

    test('should calculate average confidence correctly', () => {
      const router = new ConfidenceRouter();
      const proposals = [
        createMockProposal(0.8, 'low', 'maintenance'),
        createMockProposal(0.9, 'low', 'maintenance'),
        createMockProposal(1.0, 'low', 'maintenance'),
      ];

      const stats = router.analyzeProposals(proposals);

      expect(stats.averageConfidence).toBeCloseTo(0.9, 5);
    });
  });

  // ==========================================================================
  // DEFAULT_THRESHOLDS export
  // ==========================================================================

  describe('DEFAULT_THRESHOLDS export', () => {
    test('should export default thresholds with correct values', () => {
      expect(DEFAULT_THRESHOLDS.maintenance).toBe(0.9);
      expect(DEFAULT_THRESHOLDS.predictive).toBe(0.8);
      expect(DEFAULT_THRESHOLDS.recovery).toBe(0.7);
      expect(DEFAULT_THRESHOLDS.monitoring).toBe(0.85);
      expect(DEFAULT_THRESHOLDS.optimization).toBe(0.8);
      expect(DEFAULT_THRESHOLDS.feature).toBe(0.85);
      expect(DEFAULT_THRESHOLDS.bugfix).toBe(0.8);
      expect(DEFAULT_THRESHOLDS.default).toBe(0.85);
    });
  });
});
