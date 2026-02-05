/**
 * Policy Engine - JARVIS MESH v1 (Phase 2: Proof-Carrying Autopilot)
 *
 * Purpose: Validate PlanBundle completeness and safety
 * Philosophy: "Never execute without complete proof"
 *
 * Validation Rules:
 * 1. Evidence completeness - All required evidence present
 * 2. Risk assessment quality - Risks identified and mitigated
 * 3. Rollback feasibility - Recovery plan exists
 * 4. Idempotency guarantee - No duplicate execution
 * 5. Confidence threshold - Agent confidence meets minimum
 * 6. Impact alignment - Impact level matches actual risk
 */

import type {
  PlanBundle,
  PolicyValidationResult,
  PolicyViolation,
  Evidence,
  RiskAssessment,
  ActionItem,
} from './types';

export class PolicyEngine {
  // Policy thresholds
  private readonly MIN_CONFIDENCE = 0.7; // Minimum confidence for auto-approval
  private readonly MIN_EVIDENCE_ITEMS = 1; // Minimum supporting data items
  private readonly MIN_RISK_MITIGATIONS = 1; // Minimum mitigation strategies for high/critical risk

  /**
   * Validate PlanBundle against all policies
   */
  async validate(bundle: PlanBundle): Promise<PolicyValidationResult> {
    const violations: PolicyViolation[] = [];
    const warnings: string[] = [];

    // Rule 1: Evidence completeness
    const evidenceViolations = this.validateEvidence(bundle.evidence);
    violations.push(...evidenceViolations);

    // Rule 2: Risk assessment quality
    const riskViolations = this.validateRiskAssessment(bundle.risk);
    violations.push(...riskViolations);

    // Rule 3: Rollback feasibility
    const rollbackViolations = this.validateRollbackPlans(bundle.actions);
    violations.push(...rollbackViolations);

    // Rule 4: Idempotency guarantee
    const idempotencyViolations = this.validateIdempotency(bundle.actions);
    violations.push(...idempotencyViolations);

    // Rule 5: Confidence threshold
    if (bundle.confidence < this.MIN_CONFIDENCE) {
      violations.push({
        rule: 'Confidence Threshold',
        severity: 'high',
        description: `Confidence ${bundle.confidence.toFixed(2)} is below minimum ${this.MIN_CONFIDENCE}`,
        required_fix: 'Increase confidence or request user approval',
      });
    }

    // Rule 6: Impact alignment
    const impactViolations = this.validateImpactAlignment(bundle);
    violations.push(...impactViolations);

    // Warnings (non-blocking)
    if (!bundle.evidence.precedents || bundle.evidence.precedents.length === 0) {
      warnings.push('No precedents found - first-time action');
    }

    if (bundle.actions.length === 0) {
      warnings.push('No actions defined - plan will have no effect');
    }

    // Calculate compliance score
    const totalRules = 6;
    const violatedRules = new Set(violations.map((v) => v.rule)).size;
    const score = (totalRules - violatedRules) / totalRules;

    return {
      valid: violations.length === 0,
      violations,
      warnings,
      score,
    };
  }

  /**
   * Rule 1: Validate evidence completeness
   */
  private validateEvidence(evidence: Evidence): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Rationale is required
    if (!evidence.rationale || evidence.rationale.trim().length === 0) {
      violations.push({
        rule: 'Evidence Completeness',
        severity: 'critical',
        description: 'Rationale is missing or empty',
        required_fix: 'Provide clear rationale for why this action is needed',
      });
    }

    // Supporting data is required
    if (!evidence.supporting_data || evidence.supporting_data.length < this.MIN_EVIDENCE_ITEMS) {
      violations.push({
        rule: 'Evidence Completeness',
        severity: 'high',
        description: `Insufficient supporting data (${evidence.supporting_data?.length || 0} items, minimum ${this.MIN_EVIDENCE_ITEMS})`,
        required_fix: 'Add logs, metrics, or observations that support this action',
      });
    }

    return violations;
  }

  /**
   * Rule 2: Validate risk assessment quality
   */
  private validateRiskAssessment(risk: RiskAssessment): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Risk level is required
    if (!risk.level) {
      violations.push({
        rule: 'Risk Assessment Quality',
        severity: 'critical',
        description: 'Risk level not specified',
        required_fix: 'Assess risk level (low/medium/high/critical)',
      });
    }

    // Risks must be identified
    if (!risk.risks || risk.risks.length === 0) {
      violations.push({
        rule: 'Risk Assessment Quality',
        severity: 'high',
        description: 'No risks identified',
        required_fix: 'Identify potential risks (even if low probability)',
      });
    }

    // High/critical risk requires mitigations
    if ((risk.level === 'high' || risk.level === 'critical') &&
        (!risk.mitigations || risk.mitigations.length < this.MIN_RISK_MITIGATIONS)) {
      violations.push({
        rule: 'Risk Assessment Quality',
        severity: 'critical',
        description: `High/critical risk requires at least ${this.MIN_RISK_MITIGATIONS} mitigation strategy`,
        required_fix: 'Define how to prevent or reduce identified risks',
      });
    }

    // Worst-case scenario is required
    if (!risk.worst_case || risk.worst_case.trim().length === 0) {
      violations.push({
        rule: 'Risk Assessment Quality',
        severity: 'medium',
        description: 'Worst-case scenario not defined',
        required_fix: 'Describe the worst possible outcome',
      });
    }

    // Blast radius is required
    if (!risk.blast_radius) {
      violations.push({
        rule: 'Risk Assessment Quality',
        severity: 'medium',
        description: 'Blast radius not specified',
        required_fix: 'Define scope of potential damage',
      });
    }

    return violations;
  }

  /**
   * Rule 3: Validate rollback feasibility
   */
  private validateRollbackPlans(actions: ActionItem[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const action of actions) {
      const rollback = action.rollback_plan;

      // Rollback plan is required
      if (!rollback) {
        violations.push({
          rule: 'Rollback Feasibility',
          severity: 'critical',
          description: `Action ${action.action_id} has no rollback plan`,
          required_fix: 'Define rollback plan (automatic steps + manual instructions)',
        });
        continue;
      }

      // If can_rollback is true, must have steps or instructions
      if (rollback.can_rollback) {
        if ((!rollback.automatic_steps || rollback.automatic_steps.length === 0) &&
            (!rollback.manual_instructions || rollback.manual_instructions.length === 0)) {
          violations.push({
            rule: 'Rollback Feasibility',
            severity: 'high',
            description: `Action ${action.action_id} claims rollback is possible but provides no steps`,
            required_fix: 'Provide automatic steps or manual instructions for rollback',
          });
        }
      }

      // If can_rollback is false, must have manual instructions
      if (!rollback.can_rollback &&
          (!rollback.manual_instructions || rollback.manual_instructions.length === 0)) {
        violations.push({
          rule: 'Rollback Feasibility',
          severity: 'medium',
          description: `Action ${action.action_id} cannot be rolled back and has no manual recovery instructions`,
          required_fix: 'Provide manual recovery instructions',
        });
      }
    }

    return violations;
  }

  /**
   * Rule 4: Validate idempotency guarantee
   */
  private validateIdempotency(actions: ActionItem[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const seenKeys = new Set<string>();

    for (const action of actions) {
      // Idempotency key is required
      if (!action.idempotency_key || action.idempotency_key.trim().length === 0) {
        violations.push({
          rule: 'Idempotency Guarantee',
          severity: 'critical',
          description: `Action ${action.action_id} has no idempotency key`,
          required_fix: 'Generate unique idempotency key for this action',
        });
        continue;
      }

      // Idempotency keys must be unique within plan
      if (seenKeys.has(action.idempotency_key)) {
        violations.push({
          rule: 'Idempotency Guarantee',
          severity: 'critical',
          description: `Duplicate idempotency key: ${action.idempotency_key}`,
          required_fix: 'Ensure each action has a unique idempotency key',
        });
      }

      seenKeys.add(action.idempotency_key);
    }

    return violations;
  }

  /**
   * Rule 6: Validate impact alignment
   */
  private validateImpactAlignment(bundle: PlanBundle): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Impact and risk level should be aligned
    const impactLevels = ['low', 'medium', 'high', 'critical'];
    const impactIndex = impactLevels.indexOf(bundle.impact);
    const riskIndex = impactLevels.indexOf(bundle.risk.level);

    // Impact should not be lower than risk
    if (impactIndex < riskIndex) {
      violations.push({
        rule: 'Impact Alignment',
        severity: 'high',
        description: `Impact (${bundle.impact}) is lower than risk level (${bundle.risk.level})`,
        required_fix: 'Align impact level with risk assessment',
      });
    }

    // Critical impact requires user approval
    if (bundle.impact === 'critical' && !bundle.decision) {
      violations.push({
        rule: 'Impact Alignment',
        severity: 'critical',
        description: 'Critical impact requires explicit user approval',
        required_fix: 'Request user approval before execution',
      });
    }

    return violations;
  }

  /**
   * Check if PlanBundle requires user approval
   */
  requiresUserApproval(bundle: PlanBundle): boolean {
    // Critical impact always requires approval
    if (bundle.impact === 'critical') {
      return true;
    }

    // High risk requires approval
    if (bundle.risk.level === 'critical') {
      return true;
    }

    // Low confidence requires approval
    if (bundle.confidence < this.MIN_CONFIDENCE) {
      return true;
    }

    // No approval needed
    return false;
  }

  /**
   * Generate approval request message
   */
  generateApprovalRequest(bundle: PlanBundle, validation: PolicyValidationResult): string {
    let message = `🚨 **Approval Required**\n\n`;
    message += `**Plan:** ${bundle.title}\n`;
    message += `**Impact:** ${bundle.impact}\n`;
    message += `**Risk:** ${bundle.risk.level}\n`;
    message += `**Confidence:** ${(bundle.confidence * 100).toFixed(0)}%\n\n`;

    if (validation.violations.length > 0) {
      message += `**Policy Violations:** ${validation.violations.length}\n`;
      for (const violation of validation.violations.slice(0, 3)) {
        message += `- [${violation.severity}] ${violation.description}\n`;
      }
      if (validation.violations.length > 3) {
        message += `- ...and ${validation.violations.length - 3} more\n`;
      }
      message += '\n';
    }

    message += `**Actions:**\n`;
    for (const action of bundle.actions.slice(0, 5)) {
      message += `- ${action.description}\n`;
    }
    if (bundle.actions.length > 5) {
      message += `- ...and ${bundle.actions.length - 5} more\n`;
    }

    return message;
  }
}
