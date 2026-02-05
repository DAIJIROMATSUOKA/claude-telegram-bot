/**
 * Notification Buffer - Prevents notification spam during implementation
 *
 * Strategy:
 * - Buffer all intermediate notifications (tool calls, thinking, etc.)
 * - Send only 2 notifications per phase:
 *   1. "🔄 Phase X started"
 *   2. "✅ Phase X completed" + summary
 *
 * Usage:
 * - Start phase: buffer.startPhase("Phase 3: Implementation")
 * - Add activity: buffer.addActivity("📖 Reading file.ts")
 * - End phase: await buffer.endPhase(ctx) → sends summary
 */

import type { Context } from "grammy";
import { getSessionIdFromContext } from "./session-helper";
import { startPhase as startPhaseDB, completePhase as completePhaseDB } from "./control-tower-helper";

export interface PhaseActivity {
  type: "tool" | "thinking" | "text" | "error";
  icon: string;
  description: string;
  timestamp: number;
}

export class NotificationBuffer {
  private currentPhase: string | null = null;
  private activities: PhaseActivity[] = [];
  private phaseStartTime: number = 0;
  private silentMode: boolean = false;
  private textResponses: string[] = []; // Collect text responses during phase
  private traceId: string | null = null; // Phase D: trace_id for debugging

  /**
   * Start a new phase (sends 1 notification)
   * @param traceId - Optional trace ID for debugging (Phase D)
   */
  async startPhase(ctx: Context, phaseName: string, traceId?: string): Promise<void> {
    // SPAM PREVENTION: Skip if same phase is already running
    if (this.currentPhase === phaseName) {
      console.log(`[NotificationBuffer] Phase "${phaseName}" is already running, skipping duplicate start`);
      return;
    }

    // Send previous phase summary if exists
    if (this.currentPhase) {
      await this.endPhase(ctx);
    }

    this.currentPhase = phaseName;
    this.activities = [];
    this.textResponses = []; // Reset text responses
    this.traceId = traceId || null; // Phase D: Store trace_id
    this.phaseStartTime = Date.now();

    // D1記録: Phase開始
    const sessionId = getSessionIdFromContext(ctx);
    if (sessionId) {
      await startPhaseDB(sessionId, phaseName, ctx);
    }

    // Send start notification (silent per Phase D)
    await ctx.reply(`🔄 ${phaseName}`, {
      disable_notification: true, // Silent - Phase D requirement
    });
  }

  /**
   * Add activity to buffer (no notification)
   */
  addActivity(type: PhaseActivity["type"], description: string): void {
    if (!this.currentPhase) {
      return; // No active phase
    }

    const icon = this.getIconForType(type);
    this.activities.push({
      type,
      icon,
      description,
      timestamp: Date.now(),
    });

    // Log to console for debugging
    console.log(`[NotificationBuffer] ${icon} ${description}`);
  }

  /**
   * Add text response to buffer (will be sent in phase completion)
   */
  addTextResponse(text: string): void {
    if (!this.currentPhase) {
      return; // No active phase
    }

    this.textResponses.push(text);
    console.log(`[NotificationBuffer] Buffered text response (${this.textResponses.length} total)`);
  }

  /**
   * End current phase (sends 1 notification with summary)
   */
  async endPhase(ctx: Context, success: boolean = true): Promise<void> {
    if (!this.currentPhase) {
      return; // No active phase
    }

    const duration = Math.round((Date.now() - this.phaseStartTime) / 1000);
    const status = success ? "✅" : "❌";
    const statusText = success ? "完了" : "エラー";

    // Build summary
    let summary = `${status} ${this.currentPhase} ${statusText}\n`;
    summary += `⏱ 所要時間: ${duration}秒\n\n`;

    // Group activities by type
    const grouped = this.groupActivitiesByType();

    // Add grouped summary
    if (grouped.tool.length > 0) {
      summary += `🛠 ツール実行: ${grouped.tool.length}回\n`;
    }
    if (grouped.thinking.length > 0) {
      summary += `🧠 思考: ${grouped.thinking.length}回\n`;
    }
    if (grouped.text.length > 0) {
      summary += `📝 テキスト生成: ${grouped.text.length}回\n`;
    }
    if (grouped.error.length > 0) {
      summary += `⚠️ エラー: ${grouped.error.length}回\n`;
      // Show error details
      summary += `\n**エラー詳細:**\n`;
      grouped.error.forEach((activity) => {
        summary += `- ${activity.description}\n`;
      });
    }

    // D1記録: Phase完了
    const sessionId = getSessionIdFromContext(ctx);
    if (sessionId && this.currentPhase) {
      await completePhaseDB(sessionId, this.currentPhase, success, ctx);
    }

    // Combine text responses with summary (if any)
    let finalMessage = summary;
    if (this.textResponses.length > 0) {
      const combinedText = this.textResponses.join('\n\n---\n\n');
      finalMessage = `${combinedText}\n\n━━━━━━━━━━━━━━━\n\n${summary}`;
    }

    // Phase D: Add trace_id to end notification if available
    if (this.traceId) {
      finalMessage += `\n🔍 Trace ID: ${this.traceId}`;
    }

    // Send single notification with everything
    await ctx.reply(finalMessage, {
      disable_notification: false, // Always notify on phase end (loud - Phase D)
    });

    // Reset state
    this.currentPhase = null;
    this.activities = [];
    this.textResponses = [];
    this.traceId = null; // Phase D: Reset trace_id
    this.phaseStartTime = 0;
  }

  /**
   * Enable silent mode (no notifications at all)
   */
  setSilentMode(silent: boolean): void {
    this.silentMode = silent;
  }

  /**
   * Check if currently in a phase
   */
  isActive(): boolean {
    return this.currentPhase !== null;
  }

  /**
   * Get current phase name
   */
  getCurrentPhase(): string | null {
    return this.currentPhase;
  }

  /**
   * Get activity count
   */
  getActivityCount(): number {
    return this.activities.length;
  }

  /**
   * Group activities by type
   */
  private groupActivitiesByType() {
    const grouped: Record<PhaseActivity["type"], PhaseActivity[]> = {
      tool: [],
      thinking: [],
      text: [],
      error: [],
    };

    this.activities.forEach((activity) => {
      grouped[activity.type].push(activity);
    });

    return grouped;
  }

  /**
   * Get icon for activity type
   */
  private getIconForType(type: PhaseActivity["type"]): string {
    switch (type) {
      case "tool":
        return "🛠";
      case "thinking":
        return "🧠";
      case "text":
        return "📝";
      case "error":
        return "⚠️";
      default:
        return "ℹ️";
    }
  }
}

// Global singleton instance
export const notificationBuffer = new NotificationBuffer();
