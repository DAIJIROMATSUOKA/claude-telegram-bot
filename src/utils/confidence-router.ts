/**
 * Confidence Router
 *
 * Routes autopilot proposals based on dynamic confidence thresholds.
 *
 * Thresholds by task type:
 * - maintenance: 0.9 (high confidence required - routine tasks)
 * - predictive: 0.8 (medium confidence - AI predictions)
 * - recovery: 0.7 (lower confidence acceptable - stalled task recovery)
 * - other: 0.85 (default)
 *
 * Phase: 4
 * Task-ID: CONFIDENCExROUTER_v1_2026-02-03
 */

import type { PluginProposal } from '../autopilot/types';

export type TaskType = 'maintenance' | 'predictive' | 'recovery' | 'monitoring' | 'optimization' | 'feature' | 'bugfix';
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';
export type RoutingDecision = 'auto_approve' | 'review_required' | 'red_team_required';

export interface ConfidenceThresholds {
  maintenance: number;
  predictive: number;
  recovery: number;
  monitoring: number;
  optimization: number;
  feature: number;
  bugfix: number;
  default: number;
}

export interface RoutingResult {
  decision: RoutingDecision;
  reason: string;
  confidence: number;
  threshold: number;
  requiresRedTeam: boolean;
  metadata: {
    taskType: string;
    impact: ImpactLevel;
    confidenceGap: number; // How far from threshold
    autoApproved: boolean;
  };
}

/**
 * Default confidence thresholds by task type
 */
export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  maintenance: 0.9,   // High confidence required for routine tasks
  predictive: 0.8,    // Medium confidence for AI predictions
  recovery: 0.7,      // Lower confidence acceptable for recovery
  monitoring: 0.85,   // Monitoring tasks
  optimization: 0.8,  // Optimization tasks
  feature: 0.85,      // New features
  bugfix: 0.8,        // Bug fixes
  default: 0.85,      // Fallback
};

/**
 * Confidence Router
 *
 * Routes proposals based on confidence scores and task characteristics.
 */
export class ConfidenceRouter {
  private thresholds: ConfidenceThresholds;

  constructor(thresholds?: Partial<ConfidenceThresholds>) {
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds,
    };
  }

  /**
   * Route a proposal based on confidence and risk factors
   */
  route(proposal: PluginProposal): RoutingResult {
    const taskType = proposal.task.type as TaskType;
    const confidence = proposal.task.confidence;
    const impact = proposal.task.impact;

    // Get threshold for this task type
    const threshold = this.getThreshold(taskType);
    const confidenceGap = confidence - threshold;

    // Determine if Red Team review is needed
    const requiresRedTeam = this.shouldTriggerRedTeam(confidence, impact);

    // Make routing decision
    let decision: RoutingDecision;
    let reason: string;

    if (requiresRedTeam) {
      decision = 'red_team_required';
      reason = this.getRedTeamReason(confidence, impact, threshold);
    } else if (confidence >= threshold && !proposal.approval_required) {
      decision = 'auto_approve';
      reason = `Confidence ${confidence.toFixed(2)} meets threshold ${threshold.toFixed(2)} for ${taskType} tasks`;
    } else {
      decision = 'review_required';
      reason = this.getReviewReason(confidence, threshold, proposal.approval_required);
    }

    return {
      decision,
      reason,
      confidence,
      threshold,
      requiresRedTeam,
      metadata: {
        taskType,
        impact,
        confidenceGap,
        autoApproved: decision === 'auto_approve',
      },
    };
  }

  /**
   * Get threshold for a specific task type
   */
  private getThreshold(taskType: TaskType): number {
    return this.thresholds[taskType] ?? this.thresholds.default;
  }

  /**
   * Determine if Red Team review should be triggered
   *
   * Triggers on:
   * - Confidence < 0.8 OR
   * - Impact = 'high' OR 'critical'
   */
  private shouldTriggerRedTeam(confidence: number, impact: ImpactLevel): boolean {
    return confidence < 0.8 || impact === 'high' || impact === 'critical';
  }

  /**
   * Generate reason for Red Team review
   */
  private getRedTeamReason(confidence: number, impact: ImpactLevel, threshold: number): string {
    const reasons: string[] = [];

    if (confidence < 0.8) {
      reasons.push(`confidence ${confidence.toFixed(2)} < 0.8`);
    }

    if (impact === 'high' || impact === 'critical') {
      reasons.push(`${impact} impact task`);
    }

    return `Red Team review required: ${reasons.join(', ')}`;
  }

  /**
   * Generate reason for manual review
   */
  private getReviewReason(confidence: number, threshold: number, approvalRequired: boolean): string {
    if (approvalRequired) {
      return `Manual approval required by plugin`;
    }

    return `Confidence ${confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}`;
  }

  /**
   * Update thresholds dynamically
   */
  updateThresholds(newThresholds: Partial<ConfidenceThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...newThresholds,
    };
  }

  /**
   * Get current thresholds
   */
  getThresholds(): ConfidenceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Calculate recommended threshold adjustment based on historical success rate
   *
   * @param taskType - Task type to adjust
   * @param successRate - Historical success rate (0.0-1.0)
   * @returns Recommended threshold adjustment (-0.1 to +0.1)
   */
  recommendThresholdAdjustment(taskType: TaskType, successRate: number): number {
    const currentThreshold = this.getThreshold(taskType);

    // If success rate is high (>0.95), we can lower threshold
    if (successRate > 0.95) {
      return -0.05;
    }

    // If success rate is low (<0.85), we should raise threshold
    if (successRate < 0.85) {
      return +0.05;
    }

    // Success rate is acceptable, no adjustment needed
    return 0;
  }

  /**
   * Generate routing statistics for a batch of proposals
   */
  analyzeProposals(proposals: PluginProposal[]): {
    total: number;
    autoApproved: number;
    reviewRequired: number;
    redTeamRequired: number;
    byTaskType: Record<string, number>;
    averageConfidence: number;
  } {
    const results = proposals.map(p => this.route(p));

    const stats = {
      total: proposals.length,
      autoApproved: results.filter(r => r.decision === 'auto_approve').length,
      reviewRequired: results.filter(r => r.decision === 'review_required').length,
      redTeamRequired: results.filter(r => r.decision === 'red_team_required').length,
      byTaskType: {} as Record<string, number>,
      averageConfidence: 0,
    };

    // Count by task type
    for (const proposal of proposals) {
      const type = proposal.task.type;
      stats.byTaskType[type] = (stats.byTaskType[type] || 0) + 1;
    }

    // Calculate average confidence
    stats.averageConfidence = proposals.reduce((sum, p) => sum + p.task.confidence, 0) / proposals.length;

    return stats;
  }
}

/**
 * Default router instance
 */
export const defaultRouter = new ConfidenceRouter();

/**
 * Route a proposal using the default router
 */
export function routeProposal(proposal: PluginProposal): RoutingResult {
  return defaultRouter.route(proposal);
}
