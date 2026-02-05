/**
 * Weekly Review Plugin
 *
 * Provides weekly retrospective analysis:
 * - Learning Log statistics
 * - Success rate by plugin/task type
 * - Confidence threshold recommendations
 * - Common error patterns
 * - Performance metrics
 *
 * Trigger: Every Sunday at 19:00 JST
 *
 * Phase: 5
 */

import type { AutopilotPlugin } from '../types';
import type { AutopilotTask } from '../engine';
import { LearningLog } from '../../utils/learning-log';

export class WeeklyReviewPlugin implements AutopilotPlugin {
  name = 'weekly-review';
  version = '1.0.0';
  description = 'Weekly retrospective with Learning Log analysis';
  executionTimeout = 30000; // 30 seconds

  private memoryGatewayUrl: string;
  private botToken?: string;

  constructor(memoryGatewayUrl: string, botToken?: string) {
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.botToken = botToken;
  }

  /**
   * Check if weekly review should trigger
   */
  async detectTriggers(): Promise<AutopilotTask[]> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const hour = now.getHours();

    // Trigger every Sunday at 19:00 JST
    if (dayOfWeek === 0 && hour === 19) {
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekLabel = `${lastWeek.toISOString().substring(0, 10)} to ${now.toISOString().substring(0, 10)}`;

      return [
        {
          id: `task_weekly_review_${now.toISOString().substring(0, 10)}`,
          type: 'maintenance',
          title: `Weekly Review (${weekLabel})`,
          description: 'Analyze Learning Log statistics, identify patterns, and provide recommendations',
          reason: 'Scheduled weekly review',
          confidence: 0.95,
          impact: 'low',
          created_at: now.toISOString(),
          status: 'proposed',
          source_plugin: this.name,
        },
      ];
    }

    return [];
  }

  /**
   * Execute weekly review
   */
  async executeTask(task: AutopilotTask): Promise<void> {
    const learningLog = new LearningLog(this.memoryGatewayUrl);

    // Fetch statistics
    const stats = await learningLog.getStatistics();

    // Generate report
    const report = this.generateReport(stats);

    // Send to user via ProactiveSecretary if available
    if (this.botToken) {
      const { ProactiveSecretary } = await import('../../services/proactive-secretary');
      const chatId = process.env.TELEGRAM_CHAT_ID;

      if (chatId) {
        const secretary = new ProactiveSecretary(this.botToken, chatId);
        // Send weekly review via Telegram
        await this.sendTelegramMessage(chatId, report);
      }
    }

    console.log('[WeeklyReview] Report generated:', report);
  }

  /**
   * Generate weekly review report
   */
  private generateReport(stats: any): string {
    let report = '📊 **Weekly Autopilot Review**\n\n';

    // Overall statistics
    report += '## Overall Performance\n\n';
    report += `- **Total Executions:** ${stats.total_executions}\n`;
    report += `- **Success Count:** ${stats.success_count} ✅\n`;
    report += `- **Failure Count:** ${stats.failure_count} ❌\n`;
    report += `- **Success Rate:** ${(stats.success_rate * 100).toFixed(1)}%\n`;
    report += `- **Avg Execution Time:** ${stats.avg_execution_time_ms.toFixed(0)}ms\n\n`;

    // Performance rating
    const rating = this.getPerformanceRating(stats.success_rate);
    report += `**Performance Rating:** ${rating}\n\n`;

    // By plugin
    if (Object.keys(stats.by_plugin).length > 0) {
      report += '## Performance by Plugin\n\n';
      for (const [plugin, data] of Object.entries(stats.by_plugin)) {
        const pluginData = data as { success: number; failure: number; success_rate: number };
        const total = pluginData.success + pluginData.failure;
        const emoji = pluginData.success_rate >= 0.8 ? '✅' : pluginData.success_rate >= 0.6 ? '⚠️' : '❌';
        report += `${emoji} **${plugin}**\n`;
        report += `   - Success: ${pluginData.success}/${total} (${(pluginData.success_rate * 100).toFixed(1)}%)\n`;
      }
      report += '\n';
    }

    // By task type
    if (Object.keys(stats.by_task_type).length > 0) {
      report += '## Performance by Task Type\n\n';
      for (const [type, data] of Object.entries(stats.by_task_type)) {
        const typeData = data as { success: number; failure: number; success_rate: number };
        const total = typeData.success + typeData.failure;
        const emoji = typeData.success_rate >= 0.8 ? '✅' : typeData.success_rate >= 0.6 ? '⚠️' : '❌';
        report += `${emoji} **${type}**\n`;
        report += `   - Success: ${typeData.success}/${total} (${(typeData.success_rate * 100).toFixed(1)}%)\n`;
      }
      report += '\n';
    }

    // Recommendations
    report += '## Recommendations\n\n';
    const recommendations = this.generateRecommendations(stats);
    if (recommendations.length > 0) {
      recommendations.forEach((rec) => {
        report += `- ${rec}\n`;
      });
    } else {
      report += '- No specific recommendations. Keep up the good work! 🎉\n';
    }

    report += '\n---\n';
    report += `*Generated: ${new Date().toISOString()}*\n`;

    return report;
  }

  /**
   * Get performance rating based on success rate
   */
  private getPerformanceRating(successRate: number): string {
    if (successRate >= 0.95) return '🌟 Excellent';
    if (successRate >= 0.85) return '✅ Good';
    if (successRate >= 0.75) return '⚠️ Fair';
    if (successRate >= 0.60) return '❌ Poor';
    return '🚨 Critical';
  }

  /**
   * Generate recommendations based on statistics
   */
  private generateRecommendations(stats: any): string[] {
    const recommendations: string[] = [];

    // Overall success rate
    if (stats.success_rate < 0.7) {
      recommendations.push('🚨 Overall success rate is low (<70%). Review plugin implementations and error handling.');
    } else if (stats.success_rate > 0.95) {
      recommendations.push('🎉 Excellent success rate (>95%)! Consider lowering confidence thresholds for more automation.');
    }

    // Execution time
    if (stats.avg_execution_time_ms > 30000) {
      recommendations.push('⏱️ Average execution time is high (>30s). Consider optimizing slow plugins or adding caching.');
    }

    // Plugin-specific recommendations
    for (const [plugin, data] of Object.entries(stats.by_plugin)) {
      const pluginData = data as { success: number; failure: number; success_rate: number };
      if (pluginData.success_rate < 0.6) {
        recommendations.push(`❌ Plugin "${plugin}" has low success rate (<60%). Investigate and fix issues.`);
      } else if (pluginData.success_rate > 0.98 && (pluginData.success + pluginData.failure) > 10) {
        recommendations.push(`✅ Plugin "${plugin}" has excellent success rate (>98%). Consider increasing automation.`);
      }
    }

    // Task type-specific recommendations
    for (const [type, data] of Object.entries(stats.by_task_type)) {
      const typeData = data as { success: number; failure: number; success_rate: number };
      if (typeData.success_rate < 0.6) {
        recommendations.push(`⚠️ Task type "${type}" has low success rate (<60%). Review confidence thresholds.`);
      }
    }

    // Data volume
    if (stats.total_executions < 10) {
      recommendations.push('📊 Limited execution data (<10). Continue monitoring for more insights.');
    }

    return recommendations;
  }

  /**
   * Send message to Telegram
   */
  private async sendTelegramMessage(chatId: string, message: string): Promise<void> {
    if (!this.botToken) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        console.error('[WeeklyReview] Failed to send Telegram message:', await response.text());
      }
    } catch (error) {
      console.error('[WeeklyReview] Error sending Telegram message:', error);
    }
  }
}
