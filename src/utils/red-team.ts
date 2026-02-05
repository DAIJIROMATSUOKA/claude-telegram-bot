/**
 * Red Team Validator
 *
 * Devil's advocate analysis for high-risk or low-confidence proposals.
 *
 * Triggers on:
 * - Confidence < 0.8
 * - Impact = 'high' or 'critical'
 *
 * Validates:
 * - Risk assessment
 * - Action plan completeness
 * - Failure scenarios
 * - Rollback strategies
 *
 * Phase: 4
 * Task-ID: REDTEAMxVALIDATOR_v1_2026-02-03
 */

import type { PluginProposal } from '../autopilot/types';
import type { ImpactLevel } from './confidence-router';

export type ValidationSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ValidationIssue {
  severity: ValidationSeverity;
  category: 'risk' | 'completeness' | 'safety' | 'dependency' | 'rollback';
  message: string;
  recommendation: string;
}

export interface RedTeamResult {
  approved: boolean;
  confidence_adjustment: number; // Adjustment to original confidence (-0.2 to +0.1)
  issues: ValidationIssue[];
  recommendations: string[];
  risk_score: number; // 0.0 (safe) to 1.0 (dangerous)
  summary: string;
}

/**
 * Red Team Validator
 *
 * Performs devil's advocate analysis on proposals.
 */
export class RedTeamValidator {
  /**
   * Validate a proposal
   */
  validate(proposal: PluginProposal): RedTeamResult {
    const issues: ValidationIssue[] = [];

    // Run all validation checks
    this.checkRiskAssessment(proposal, issues);
    this.checkActionPlan(proposal, issues);
    this.checkFailureScenarios(proposal, issues);
    this.checkRollbackStrategy(proposal, issues);
    this.checkDependencies(proposal, issues);
    this.checkImpact(proposal, issues);

    // Calculate risk score based on issues
    const riskScore = this.calculateRiskScore(proposal, issues);

    // Determine if proposal should be approved
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const errorIssues = issues.filter(i => i.severity === 'error');
    const approved = criticalIssues.length === 0 && errorIssues.length === 0;

    // Calculate confidence adjustment
    const confidenceAdjustment = this.calculateConfidenceAdjustment(issues, riskScore);

    // Generate recommendations
    const recommendations = this.generateRecommendations(proposal, issues);

    // Generate summary
    const summary = this.generateSummary(approved, issues, riskScore);

    return {
      approved,
      confidence_adjustment: confidenceAdjustment,
      issues,
      recommendations,
      risk_score: riskScore,
      summary,
    };
  }

  /**
   * Check if risk assessment is adequate
   */
  private checkRiskAssessment(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const risks = proposal.risks || [];

    if (risks.length === 0 && proposal.task.impact !== 'low') {
      issues.push({
        severity: 'warning',
        category: 'risk',
        message: 'No risks identified for non-low impact task',
        recommendation: 'Add at least one potential risk scenario',
      });
    }

    // Check for vague risk descriptions
    const vagueRisks = risks.filter(r => r.length < 20);
    if (vagueRisks.length > 0) {
      issues.push({
        severity: 'info',
        category: 'risk',
        message: `${vagueRisks.length} risk(s) have vague descriptions`,
        recommendation: 'Provide more specific risk descriptions',
      });
    }
  }

  /**
   * Check if action plan is complete
   */
  private checkActionPlan(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const plan = proposal.action_plan || [];

    if (plan.length === 0) {
      issues.push({
        severity: 'error',
        category: 'completeness',
        message: 'Action plan is empty',
        recommendation: 'Provide a detailed step-by-step action plan',
      });
      return;
    }

    if (plan.length === 1) {
      issues.push({
        severity: 'warning',
        category: 'completeness',
        message: 'Action plan has only one step',
        recommendation: 'Break down into more granular steps',
      });
    }

    // Check for verification steps
    const hasVerification = plan.some(step =>
      step.toLowerCase().includes('verify') ||
      step.toLowerCase().includes('test') ||
      step.toLowerCase().includes('check')
    );

    if (!hasVerification && proposal.task.impact !== 'low') {
      issues.push({
        severity: 'warning',
        category: 'safety',
        message: 'Action plan lacks verification steps',
        recommendation: 'Add verification/testing steps to action plan',
      });
    }
  }

  /**
   * Check if failure scenarios are considered
   */
  private checkFailureScenarios(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const description = proposal.task.description.toLowerCase();
    const risks = (proposal.risks || []).join(' ').toLowerCase();

    const hasFailureConsideration =
      description.includes('fail') ||
      description.includes('error') ||
      risks.includes('fail') ||
      risks.includes('error');

    if (!hasFailureConsideration && proposal.task.impact !== 'low') {
      issues.push({
        severity: 'warning',
        category: 'safety',
        message: 'No failure scenarios considered',
        recommendation: 'Document potential failure modes and handling',
      });
    }
  }

  /**
   * Check if rollback strategy exists
   */
  private checkRollbackStrategy(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const plan = (proposal.action_plan || []).join(' ').toLowerCase();
    const risks = (proposal.risks || []).join(' ').toLowerCase();

    const hasRollback =
      plan.includes('rollback') ||
      plan.includes('revert') ||
      plan.includes('undo') ||
      risks.includes('rollback');

    if (!hasRollback && (proposal.task.impact === 'high' || proposal.task.impact === 'critical')) {
      issues.push({
        severity: 'error',
        category: 'rollback',
        message: 'No rollback strategy for high-impact task',
        recommendation: 'Define rollback/revert strategy before execution',
      });
    }
  }

  /**
   * Check for dependency risks
   */
  private checkDependencies(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const description = proposal.task.description.toLowerCase();

    // Check for external dependencies
    const hasExternalDeps =
      description.includes('api') ||
      description.includes('network') ||
      description.includes('external') ||
      description.includes('third-party');

    if (hasExternalDeps) {
      const hasTimeoutMention =
        description.includes('timeout') ||
        description.includes('retry');

      if (!hasTimeoutMention) {
        issues.push({
          severity: 'warning',
          category: 'dependency',
          message: 'External dependencies without timeout/retry strategy',
          recommendation: 'Add timeout and retry logic for external calls',
        });
      }
    }
  }

  /**
   * Check impact-specific concerns
   */
  private checkImpact(proposal: PluginProposal, issues: ValidationIssue[]): void {
    const impact = proposal.task.impact;

    if (impact === 'critical') {
      // Critical tasks require extra scrutiny
      if (proposal.task.confidence < 0.9) {
        issues.push({
          severity: 'critical',
          category: 'safety',
          message: 'Critical impact task with confidence < 0.9',
          recommendation: 'Increase confidence to 0.9+ or reduce impact level',
        });
      }

      if (!proposal.approval_required) {
        issues.push({
          severity: 'error',
          category: 'safety',
          message: 'Critical task does not require approval',
          recommendation: 'Set approval_required = true for critical tasks',
        });
      }
    }

    if (impact === 'high' && proposal.task.confidence < 0.75) {
      issues.push({
        severity: 'error',
        category: 'safety',
        message: 'High impact task with very low confidence (<0.75)',
        recommendation: 'Improve confidence or reduce impact level',
      });
    }
  }

  /**
   * Calculate overall risk score
   */
  private calculateRiskScore(proposal: PluginProposal, issues: ValidationIssue[]): number {
    let score = 0;

    // Base score from impact
    const impactScores: Record<ImpactLevel, number> = {
      low: 0.1,
      medium: 0.3,
      high: 0.6,
      critical: 0.9,
    };
    score += impactScores[proposal.task.impact as ImpactLevel] || 0.3;

    // Adjust for confidence (inverse relationship)
    score += (1 - proposal.task.confidence) * 0.3;

    // Add points for issues
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score += 0.2;
          break;
        case 'error':
          score += 0.1;
          break;
        case 'warning':
          score += 0.05;
          break;
        case 'info':
          score += 0.01;
          break;
      }
    }

    // Cap at 1.0
    return Math.min(score, 1.0);
  }

  /**
   * Calculate confidence adjustment based on validation
   */
  private calculateConfidenceAdjustment(issues: ValidationIssue[], riskScore: number): number {
    let adjustment = 0;

    // Deduct for issues
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          adjustment -= 0.2;
          break;
        case 'error':
          adjustment -= 0.1;
          break;
        case 'warning':
          adjustment -= 0.05;
          break;
        case 'info':
          adjustment -= 0.01;
          break;
      }
    }

    // Small bonus if no issues found
    if (issues.length === 0) {
      adjustment += 0.05;
    }

    // Cap adjustment range
    return Math.max(-0.2, Math.min(0.1, adjustment));
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(proposal: PluginProposal, issues: ValidationIssue[]): string[] {
    const recommendations = new Set<string>();

    // Extract unique recommendations from issues
    for (const issue of issues) {
      recommendations.add(issue.recommendation);
    }

    // Add general recommendations based on proposal characteristics
    if (proposal.task.impact === 'high' || proposal.task.impact === 'critical') {
      recommendations.add('Consider breaking this task into smaller, lower-impact steps');
    }

    if (proposal.task.confidence < 0.7) {
      recommendations.add('Gather more context or data to increase confidence');
    }

    return Array.from(recommendations);
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(approved: boolean, issues: ValidationIssue[], riskScore: number): string {
    if (approved && issues.length === 0) {
      return `✅ Proposal approved with no issues. Risk score: ${riskScore.toFixed(2)}`;
    }

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (!approved) {
      return `❌ Proposal rejected. Found ${criticalCount} critical and ${errorCount} error issues. Risk score: ${riskScore.toFixed(2)}`;
    }

    return `⚠️ Proposal approved with concerns. Found ${warningCount} warnings. Risk score: ${riskScore.toFixed(2)}`;
  }
}

/**
 * Default validator instance
 */
export const defaultRedTeam = new RedTeamValidator();

/**
 * Validate a proposal using the default Red Team
 */
export function validateProposal(proposal: PluginProposal): RedTeamResult {
  return defaultRedTeam.validate(proposal);
}
