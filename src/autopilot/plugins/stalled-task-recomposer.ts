/**
 * Stalled Task Recomposer Plugin
 *
 * Detects tasks that have been stuck for too long and:
 * - Breaks them down into smaller subtasks
 * - Suggests alternative approaches
 * - Proposes next concrete actions
 *
 * Example: "Task X has been pending for 3 days. Break it down into smaller steps."
 */

import { ulid } from 'ulidx';
import type { AutopilotPlugin } from '../types';
import type { AutopilotTask } from '../engine';
import { ContextManager } from '../context-manager';

interface StalledTaskCandidate {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  stalledDays: number;
}

export class StalledTaskRecomposer implements AutopilotPlugin {
  name = 'stalled-task-recomposer';
  version = '1.0.0';
  description = 'Detects and recomposes stalled tasks';

  private contextManager: ContextManager;
  private stalledThresholdDays = 2; // Tasks stalled for 2+ days

  constructor(memoryGatewayUrl: string) {
    this.contextManager = new ContextManager(memoryGatewayUrl);
  }

  async detectTriggers(): Promise<AutopilotTask[]> {
    const triggers: AutopilotTask[] = [];

    // Find stalled tasks
    const stalledTasks = await this.findStalledTasks();

    for (const stalledTask of stalledTasks) {
      const trigger: AutopilotTask = {
        id: `task_${ulid()}`,
        type: 'recovery',
        title: `Recompose stalled task: ${stalledTask.title}`,
        description: `Task has been stalled for ${stalledTask.stalledDays} days. Suggest breakdown or alternative approach.`,
        reason: `Task "${stalledTask.title}" has not progressed in ${stalledTask.stalledDays} days`,
        confidence: this.calculateConfidence(stalledTask.stalledDays),
        impact: 'medium',
        created_at: new Date().toISOString(),
        status: 'proposed',
        source_plugin: this.name,
      };

      triggers.push(trigger);
    }

    return triggers;
  }

  async executeTask(task: AutopilotTask): Promise<void> {
    // Execution: Generate breakdown suggestions and send to user
    console.log(`[StalledTaskRecomposer] Executing: ${task.title}`);

    // Extract original task title from trigger title
    const match = task.title.match(/Recompose stalled task: (.+)/);
    if (!match) {
      throw new Error('Invalid task format');
    }

    const originalTaskTitle = match[1];

    // Generate suggestions (in real implementation, this would use LLM)
    const suggestions = this.generateBreakdownSuggestions(originalTaskTitle);

    // Log to memory
    await this.contextManager.appendMemory({
      scope: 'shared/autopilot_log',
      type: 'task_recomposition',
      title: `Recomposed: ${originalTaskTitle}`,
      content: suggestions,
      importance: 7,
      tags: ['autopilot', 'stalled-task', 'recomposition'],
      source_agent: 'jarvis',
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Find tasks that have been stalled for too long
   */
  private async findStalledTasks(): Promise<StalledTaskCandidate[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - this.stalledThresholdDays);

    // Query pending tasks from memory
    const tasks = await this.contextManager.query({
      scope_prefix: 'shared/',
      type: 'task',
      until: thresholdDate.toISOString(),
      limit: 10,
    });

    const stalledTasks: StalledTaskCandidate[] = [];

    for (const task of tasks) {
      // Check if task is still pending (content contains "pending" or "todo")
      if (
        task.content.toLowerCase().includes('pending') ||
        task.content.toLowerCase().includes('todo') ||
        task.content.toLowerCase().includes('待機中')
      ) {
        const updatedAt = new Date(task.updated_at);
        const now = new Date();
        const stalledDays = Math.floor(
          (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (stalledDays >= this.stalledThresholdDays) {
          stalledTasks.push({
            id: task.id,
            title: task.title || 'Untitled task',
            created_at: task.created_at,
            updated_at: task.updated_at,
            stalledDays,
          });
        }
      }
    }

    return stalledTasks;
  }

  /**
   * Calculate confidence based on stalled duration
   */
  private calculateConfidence(stalledDays: number): number {
    // More days stalled = higher confidence that intervention is needed
    if (stalledDays >= 7) return 0.95;
    if (stalledDays >= 5) return 0.9;
    if (stalledDays >= 3) return 0.85;
    return 0.7;
  }

  /**
   * Generate breakdown suggestions for a stalled task
   */
  private generateBreakdownSuggestions(taskTitle: string): string {
    // Placeholder: In real implementation, use LLM to generate suggestions
    return `## Suggested Breakdown for: ${taskTitle}

**Why this task might be stalled:**
- Task is too broad or ambiguous
- Missing prerequisites or dependencies
- Unclear next action

**Suggested breakdown:**
1. Identify the smallest possible first step
2. List all prerequisites and dependencies
3. Break down into 3-5 concrete subtasks
4. Set a deadline for the first subtask

**Recommended next action:**
- Schedule 15 minutes to plan the first step
- Identify one blocker and address it
- Delegate or defer if not critical

**Alternative approaches:**
- Can this task be simplified or eliminated?
- Can it be delegated to someone else?
- Can it be deferred to a later date?
`;
  }
}
