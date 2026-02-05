/**
 * Autopilot Approval UX
 *
 * Telegram inline keyboard for user approval of autopilot tasks
 *
 * Features:
 * - Approve/Reject buttons
 * - Callback handling
 * - Timeout handling (auto-reject after 5 minutes)
 */

import type { Api, InlineKeyboard } from 'grammy';
import { InlineKeyboard as KB } from 'grammy';
import type { AutopilotProposal } from './engine';

export interface ApprovalRequest {
  proposalId: string;
  chatId: number;
  messageId?: number;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export class ApprovalUX {
  private bot: Api;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(bot: Api) {
    this.bot = bot;
  }

  /**
   * Send approval request to user
   */
  async requestApproval(
    chatId: number,
    proposal: AutopilotProposal
  ): Promise<string> {
    const proposalId = proposal.task.id;

    // Format message
    const message = this.formatProposalMessage(proposal);

    // Create inline keyboard
    const keyboard = this.createApprovalKeyboard(proposalId);

    // Send message
    const sentMessage = await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    // Store approval request
    const expiresAt = new Date(Date.now() + this.approvalTimeout);
    const approvalRequest: ApprovalRequest = {
      proposalId,
      chatId,
      messageId: sentMessage.message_id,
      expiresAt,
      status: 'pending',
    };

    this.pendingApprovals.set(proposalId, approvalRequest);

    // Set timeout to auto-reject
    setTimeout(() => {
      this.handleTimeout(proposalId);
    }, this.approvalTimeout);

    return proposalId;
  }

  /**
   * Handle approval callback
   */
  async handleApproval(proposalId: string): Promise<void> {
    const request = this.pendingApprovals.get(proposalId);
    if (!request) {
      console.warn(`[ApprovalUX] Approval request not found: ${proposalId}`);
      return;
    }

    request.status = 'approved';

    // Update message
    if (request.messageId) {
      await this.updateMessageStatus(
        request.chatId,
        request.messageId,
        '✅ Approved'
      );
    }

    console.log(`[ApprovalUX] Proposal approved: ${proposalId}`);
  }

  /**
   * Handle rejection callback
   */
  async handleRejection(proposalId: string): Promise<void> {
    const request = this.pendingApprovals.get(proposalId);
    if (!request) {
      console.warn(`[ApprovalUX] Approval request not found: ${proposalId}`);
      return;
    }

    request.status = 'rejected';

    // Update message
    if (request.messageId) {
      await this.updateMessageStatus(
        request.chatId,
        request.messageId,
        '❌ Rejected'
      );
    }

    console.log(`[ApprovalUX] Proposal rejected: ${proposalId}`);
  }

  /**
   * Get approval status
   */
  getApprovalStatus(proposalId: string): 'approved' | 'rejected' | 'pending' | 'expired' | null {
    const request = this.pendingApprovals.get(proposalId);
    return request ? request.status : null;
  }

  /**
   * Wait for approval (blocking)
   */
  async waitForApproval(
    proposalId: string,
    timeoutMs: number = this.approvalTimeout
  ): Promise<'approved' | 'rejected' | 'expired'> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const request = this.pendingApprovals.get(proposalId);

        if (!request) {
          clearInterval(checkInterval);
          resolve('rejected');
          return;
        }

        if (request.status === 'approved') {
          clearInterval(checkInterval);
          resolve('approved');
          return;
        }

        if (request.status === 'rejected') {
          clearInterval(checkInterval);
          resolve('rejected');
          return;
        }

        if (request.status === 'expired') {
          clearInterval(checkInterval);
          resolve('expired');
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          this.handleTimeout(proposalId);
          resolve('expired');
        }
      }, 500); // Check every 500ms
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Format proposal message for Telegram
   */
  private formatProposalMessage(proposal: AutopilotProposal): string {
    const { task, action_plan, estimated_duration, risks } = proposal;

    let message = `🤖 **Autopilot Proposal**\n\n`;
    message += `**Task:** ${task.title}\n`;
    message += `**Type:** ${task.type}\n`;
    message += `**Confidence:** ${(task.confidence * 100).toFixed(0)}%\n`;
    message += `**Impact:** ${task.impact}\n`;
    message += `**Duration:** ~${estimated_duration}\n\n`;
    message += `**Description:**\n${task.description}\n\n`;
    message += `**Reason:**\n${task.reason}\n\n`;
    message += `**Action Plan:**\n`;
    action_plan.forEach((step, i) => {
      message += `${i + 1}. ${step}\n`;
    });
    message += `\n`;

    if (risks.length > 0) {
      message += `**Risks:**\n`;
      risks.forEach((risk) => {
        message += `⚠️ ${risk}\n`;
      });
      message += `\n`;
    }

    message += `*Do you approve this task?*`;

    return message;
  }

  /**
   * Create inline keyboard for approval
   */
  private createApprovalKeyboard(proposalId: string): InlineKeyboard {
    return new KB()
      .text('✅ Approve', `autopilot:approve:${proposalId}`)
      .text('❌ Reject', `autopilot:reject:${proposalId}`);
  }

  /**
   * Update message with approval status
   */
  private async updateMessageStatus(
    chatId: number,
    messageId: number,
    status: string
  ): Promise<void> {
    try {
      await this.bot.editMessageReplyMarkup(chatId, messageId, {
        reply_markup: { inline_keyboard: [] }, // Remove buttons
      });

      // Add status to message text
      await this.bot.editMessageText(
        chatId,
        messageId,
        `[Original message]\n\n**Status:** ${status}`
      );
    } catch (error) {
      console.error('[ApprovalUX] Error updating message:', error);
    }
  }

  /**
   * Handle approval timeout
   */
  private async handleTimeout(proposalId: string): Promise<void> {
    const request = this.pendingApprovals.get(proposalId);
    if (!request || request.status !== 'pending') {
      return; // Already handled
    }

    request.status = 'expired';

    // Update message
    if (request.messageId) {
      await this.updateMessageStatus(
        request.chatId,
        request.messageId,
        '⏱️ Expired (auto-rejected)'
      );
    }

    console.log(`[ApprovalUX] Proposal expired: ${proposalId}`);
  }

  /**
   * Parse callback data
   */
  static parseCallbackData(callbackData: string): {
    action: 'approve' | 'reject';
    proposalId: string;
  } | null {
    const match = callbackData.match(/^autopilot:(approve|reject):(.+)$/);
    if (!match) {
      return null;
    }

    return {
      action: match[1] as 'approve' | 'reject',
      proposalId: match[2],
    };
  }
}
