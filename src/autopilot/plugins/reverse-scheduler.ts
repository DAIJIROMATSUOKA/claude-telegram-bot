/**
 * Reverse Scheduler Plugin
 *
 * Works backwards from deadlines to suggest when to start tasks.
 *
 * Example: "Meeting on Friday → Start prep on Wednesday (2 days before)"
 *
 * Pattern detection:
 * - Upcoming events/meetings in calendar
 * - Tasks with deadlines
 * - Recurring patterns (e.g., weekly reports)
 */

import { ulid } from 'ulidx';
import type { AutopilotPlugin } from '../types';
import type { AutopilotTask } from '../engine';
import { ContextManager } from '../context-manager';

interface UpcomingEvent {
  id: string;
  title: string;
  deadline: Date;
  prepTime: number; // Hours needed for preparation
  startBy: Date; // When to start working on it
}

export class ReverseScheduler implements AutopilotPlugin {
  name = 'reverse-scheduler';
  version = '1.0.0';
  description = 'Suggests when to start tasks based on deadlines';

  private contextManager: ContextManager;

  constructor(memoryGatewayUrl: string) {
    this.contextManager = new ContextManager(memoryGatewayUrl);
  }

  async detectTriggers(): Promise<AutopilotTask[]> {
    const triggers: AutopilotTask[] = [];

    // Find upcoming events/deadlines
    const upcomingEvents = await this.findUpcomingEvents();

    for (const event of upcomingEvents) {
      const now = new Date();

      // Check if we've reached the "start by" time
      if (now >= event.startBy && now < event.deadline) {
        // Check if we already started working on this
        const alreadyStarted = await this.checkIfStarted(event.id);
        if (alreadyStarted) {
          continue;
        }

        const hoursUntilDeadline = Math.round(
          (event.deadline.getTime() - now.getTime()) / (1000 * 60 * 60)
        );

        const trigger: AutopilotTask = {
          id: `task_${ulid()}`,
          type: 'predictive',
          title: `Start preparation: ${event.title}`,
          description: `Deadline in ${hoursUntilDeadline} hours. Estimated prep time: ${event.prepTime} hours.`,
          reason: `Reverse scheduling: Start now to meet deadline on time`,
          confidence: 0.9,
          impact: this.calculateImpact(hoursUntilDeadline),
          created_at: new Date().toISOString(),
          status: 'proposed',
          source_plugin: this.name,
        };

        triggers.push(trigger);
      }
    }

    return triggers;
  }

  async executeTask(task: AutopilotTask): Promise<void> {
    console.log(`[ReverseScheduler] Executing: ${task.title}`);

    // Log start to memory
    await this.contextManager.appendMemory({
      scope: 'shared/autopilot_log',
      type: 'reverse_schedule',
      title: task.title,
      content: task.description,
      importance: 8,
      tags: ['autopilot', 'reverse-scheduler', 'deadline'],
      source_agent: 'jarvis',
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Find upcoming events with deadlines
   */
  private async findUpcomingEvents(): Promise<UpcomingEvent[]> {
    const now = new Date();
    const oneWeekLater = new Date();
    oneWeekLater.setDate(oneWeekLater.getDate() + 7);

    // Query events/tasks with deadlines from memory
    const events = await this.contextManager.query({
      scope_prefix: 'shared/',
      type: 'event',
      since: now.toISOString(),
      until: oneWeekLater.toISOString(),
      limit: 20,
    });

    const upcomingEvents: UpcomingEvent[] = [];

    for (const event of events) {
      // Parse deadline from content (simple pattern matching)
      const deadlineMatch = this.extractDeadline(event.content);
      if (!deadlineMatch) {
        continue;
      }

      const deadline = new Date(deadlineMatch);
      if (deadline <= now || deadline > oneWeekLater) {
        continue;
      }

      // Estimate prep time based on event type or content
      const prepTime = this.estimatePrepTime(event.title, event.content);

      // Calculate when to start
      const startBy = new Date(deadline.getTime() - prepTime * 60 * 60 * 1000);

      upcomingEvents.push({
        id: event.id,
        title: event.title || 'Untitled event',
        deadline,
        prepTime,
        startBy,
      });
    }

    return upcomingEvents;
  }

  /**
   * Extract deadline from event content
   */
  private extractDeadline(content: string): string | null {
    // Try to find ISO date format
    const isoDateMatch = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    if (isoDateMatch) {
      return isoDateMatch[0];
    }

    // Try to find "deadline: YYYY-MM-DD" pattern
    const deadlineMatch = content.match(/deadline[:\s]+(\d{4}-\d{2}-\d{2})/i);
    if (deadlineMatch) {
      return deadlineMatch[1];
    }

    return null;
  }

  /**
   * Estimate preparation time based on event type
   */
  private estimatePrepTime(title: string, content: string): number {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // Meeting preparation
    if (titleLower.includes('会議') || titleLower.includes('meeting')) {
      return 2; // 2 hours
    }

    // Presentation
    if (titleLower.includes('プレゼン') || titleLower.includes('presentation')) {
      return 8; // 8 hours (1 workday)
    }

    // Report
    if (titleLower.includes('報告') || titleLower.includes('report')) {
      return 4; // 4 hours
    }

    // Email response
    if (titleLower.includes('メール') || titleLower.includes('email')) {
      return 0.5; // 30 minutes
    }

    // Default
    return 2; // 2 hours
  }

  /**
   * Calculate impact based on hours until deadline
   */
  private calculateImpact(hoursUntilDeadline: number): 'low' | 'medium' | 'high' {
    if (hoursUntilDeadline <= 24) {
      return 'high'; // Less than 1 day
    } else if (hoursUntilDeadline <= 72) {
      return 'medium'; // 1-3 days
    } else {
      return 'low'; // More than 3 days
    }
  }

  /**
   * Check if we already started working on this event
   */
  private async checkIfStarted(eventId: string): Promise<boolean> {
    const logs = await this.contextManager.query({
      scope: 'shared/autopilot_log',
      type: 'reverse_schedule',
      q: eventId,
      limit: 1,
    });

    return logs.length > 0;
  }
}
