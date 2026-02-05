/**
 * Predictive Task Generator Plugin
 *
 * Detects patterns and predicts next tasks based on:
 * - Time patterns (daily, weekly tasks)
 * - User behavior patterns
 * - Recurring event patterns
 *
 * Example: "User usually checks evening review at 20:00"
 */

import { ulid } from 'ulidx';
import type { AutopilotPlugin } from '../types';
import type { AutopilotTask } from '../engine';
import { ContextManager } from '../context-manager';

export class PredictiveTaskGenerator implements AutopilotPlugin {
  name = 'predictive-task-generator';
  version = '1.0.0';
  description = 'Generates tasks based on pattern recognition';

  private contextManager: ContextManager;

  constructor(memoryGatewayUrl: string) {
    this.contextManager = new ContextManager(memoryGatewayUrl);
  }

  async detectTriggers(): Promise<AutopilotTask[]> {
    const triggers: AutopilotTask[] = [];

    // Pattern 1: Evening review check (if not done today)
    const eveningReviewTrigger = await this.checkEveningReview();
    if (eveningReviewTrigger) {
      triggers.push(eveningReviewTrigger);
    }

    // Pattern 2: Weekly review (Sunday)
    const weeklyReviewTrigger = await this.checkWeeklyReview();
    if (weeklyReviewTrigger) {
      triggers.push(weeklyReviewTrigger);
    }

    // Pattern 3: Daily planning (if not done today)
    const dailyPlanningTrigger = await this.checkDailyPlanning();
    if (dailyPlanningTrigger) {
      triggers.push(dailyPlanningTrigger);
    }

    return triggers;
  }

  async executeTask(task: AutopilotTask): Promise<void> {
    // Execution logic is handled by the main bot
    // This plugin just generates triggers
    console.log(`[PredictiveTaskGenerator] Task execution delegated to main bot: ${task.title}`);
  }

  // ==================== Pattern Detection ====================

  /**
   * Check if evening review should be triggered
   */
  private async checkEveningReview(): Promise<AutopilotTask | null> {
    const now = new Date();
    const currentHour = now.getHours();

    // Trigger between 19:00 - 21:00
    if (currentHour < 19 || currentHour >= 21) {
      return null;
    }

    // Check if already done today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentReviews = await this.contextManager.query({
      scope: 'shared/global',
      type: 'review',
      since: today.toISOString(),
      limit: 1,
    });

    if (recentReviews.length > 0) {
      return null; // Already done today
    }

    return {
      id: `task_${ulid()}`,
      type: 'predictive',
      title: 'Evening review check',
      description: 'Remind user to complete evening review',
      reason: 'User typically completes evening review around this time',
      confidence: 0.85,
      impact: 'low',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: this.name,
    };
  }

  /**
   * Check if weekly review should be triggered (Sunday)
   */
  private async checkWeeklyReview(): Promise<AutopilotTask | null> {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday

    // Trigger only on Sunday
    if (currentDay !== 0) {
      return null;
    }

    // Check if already done this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of this week
    weekStart.setHours(0, 0, 0, 0);

    const recentReviews = await this.contextManager.query({
      scope: 'shared/global',
      type: 'weekly_review',
      since: weekStart.toISOString(),
      limit: 1,
    });

    if (recentReviews.length > 0) {
      return null; // Already done this week
    }

    return {
      id: `task_${ulid()}`,
      type: 'predictive',
      title: 'Weekly review',
      description: 'Review this week\'s progress and plan next week',
      reason: 'It\'s Sunday - time for weekly review',
      confidence: 0.9,
      impact: 'medium',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: this.name,
    };
  }

  /**
   * Check if daily planning should be triggered
   */
  private async checkDailyPlanning(): Promise<AutopilotTask | null> {
    const now = new Date();
    const currentHour = now.getHours();

    // Trigger in the morning (7:00 - 9:00)
    if (currentHour < 7 || currentHour >= 9) {
      return null;
    }

    // Check if already done today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentPlanning = await this.contextManager.query({
      scope: 'shared/global',
      type: 'daily_planning',
      since: today.toISOString(),
      limit: 1,
    });

    if (recentPlanning.length > 0) {
      return null; // Already done today
    }

    return {
      id: `task_${ulid()}`,
      type: 'predictive',
      title: 'Daily planning',
      description: 'Review today\'s schedule and priorities',
      reason: 'Morning planning helps set priorities for the day',
      confidence: 0.8,
      impact: 'low',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: this.name,
    };
  }
}
