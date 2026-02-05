/**
 * Morning Briefing Plugin
 *
 * Provides morning briefing as Autopilot plugin.
 * Integrates with ProactiveSecretary for task analysis.
 *
 * Task-ID: AUTOPILOTxMEMORY_v1_2026-02-03
 */

import type { AutopilotPlugin, PluginTrigger, PluginProposal } from '../types';
import type { AutopilotContext } from '../engine';
import { ProactiveSecretary } from '../../services/proactive-secretary';

export class MorningBriefingPlugin implements AutopilotPlugin {
  name = 'morning-briefing';
  description = 'Daily morning briefing with task overview';
  private memoryGatewayUrl: string;
  private botToken?: string;

  constructor(memoryGatewayUrl: string, botToken?: string) {
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.botToken = botToken;
  }

  /**
   * Check if trigger should fire
   * Triggers daily at 03:00 JST
   */
  async checkTrigger(): Promise<PluginTrigger | null> {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Trigger window: 03:00-03:59 JST
    const isTriggered = hour === 3;

    if (!isTriggered) {
      return null;
    }

    return {
      plugin_name: this.name,
      trigger_type: 'scheduled',
      confidence: 1.0,
      reason: `Morning briefing scheduled at ${hour}:${minute.toString().padStart(2, '0')}`,
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
    const taskSummary = this.extractTaskSummary(context.snapshot);

    return {
      task: {
        id: `task_morning_briefing_${Date.now()}`,
        type: 'maintenance',
        title: '朝のブリーフィング',
        description: `今日のタスク概要を提供します。\n\n${taskSummary}`,
        reason: trigger.reason,
        confidence: trigger.confidence,
        impact: 'low',
        created_at: new Date().toISOString(),
        status: 'proposed',
        source_plugin: this.name,
      },
      action_plan: [
        'AI_MEMORYから今日のタスクを取得',
        'タスクの優先度を分析',
        '高優先度タスク・長期放置タスクを警告',
        'Telegram経由でブリーフィングを送信',
      ],
      estimated_duration: '30 seconds',
      risks: [],
      approval_required: false, // Auto-execute (low impact)
    };
  }

  /**
   * Execute morning briefing
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
        await secretary.morningBriefing();

        return {
          success: true,
          message: '朝のブリーフィングを送信しました',
        };
      }

      // Fallback: Generate simple briefing from snapshot
      const taskSummary = this.extractTaskSummary(context.snapshot);

      await bot.sendMessage(chatId, `🌅 **朝のブリーフィング**\n\n${taskSummary}`);

      return {
        success: true,
        message: 'Morning briefing sent (simple mode)',
      };
    } catch (error) {
      console.error('[MorningBriefing] Execution error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract task summary from memory snapshot
   */
  private extractTaskSummary(snapshot: string): string {
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
      return '今日のタスクはありません。';
    }

    const completedTasks = taskLines.filter(t => t.includes('✅')).length;
    const totalTasks = taskLines.length;
    const pendingTasks = totalTasks - completedTasks;

    return `**今日のタスク:** ${totalTasks}件\n**完了:** ${completedTasks}件\n**残り:** ${pendingTasks}件\n\n${taskLines.slice(0, 5).join('\n')}${taskLines.length > 5 ? '\n...' : ''}`;
  }
}
