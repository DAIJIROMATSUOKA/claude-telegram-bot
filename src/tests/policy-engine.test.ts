/**
 * PolicyEngine Unit Tests
 *
 * Tests the 6 validation rules:
 * 1. Evidence Completeness
 * 2. Risk Assessment Quality
 * 3. Rollback Feasibility
 * 4. Idempotency Guarantee
 * 5. Confidence Threshold
 * 6. Impact Alignment
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PolicyEngine } from '../autopilot/policy-engine';
import type {
  PlanBundle,
  ActionItem,
  Evidence,
  RiskAssessment,
  RollbackPlan,
  Decision,
} from '../autopilot/types';

// Helper to create a valid ActionItem
function createValidAction(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    action_id: 'action-001',
    type: 'notify',
    description: 'Send notification',
    parameters: { message: 'Test notification' },
    idempotency_key: 'idem-key-001',
    rollback_plan: {
      can_rollback: true,
      automatic_steps: ['Revert notification state'],
      manual_instructions: ['Check notification log'],
    },
    ...overrides,
  };
}

// Helper to create a valid Evidence object
function createValidEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    rationale: 'This action is needed because of user request',
    supporting_data: ['Log entry showing issue', 'Metric showing degradation'],
    precedents: ['Similar action executed successfully on 2024-01-01'],
    ...overrides,
  };
}

// Helper to create a valid RiskAssessment object
function createValidRiskAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    level: 'low',
    risks: [
      {
        description: 'Minor service disruption',
        likelihood: 'low',
        impact: 'low',
        mitigation: 'Monitor service health',
      },
    ],
    mitigations: ['Monitor service health after execution'],
    worst_case: 'Service temporarily unavailable for 5 minutes',
    blast_radius: 'single_file',
    ...overrides,
  };
}

// Helper to create a valid PlanBundle
function createValidPlanBundle(overrides: Partial<PlanBundle> = {}): PlanBundle {
  return {
    plan_id: 'plan-001',
    title: 'Test Plan',
    scope: 'test',
    confidence: 0.85,
    impact: 'low',
    evidence: createValidEvidence(),
    actions: [createValidAction()],
    risk: createValidRiskAssessment(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('validate() with complete valid PlanBundle', () => {
    test('returns valid=true, high score, and 0 violations', async () => {
      const bundle = createValidPlanBundle();
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.score).toBe(1.0);
    });

    test('returns warnings for missing precedents', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ precedents: [] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No precedents found - first-time action');
    });

    test('returns warnings for empty actions', async () => {
      const bundle = createValidPlanBundle({ actions: [] });
      const result = await engine.validate(bundle);

      expect(result.warnings).toContain('No actions defined - plan will have no effect');
    });
  });

  describe('Rule 1: Evidence Completeness', () => {
    test('missing rationale triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ rationale: '' }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Evidence Completeness' && v.description.includes('Rationale')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('null rationale triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ rationale: null as unknown as string }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Evidence Completeness' && v.description.includes('Rationale')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('empty supporting_data triggers high violation', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ supporting_data: [] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Evidence Completeness' && v.description.includes('supporting data')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('high');
    });

    test('null supporting_data triggers high violation', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ supporting_data: null as unknown as string[] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Evidence Completeness' && v.description.includes('supporting data')
      );
      expect(violation).toBeDefined();
    });

    test('whitespace-only rationale triggers violation', async () => {
      const bundle = createValidPlanBundle({
        evidence: createValidEvidence({ rationale: '   ' }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Evidence Completeness' && v.description.includes('Rationale')
      );
      expect(violation).toBeDefined();
    });
  });

  describe('Rule 2: Risk Assessment Quality', () => {
    test('missing risk level triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({ level: '' as RiskAssessment['level'] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('level')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('empty risks array triggers high violation', async () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({ risks: [] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('No risks identified')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('high');
    });

    test('high risk without mitigations triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        impact: 'high',
        risk: createValidRiskAssessment({
          level: 'high',
          mitigations: [],
        }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('mitigation')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('critical risk without mitigations triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        impact: 'critical',
        risk: createValidRiskAssessment({
          level: 'critical',
          mitigations: [],
        }),
        decision: {
          approved: true,
          approver: 'user',
          rationale: 'User approved',
          timestamp: new Date().toISOString(),
        },
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('mitigation')
      );
      expect(violation).toBeDefined();
    });

    test('missing worst_case triggers medium violation', async () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({ worst_case: '' }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('Worst-case')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('medium');
    });

    test('missing blast_radius triggers medium violation', async () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({ blast_radius: undefined as unknown as RiskAssessment['blast_radius'] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('Blast radius')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('medium');
    });

    test('low risk without mitigations is acceptable', async () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({
          level: 'low',
          mitigations: [],
        }),
      });
      const result = await engine.validate(bundle);

      // Should not have mitigation-related violation
      const violation = result.violations.find(
        (v) => v.rule === 'Risk Assessment Quality' && v.description.includes('mitigation')
      );
      expect(violation).toBeUndefined();
    });
  });

  describe('Rule 3: Rollback Feasibility', () => {
    test('missing rollback_plan triggers critical violation', async () => {
      const action = createValidAction();
      delete (action as Partial<ActionItem>).rollback_plan;
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Rollback Feasibility' && v.description.includes('no rollback plan')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('can_rollback=true but no steps triggers high violation', async () => {
      const action = createValidAction({
        rollback_plan: {
          can_rollback: true,
          automatic_steps: [],
          manual_instructions: [],
        },
      });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Rollback Feasibility' && v.description.includes('claims rollback')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('high');
    });

    test('can_rollback=false with no manual instructions triggers medium violation', async () => {
      const action = createValidAction({
        rollback_plan: {
          can_rollback: false,
          automatic_steps: [],
          manual_instructions: [],
        },
      });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) =>
          v.rule === 'Rollback Feasibility' &&
          v.description.includes('cannot be rolled back') &&
          v.description.includes('no manual recovery')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('medium');
    });

    test('can_rollback=true with only automatic_steps is valid', async () => {
      const action = createValidAction({
        rollback_plan: {
          can_rollback: true,
          automatic_steps: ['Step 1'],
          manual_instructions: [],
        },
      });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      const violation = result.violations.find((v) => v.rule === 'Rollback Feasibility');
      expect(violation).toBeUndefined();
    });

    test('can_rollback=true with only manual_instructions is valid', async () => {
      const action = createValidAction({
        rollback_plan: {
          can_rollback: true,
          automatic_steps: [],
          manual_instructions: ['Do this manually'],
        },
      });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      const violation = result.violations.find((v) => v.rule === 'Rollback Feasibility');
      expect(violation).toBeUndefined();
    });

    test('can_rollback=false with manual instructions is valid', async () => {
      const action = createValidAction({
        rollback_plan: {
          can_rollback: false,
          automatic_steps: [],
          manual_instructions: ['Manual recovery instructions'],
        },
      });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      const violation = result.violations.find(
        (v) => v.rule === 'Rollback Feasibility' && v.description.includes('cannot be rolled back')
      );
      expect(violation).toBeUndefined();
    });
  });

  describe('Rule 4: Idempotency Guarantee', () => {
    test('missing idempotency_key triggers critical violation', async () => {
      const action = createValidAction({ idempotency_key: '' });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Idempotency Guarantee' && v.description.includes('no idempotency key')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('null idempotency_key triggers critical violation', async () => {
      const action = createValidAction({ idempotency_key: null as unknown as string });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Idempotency Guarantee' && v.description.includes('no idempotency key')
      );
      expect(violation).toBeDefined();
    });

    test('whitespace-only idempotency_key triggers violation', async () => {
      const action = createValidAction({ idempotency_key: '   ' });
      const bundle = createValidPlanBundle({ actions: [action] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find((v) => v.rule === 'Idempotency Guarantee');
      expect(violation).toBeDefined();
    });

    test('duplicate idempotency_keys trigger critical violation', async () => {
      const action1 = createValidAction({ action_id: 'action-001', idempotency_key: 'same-key' });
      const action2 = createValidAction({ action_id: 'action-002', idempotency_key: 'same-key' });
      const bundle = createValidPlanBundle({ actions: [action1, action2] });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Idempotency Guarantee' && v.description.includes('Duplicate')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('unique idempotency_keys for multiple actions is valid', async () => {
      const action1 = createValidAction({ action_id: 'action-001', idempotency_key: 'key-001' });
      const action2 = createValidAction({ action_id: 'action-002', idempotency_key: 'key-002' });
      const bundle = createValidPlanBundle({ actions: [action1, action2] });
      const result = await engine.validate(bundle);

      const violation = result.violations.find((v) => v.rule === 'Idempotency Guarantee');
      expect(violation).toBeUndefined();
    });
  });

  describe('Rule 5: Confidence Threshold', () => {
    test('confidence below 0.7 triggers high violation', async () => {
      const bundle = createValidPlanBundle({ confidence: 0.5 });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find((v) => v.rule === 'Confidence Threshold');
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('high');
      expect(violation?.description).toContain('0.50');
      expect(violation?.description).toContain('0.7');
    });

    test('confidence at exactly 0.7 is valid', async () => {
      const bundle = createValidPlanBundle({ confidence: 0.7 });
      const result = await engine.validate(bundle);

      const violation = result.violations.find((v) => v.rule === 'Confidence Threshold');
      expect(violation).toBeUndefined();
    });

    test('confidence above 0.7 is valid', async () => {
      const bundle = createValidPlanBundle({ confidence: 0.95 });
      const result = await engine.validate(bundle);

      const violation = result.violations.find((v) => v.rule === 'Confidence Threshold');
      expect(violation).toBeUndefined();
    });

    test('confidence at 0.0 triggers violation', async () => {
      const bundle = createValidPlanBundle({ confidence: 0.0 });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find((v) => v.rule === 'Confidence Threshold');
      expect(violation).toBeDefined();
    });

    test('confidence at 0.69 triggers violation (boundary test)', async () => {
      const bundle = createValidPlanBundle({ confidence: 0.69 });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find((v) => v.rule === 'Confidence Threshold');
      expect(violation).toBeDefined();
    });
  });

  describe('Rule 6: Impact Alignment', () => {
    test('critical impact without approval triggers critical violation', async () => {
      const bundle = createValidPlanBundle({
        impact: 'critical',
        decision: undefined,
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Impact Alignment' && v.description.includes('explicit user approval')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('critical');
    });

    test('critical impact with approval is valid', async () => {
      const bundle = createValidPlanBundle({
        impact: 'critical',
        risk: createValidRiskAssessment({ level: 'critical', mitigations: ['Mitigation'] }),
        decision: {
          approved: true,
          approver: 'user',
          rationale: 'User approved the critical action',
          timestamp: new Date().toISOString(),
        },
      });
      const result = await engine.validate(bundle);

      const violation = result.violations.find(
        (v) => v.rule === 'Impact Alignment' && v.description.includes('explicit user approval')
      );
      expect(violation).toBeUndefined();
    });

    test('impact lower than risk level triggers high violation', async () => {
      const bundle = createValidPlanBundle({
        impact: 'low',
        risk: createValidRiskAssessment({ level: 'high', mitigations: ['Mitigation'] }),
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      const violation = result.violations.find(
        (v) => v.rule === 'Impact Alignment' && v.description.includes('lower than risk level')
      );
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('high');
    });

    test('impact equal to risk level is valid', async () => {
      const bundle = createValidPlanBundle({
        impact: 'medium',
        risk: createValidRiskAssessment({ level: 'medium' }),
      });
      const result = await engine.validate(bundle);

      const violation = result.violations.find(
        (v) => v.rule === 'Impact Alignment' && v.description.includes('lower than risk level')
      );
      expect(violation).toBeUndefined();
    });

    test('impact higher than risk level is valid', async () => {
      const bundle = createValidPlanBundle({
        impact: 'high',
        risk: createValidRiskAssessment({ level: 'low' }),
      });
      const result = await engine.validate(bundle);

      const violation = result.violations.find(
        (v) => v.rule === 'Impact Alignment' && v.description.includes('lower than risk level')
      );
      expect(violation).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    test('empty actions array generates warning but no violation', async () => {
      const bundle = createValidPlanBundle({ actions: [] });
      const result = await engine.validate(bundle);

      expect(result.warnings).toContain('No actions defined - plan will have no effect');
      // No Rollback or Idempotency violations because there are no actions
      const rollbackViolation = result.violations.find((v) => v.rule === 'Rollback Feasibility');
      const idempotencyViolation = result.violations.find((v) => v.rule === 'Idempotency Guarantee');
      expect(rollbackViolation).toBeUndefined();
      expect(idempotencyViolation).toBeUndefined();
    });

    test('multiple violations from different rules', async () => {
      const bundle = createValidPlanBundle({
        confidence: 0.5, // Rule 5 violation
        evidence: createValidEvidence({ rationale: '' }), // Rule 1 violation
        risk: createValidRiskAssessment({ risks: [] }), // Rule 2 violation
      });
      const result = await engine.validate(bundle);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);

      // Score should reflect multiple rule violations
      expect(result.score).toBeLessThan(1.0);
    });

    test('score calculation is correct', async () => {
      // 1 rule violated out of 6
      const bundle = createValidPlanBundle({ confidence: 0.5 });
      const result = await engine.validate(bundle);

      expect(result.score).toBe(5 / 6);
    });

    test('multiple violations on same rule count as one rule for score', async () => {
      // Risk Assessment Quality: missing risks AND missing worst_case
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({
          risks: [],
          worst_case: '',
        }),
      });
      const result = await engine.validate(bundle);

      // 2 violations but from same rule
      expect(result.violations.length).toBe(2);
      // Score should be 5/6 (only 1 rule violated)
      expect(result.score).toBe(5 / 6);
    });
  });

  describe('requiresUserApproval()', () => {
    test('critical impact requires approval', () => {
      const bundle = createValidPlanBundle({ impact: 'critical' });
      expect(engine.requiresUserApproval(bundle)).toBe(true);
    });

    test('critical risk level requires approval', () => {
      const bundle = createValidPlanBundle({
        risk: createValidRiskAssessment({ level: 'critical', mitigations: ['Mitigation'] }),
      });
      expect(engine.requiresUserApproval(bundle)).toBe(true);
    });

    test('low confidence requires approval', () => {
      const bundle = createValidPlanBundle({ confidence: 0.5 });
      expect(engine.requiresUserApproval(bundle)).toBe(true);
    });

    test('high impact with high confidence does not require approval', () => {
      const bundle = createValidPlanBundle({
        impact: 'high',
        confidence: 0.9,
        risk: createValidRiskAssessment({ level: 'medium' }),
      });
      expect(engine.requiresUserApproval(bundle)).toBe(false);
    });

    test('low impact, low risk, high confidence does not require approval', () => {
      const bundle = createValidPlanBundle({
        impact: 'low',
        confidence: 0.85,
        risk: createValidRiskAssessment({ level: 'low' }),
      });
      expect(engine.requiresUserApproval(bundle)).toBe(false);
    });
  });

  describe('generateApprovalRequest()', () => {
    test('generates approval message with plan details', async () => {
      const bundle = createValidPlanBundle({
        title: 'Deploy to Production',
        impact: 'critical',
        confidence: 0.8,
        risk: createValidRiskAssessment({ level: 'high', mitigations: ['Mitigation'] }),
        decision: {
          approved: true,
          approver: 'user',
          rationale: 'Approved',
          timestamp: new Date().toISOString(),
        },
      });
      const validation = await engine.validate(bundle);
      const message = engine.generateApprovalRequest(bundle, validation);

      expect(message).toContain('Approval Required');
      expect(message).toContain('Deploy to Production');
      expect(message).toContain('critical');
      expect(message).toContain('high');
      expect(message).toContain('80%');
    });

    test('includes violations in approval message', async () => {
      const bundle = createValidPlanBundle({
        title: 'Test Plan',
        confidence: 0.5, // Triggers violation
      });
      const validation = await engine.validate(bundle);
      const message = engine.generateApprovalRequest(bundle, validation);

      expect(message).toContain('Policy Violations');
      expect(message).toContain('Confidence');
    });

    test('truncates violations at 3 and shows count', async () => {
      const bundle = createValidPlanBundle({
        confidence: 0.5,
        evidence: createValidEvidence({ rationale: '', supporting_data: [] }),
        risk: createValidRiskAssessment({ level: '', risks: [], worst_case: '', blast_radius: undefined as unknown as RiskAssessment['blast_radius'] }),
      });
      const validation = await engine.validate(bundle);
      const message = engine.generateApprovalRequest(bundle, validation);

      // Should show "...and X more" if more than 3 violations
      if (validation.violations.length > 3) {
        expect(message).toContain('more');
      }
    });

    test('includes action descriptions', async () => {
      const action = createValidAction({ description: 'Run database migration' });
      const bundle = createValidPlanBundle({ actions: [action] });
      const validation = await engine.validate(bundle);
      const message = engine.generateApprovalRequest(bundle, validation);

      expect(message).toContain('Actions');
      expect(message).toContain('Run database migration');
    });
  });
});
