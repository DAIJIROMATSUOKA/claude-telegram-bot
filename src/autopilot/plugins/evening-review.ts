/**
 * Evening Review Plugin
 *
 * Provides evening review as Autopilot plugin.
 * Integrates with ProactiveSecretary for task analysis.
 *
 * Task-ID: AUTOPILOTxMEMORY_v1_2026-02-03
 */

import type { AutopilotPlugin, PluginTrigger, PluginProposal } from '../types';
import type { AutopilotContext } from '../engine';
import { ProactiveSecretary } from '../../services/proactive-secretary';

export class EveningReviewPlugin implements AutopilotPlugin {
  name = 'evening-review';
  description = 'Daily evening review with task completion summary';
  private memoryGatewayUrl: string;
  private botToken?: string;

  constructor(memoryGatewayUrl: string, botToken?: string) {
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.botToken = botToken;
  }

  /**
   * Check if trigger should fire
   * Triggers daily at 20:00 JST
   */
  async checkTrigger(): Promise<PluginTrigger | null> {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Trigger window: 20:00-20:59 JST
    const isTriggered = hour === 20;

    if (!isTriggered) {
      return null;
    }

    return {
      plugin_name: this.name,
      trigger_type: 'scheduled',
      confidence: 1.0,
      reason: `Evening review scheduled at ${hour}:${minute.toString().padStart(2, '0')}`,
      context_needed: ['shared/global', 'private/agent/jarvis'],
    };
  }

  /**
   * Generate task proposal
   */
  async propose(
    trigger: PluginTrigger,
    context: AutopilotContext
  ): Promise<PluginProposal | null> {
    // Parse snapshot to extract today's tasks
    const reviewSummary = this.extractReviewSummary(context.snapshot);

    return {
      task: {
        id: `task_evening_review_${Date.now()}`,
        type: 'maintenance',
        title: '夜の振り返り',
        description: `今日のタスク完了状況を確認します。\n\n${reviewSummary}`,
        reason: trigger.reason,
        confidence: trigger.confidence,
        impact: 'low',
        created_at: new Date().toISOString(),
        status: 'proposed',
        source_plugin: this.name,
      },
      action_plan: [
        'AI_MEMORYから今日のタスクを取得',
        '完了タスク・未完了タスクを集計',
        '明日への引き継ぎ確認',
        'Telegram経由で振り返りを送信',
      ],
      estimated_duration: '30 seconds',
      risks: [],
      approval_required: false, // Auto-execute (low impact)
    };
  }

  /**
   * Execute evening review
   */
  async execute(
    proposal: PluginProposal,
    context: AutopilotContext,
    bot: any,
    chatId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Use ProactiveSecretary if botToken is available
      if (this.botToken) {
        const secretary = new ProactiveSecretary(this.botToken, String(chatId));
        await secretary.eveningReview();

        return {
          success: true,
          message: '夜の振り返りを送信しました',
        };
      }

      // Fallback: Generate simple review from snapshot
      const reviewSummary = this.extractReviewSummary(context.snapshot);

      await bot.sendMessage(chatId, `🌙 **夜の振り返り**\n\n${reviewSummary}`);

      return {
        success: true,
        message: 'Evening review sent (simple mode)',
      };
    } catch (error) {
      console.error('[EveningReview] Execution error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract review summary from memory snapshot
   */
  private extractReviewSummary(snapshot: string): string {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Find today's task section
    const lines = snapshot.split('\n');
    const taskLines: string[] = [];
    let inTodaySection = false;

    for (const line of lines) {
      if (line.includes(`## ${today} 今日やること`)) {
        inTodaySection = true;
        continue;
      }

      if (inTodaySection) {
        if (line.startsWith('## ')) {
          // End of today's section
          break;
        }
        if (line.trim().startsWith('- ')) {
          taskLines.push(line.trim());
        }
      }
    }

    if (taskLines.length === 0) {
      return '今日のタスクはありませんでした。';
    }

    const completedTasks = taskLines.filter(t => t.includes('✅'));
    const pendingTasks = taskLines.filter(t => !t.includes('✅'));

    let summary = `**今日の成果:**\n`;

    if (completedTasks.length > 0) {
      summary += `✅ ${completedTasks.length}件完了\n${completedTasks.slice(0, 3).join('\n')}${completedTasks.length > 3 ? '\n...' : ''}\n\n`;
    } else {
      summary += `完了したタスクはありません。\n\n`;
    }

    if (pendingTasks.length > 0) {
      summary += `**未完了タスク:**\n`;
      summary += `⏳ ${pendingTasks.length}件残り\n${pendingTasks.slice(0, 3).join('\n')}${pendingTasks.length > 3 ? '\n...' : ''}`;
    } else {
      summary += `🎉 全タスク完了！`;
    }

    return summary;
  }
}
