/**
 * Learning Log
 *
 * Records autopilot execution patterns for success/failure analysis.
 * Uses Memory Gateway events infrastructure for persistence.
 *
 * Event types:
 * - autopilot.execution.success
 * - autopilot.execution.failure
 * - autopilot.pattern.learned
 *
 * Phase: 4
 * Task-ID: LEARNINGxLOG_v1_2026-02-03
 */

import type { PluginProposal } from '../autopilot/types';
import type { RoutingResult } from './confidence-router';
import type { RedTeamResult } from './red-team';

export interface ExecutionRecord {
  proposal_id: string;
  plugin_name: string;
  task_type: string;
  confidence: number;
  impact: string;
  routing_decision: string;
  red_team_approved?: boolean;
  red_team_risk_score?: number;
  success: boolean;
  execution_time_ms: number;
  error_message?: string;
  timestamp: string;
}

export interface LearningPattern {
  pattern_type: 'success' | 'failure';
  plugin_name: string;
  task_type: string;
  confidence_range: [number, number];
  impact_level: string;
  occurrences: number;
  success_rate: number;
  avg_execution_time_ms: number;
  common_errors: string[];
  recommendations: string[];
}

/**
 * Learning Log
 *
 * Records and analyzes autopilot execution patterns.
 */
export class LearningLog {
  private memoryGatewayUrl: string;
  private scope: string = 'private/agent/jarvis';

  constructor(memoryGatewayUrl: string) {
    this.memoryGatewayUrl = memoryGatewayUrl;
  }

  /**
   * Record successful execution
   */
  async recordSuccess(
    proposal: PluginProposal,
    routingResult: RoutingResult,
    redTeamResult: RedTeamResult | null,
    executionTimeMs: number
  ): Promise<void> {
    const record: ExecutionRecord = {
      proposal_id: proposal.task.id,
      plugin_name: proposal.task.source_plugin,
      task_type: proposal.task.type,
      confidence: proposal.task.confidence,
      impact: proposal.task.impact,
      routing_decision: routingResult.decision,
      red_team_approved: redTeamResult?.approved,
      red_team_risk_score: redTeamResult?.risk_score,
      success: true,
      execution_time_ms: executionTimeMs,
      timestamp: new Date().toISOString(),
    };

    await this.recordEvent('autopilot.execution.success', record);
  }

  /**
   * Record failed execution
   */
  async recordFailure(
    proposal: PluginProposal,
    routingResult: RoutingResult,
    redTeamResult: RedTeamResult | null,
    executionTimeMs: number,
    errorMessage: string
  ): Promise<void> {
    const record: ExecutionRecord = {
      proposal_id: proposal.task.id,
      plugin_name: proposal.task.source_plugin,
      task_type: proposal.task.type,
      confidence: proposal.task.confidence,
      impact: proposal.task.impact,
      routing_decision: routingResult.decision,
      red_team_approved: redTeamResult?.approved,
      red_team_risk_score: redTeamResult?.risk_score,
      success: false,
      execution_time_ms: executionTimeMs,
      error_message: errorMessage,
      timestamp: new Date().toISOString(),
    };

    await this.recordEvent('autopilot.execution.failure', record);
  }

  /**
   * Record a learned pattern
   */
  async recordPattern(pattern: LearningPattern): Promise<void> {
    await this.recordEvent('autopilot.pattern.learned', pattern);
  }

  /**
   * Get execution history for a plugin
   */
  async getPluginHistory(pluginName: string, limit: number = 50): Promise<ExecutionRecord[]> {
    try {
      const response = await fetch(
        `${this.memoryGatewayUrl}/v1/events?scope=${this.scope}&type=autopilot.execution&limit=${limit}`
      );

      if (!response.ok) {
        console.error('[LearningLog] Failed to fetch history:', response.statusText);
        return [];
      }

      const data = await response.json() as any;
      const events = data.results || [];

      // Filter by plugin name
      return events
        .filter((e: any) => e.data?.plugin_name === pluginName)
        .map((e: any) => e.data as ExecutionRecord);
    } catch (error) {
      console.error('[LearningLog] Error fetching history:', error);
      return [];
    }
  }

  /**
   * Calculate success rate for a plugin
   */
  async getSuccessRate(pluginName: string): Promise<number> {
    const history = await this.getPluginHistory(pluginName, 100);

    if (history.length === 0) {
      return 0;
    }

    const successCount = history.filter(r => r.success).length;
    return successCount / history.length;
  }

  /**
   * Analyze patterns and generate recommendations
   * Phase 4 Enhancement: Advanced pattern detection with trend analysis
   */
  async analyzePatterns(pluginName: string): Promise<LearningPattern[]> {
    const history = await this.getPluginHistory(pluginName, 200);

    if (history.length < 5) {
      // Not enough data for pattern analysis
      return [];
    }

    // Group by task_type and confidence range
    const patterns = new Map<string, ExecutionRecord[]>();

    for (const record of history) {
      const confidenceRange = this.getConfidenceRange(record.confidence);
      const key = `${record.task_type}-${confidenceRange[0]}-${confidenceRange[1]}`;

      if (!patterns.has(key)) {
        patterns.set(key, []);
      }
      patterns.get(key)!.push(record);
    }

    // Generate learning patterns
    const learningPatterns: LearningPattern[] = [];

    for (const [key, records] of patterns.entries()) {
      if (records.length < 3) {
        // Skip patterns with insufficient data
        continue;
      }

      const successCount = records.filter(r => r.success).length;
      const successRate = successCount / records.length;
      const avgExecutionTime = records.reduce((sum, r) => sum + r.execution_time_ms, 0) / records.length;

      // Extract common errors
      const errors = records
        .filter(r => !r.success && r.error_message)
        .map(r => r.error_message!);
      const commonErrors = this.findCommonErrors(errors);

      // Phase 4: Advanced recommendations with trend analysis
      const recommendations = this.generateAdvancedRecommendations(
        records[0]!.task_type,
        successRate,
        avgExecutionTime,
        commonErrors,
        records
      );

      learningPatterns.push({
        pattern_type: successRate >= 0.8 ? 'success' : 'failure',
        plugin_name: pluginName,
        task_type: records[0]!.task_type,
        confidence_range: this.getConfidenceRange(records[0]!.confidence),
        impact_level: records[0]!.impact,
        occurrences: records.length,
        success_rate: successRate,
        avg_execution_time_ms: avgExecutionTime,
        common_errors: commonErrors,
        recommendations,
      });
    }

    return learningPatterns;
  }

  /**
   * Phase 4: Analyze all patterns across all plugins for weekly review
   */
  async analyzeAllPatterns(): Promise<{
    total_patterns: number;
    success_patterns: LearningPattern[];
    failure_patterns: LearningPattern[];
    trending_up: LearningPattern[];
    trending_down: LearningPattern[];
    recommendations: string[];
  }> {
    const stats = await this.getStatistics();
    const allPatterns: LearningPattern[] = [];

    // Analyze each plugin
    for (const pluginName in stats.by_plugin) {
      const patterns = await this.analyzePatterns(pluginName);
      allPatterns.push(...patterns);
    }

    const successPatterns = allPatterns.filter(p => p.pattern_type === 'success');
    const failurePatterns = allPatterns.filter(p => p.pattern_type === 'failure');

    // Identify trending patterns (Phase 4: Trend analysis)
    const trendingUp = this.identifyTrendingPatterns(allPatterns, 'up');
    const trendingDown = this.identifyTrendingPatterns(allPatterns, 'down');

    // Generate system-wide recommendations
    const recommendations = this.generateSystemRecommendations(stats, allPatterns);

    return {
      total_patterns: allPatterns.length,
      success_patterns: successPatterns,
      failure_patterns: failurePatterns,
      trending_up: trendingUp,
      trending_down: trendingDown,
      recommendations,
    };
  }

  /**
   * Phase 4: Identify trending patterns (improving or degrading over time)
   */
  private identifyTrendingPatterns(patterns: LearningPattern[], direction: 'up' | 'down'): LearningPattern[] {
    // For MVP, return patterns with extreme success rates
    if (direction === 'up') {
      return patterns.filter(p => p.success_rate > 0.9 && p.occurrences >= 5).slice(0, 3);
    } else {
      return patterns.filter(p => p.success_rate < 0.5 && p.occurrences >= 5).slice(0, 3);
    }
  }

  /**
   * Phase 4: Generate system-wide recommendations
   */
  private generateSystemRecommendations(
    stats: Awaited<ReturnType<typeof this.getStatistics>>,
    patterns: LearningPattern[]
  ): string[] {
    const recommendations: string[] = [];

    // Overall success rate
    if (stats.success_rate < 0.8) {
      recommendations.push(
        `⚠️ System success rate is ${(stats.success_rate * 100).toFixed(0)}% - below target of 80%`
      );
    } else if (stats.success_rate > 0.95) {
      recommendations.push(
        `✅ Excellent system success rate (${(stats.success_rate * 100).toFixed(0)}%) - consider expanding autopilot scope`
      );
    }

    // Plugin-specific issues
    for (const [plugin, pluginStats] of Object.entries(stats.by_plugin)) {
      if (pluginStats.success_rate < 0.7) {
        recommendations.push(`⚠️ Plugin "${plugin}" has low success rate (${(pluginStats.success_rate * 100).toFixed(0)}%)`);
      }
    }

    // Identify high-risk task types
    for (const [taskType, taskStats] of Object.entries(stats.by_task_type)) {
      if (taskStats.success_rate < 0.6 && taskStats.success + taskStats.failure >= 5) {
        recommendations.push(`🚨 Task type "${taskType}" is high-risk (${(taskStats.success_rate * 100).toFixed(0)}% success rate)`);
      }
    }

    // Performance issues
    if (stats.avg_execution_time_ms > 30000) {
      recommendations.push(`⏱️ Average execution time is ${(stats.avg_execution_time_ms / 1000).toFixed(1)}s - consider performance optimization`);
    }

    return recommendations;
  }

  /**
   * Get statistics for all plugins
   */
  async getStatistics(): Promise<{
    total_executions: number;
    success_count: number;
    failure_count: number;
    success_rate: number;
    avg_execution_time_ms: number;
    by_plugin: Record<string, { success: number; failure: number; success_rate: number }>;
    by_task_type: Record<string, { success: number; failure: number; success_rate: number }>;
  }> {
    try {
      const response = await fetch(
        `${this.memoryGatewayUrl}/v1/events?scope=${this.scope}&type=autopilot.execution&limit=500`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch statistics: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const events = data.results || [];
      const records = events.map((e: any) => e.data as ExecutionRecord);

      const stats = {
        total_executions: records.length,
        success_count: records.filter((r: any) => r.success).length,
        failure_count: records.filter((r: any) => !r.success).length,
        success_rate: 0,
        avg_execution_time_ms: 0,
        by_plugin: {} as Record<string, { success: number; failure: number; success_rate: number }>,
        by_task_type: {} as Record<string, { success: number; failure: number; success_rate: number }>,
      };

      if (records.length > 0) {
        stats.success_rate = stats.success_count / stats.total_executions;
        stats.avg_execution_time_ms = records.reduce((sum: any, r: any) => sum + r.execution_time_ms, 0) / records.length;
      }

      // Group by plugin
      for (const record of records) {
        if (!stats.by_plugin[record.plugin_name]) {
          stats.by_plugin[record.plugin_name] = { success: 0, failure: 0, success_rate: 0 };
        }
        if (record.success) {
          stats.by_plugin[record.plugin_name]!.success++;
        } else {
          stats.by_plugin[record.plugin_name]!.failure++;
        }
      }

      // Calculate success rates by plugin
      for (const plugin in stats.by_plugin) {
        const total = stats.by_plugin[plugin]!.success + stats.by_plugin[plugin]!.failure;
        stats.by_plugin[plugin]!.success_rate = stats.by_plugin[plugin]!.success / total;
      }

      // Group by task type
      for (const record of records) {
        if (!stats.by_task_type[record.task_type]) {
          stats.by_task_type[record.task_type] = { success: 0, failure: 0, success_rate: 0 };
        }
        if (record.success) {
          stats.by_task_type[record.task_type]!.success++;
        } else {
          stats.by_task_type[record.task_type]!.failure++;
        }
      }

      // Calculate success rates by task type
      for (const type in stats.by_task_type) {
        const total = stats.by_task_type[type]!.success + stats.by_task_type[type]!.failure;
        stats.by_task_type[type]!.success_rate = stats.by_task_type[type]!.success / total;
      }

      return stats;
    } catch (error) {
      console.error('[LearningLog] Error fetching statistics:', error);
      throw error;
    }
  }

  /**
   * Record event to Memory Gateway
   */
  private async recordEvent(type: string, data: any): Promise<void> {
    try {
      const event = {
        type,
        scope: this.scope,
        data,
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(`${this.memoryGatewayUrl}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        console.error('[LearningLog] Failed to record event:', response.statusText);
      }
    } catch (error) {
      console.error('[LearningLog] Error recording event:', error);
    }
  }

  /**
   * Get confidence range bucket (0.0-0.3, 0.3-0.5, 0.5-0.7, 0.7-0.85, 0.85-1.0)
   */
  private getConfidenceRange(confidence: number): [number, number] {
    if (confidence < 0.3) return [0.0, 0.3];
    if (confidence < 0.5) return [0.3, 0.5];
    if (confidence < 0.7) return [0.5, 0.7];
    if (confidence < 0.85) return [0.7, 0.85];
    return [0.85, 1.0];
  }

  /**
   * Find common error patterns
   */
  private findCommonErrors(errors: string[]): string[] {
    if (errors.length === 0) return [];

    // Count error frequencies
    const errorCounts = new Map<string, number>();
    for (const error of errors) {
      // Normalize error message (first 100 chars)
      const normalized = error.substring(0, 100);
      errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
    }

    // Return errors that appear more than once
    return Array.from(errorCounts.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([error, _]) => error);
  }

  /**
   * Generate recommendations based on patterns (legacy method - kept for compatibility)
   */
  private generateRecommendations(
    taskType: string,
    successRate: number,
    avgExecutionTime: number,
    commonErrors: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (successRate < 0.7) {
      recommendations.push(`Low success rate (${(successRate * 100).toFixed(0)}%) - consider increasing confidence threshold`);
    }

    if (successRate > 0.95) {
      recommendations.push(`High success rate (${(successRate * 100).toFixed(0)}%) - consider lowering confidence threshold`);
    }

    if (avgExecutionTime > 60000) {
      recommendations.push(`Long execution time (${(avgExecutionTime / 1000).toFixed(1)}s) - consider timeout optimization`);
    }

    if (commonErrors.length > 0) {
      recommendations.push(`Common errors detected - implement specific error handling`);
    }

    return recommendations;
  }

  /**
   * Phase 4: Advanced recommendations with trend analysis
   */
  private generateAdvancedRecommendations(
    taskType: string,
    successRate: number,
    avgExecutionTime: number,
    commonErrors: string[],
    records: ExecutionRecord[]
  ): string[] {
    const recommendations: string[] = [];

    // Success rate analysis
    if (successRate < 0.7) {
      recommendations.push(`Low success rate (${(successRate * 100).toFixed(0)}%) - consider increasing confidence threshold`);
    } else if (successRate > 0.95) {
      recommendations.push(`High success rate (${(successRate * 100).toFixed(0)}%) - consider lowering confidence threshold to enable more automation`);
    }

    // Execution time analysis
    if (avgExecutionTime > 60000) {
      recommendations.push(`Long execution time (${(avgExecutionTime / 1000).toFixed(1)}s) - consider timeout optimization`);
    } else if (avgExecutionTime < 1000) {
      recommendations.push(`Fast execution (${avgExecutionTime.toFixed(0)}ms) - excellent performance`);
    }

    // Error pattern analysis
    if (commonErrors.length > 0) {
      recommendations.push(`${commonErrors.length} common error patterns detected - create Golden Tests to prevent recurrence`);
    }

    // Trend analysis (comparing first half vs second half)
    if (records.length >= 10) {
      const midpoint = Math.floor(records.length / 2);
      const firstHalf = records.slice(0, midpoint);
      const secondHalf = records.slice(midpoint);

      const firstHalfSuccess = firstHalf.filter(r => r.success).length / firstHalf.length;
      const secondHalfSuccess = secondHalf.filter(r => r.success).length / secondHalf.length;

      const trend = secondHalfSuccess - firstHalfSuccess;

      if (trend > 0.1) {
        recommendations.push(`📈 Improving trend: Success rate increased by ${(trend * 100).toFixed(0)}%`);
      } else if (trend < -0.1) {
        recommendations.push(`📉 Declining trend: Success rate decreased by ${(Math.abs(trend) * 100).toFixed(0)}% - investigate recent changes`);
      }
    }

    // Red Team correlation analysis
    const redTeamRecords = records.filter(r => r.red_team_approved !== undefined);
    if (redTeamRecords.length >= 5) {
      const redTeamApproved = redTeamRecords.filter(r => r.red_team_approved);
      const redTeamRejected = redTeamRecords.filter(r => !r.red_team_approved);

      if (redTeamApproved.length > 0 && redTeamRejected.length > 0) {
        const approvedSuccess = redTeamApproved.filter(r => r.success).length / redTeamApproved.length;
        const rejectedSuccess = redTeamRejected.filter(r => r.success).length / (redTeamRejected.length || 1);

        if (approvedSuccess > rejectedSuccess + 0.2) {
          recommendations.push(`🛡️ Red Team validation is effective - approved tasks succeed ${((approvedSuccess - rejectedSuccess) * 100).toFixed(0)}% more often`);
        }
      }
    }

    return recommendations;
  }
}
