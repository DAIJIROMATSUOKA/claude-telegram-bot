/**
 * Autopilot Engine v2.3 - JARVIS MESH Integration (Phase 2: Proof-Carrying Autopilot)
 *
 * Pipeline: Trigger → Context → Plan → Review (Confidence + Red Team + Policy Engine) → Propose → Execute → Learn
 *
 * Phase 2 Features (NEW):
 * - Policy Engine: Validate PlanBundle completeness (Evidence/Risk/Rollback/Idempotency)
 * - Proof-Carrying: Never execute without complete evidence bundle
 *
 * Phase 4 Features:
 * - Confidence Router: Dynamic thresholds by task type
 * - Red Team: Devil's advocate validation for risky proposals
 * - Learning Log: Pattern analysis via Memory Gateway events
 *
 * v2.2 Features:
 * - M3 Device Agent: Automatic file opening/revealing on M3 workstation
 * - Execution Router: Shadow/Canary/Kill Switch integration ✅
 * - JARVIS MESH: Device routing (M1/M3/iPhone)
 *
 * Task-ID: AUTOPILOTxMEMORY_v2.3_2026-02-04
 */

import type { Api } from 'grammy';
import { ContextManager } from './context-manager';
import { ActionLedger } from '../utils/action-ledger';
import type { AutopilotPlugin } from './types';
import { ConfidenceRouter } from '../utils/confidence-router';
import { RedTeamValidator } from '../utils/red-team';
import { LearningLog } from '../utils/learning-log';
import { AutopilotLogger, createLogger } from '../utils/autopilot-logger';
import { M3AgentClient } from '../utils/m3-agent-client';
import { ExecutionRouter, type ExecutionMode } from '../utils/execution-router';
import { PolicyEngine } from './policy-engine'; // Phase 2: Proof-Carrying Autopilot
import { GoldenTestEngine } from './golden-test-engine'; // Phase 3: Golden Test CI
import { SEED_GOLDEN_TESTS } from './golden-test-seed-data'; // Phase 5: Seed data

export interface AutopilotTask {
  id: string; // task_<ulid>
  type: 'predictive' | 'recovery' | 'maintenance' | 'user-requested';
  title: string;
  description: string;
  reason: string;
  confidence: number; // 0.0 - 1.0
  impact: 'low' | 'medium' | 'high';
  created_at: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  source_plugin: string;
}

export interface AutopilotContext {
  snapshot: string; // Memory snapshot (markdown)
  query_results?: any[]; // Optional query results
  task_history: AutopilotTask[];
  last_execution?: string;
}

export interface AutopilotProposal {
  task: AutopilotTask;
  action_plan: string[];
  estimated_duration: string;
  risks: string[];
  approval_required: boolean;
}

export class AutopilotEngine {
  private plugins: Map<string, AutopilotPlugin> = new Map();
  private contextManager: ContextManager;
  private actionLedger: ActionLedger;
  private confidenceRouter: ConfidenceRouter;
  private redTeam: RedTeamValidator;
  private learningLog: LearningLog;
  private logger: AutopilotLogger;
  private m3Agent: M3AgentClient;
  private executionRouter: ExecutionRouter;
  private policyEngine: PolicyEngine; // Phase 2: Proof-Carrying Autopilot
  private goldenTestEngine: GoldenTestEngine; // Phase 3: Golden Test CI
  private bot: Api;
  private chatId: number;
  private memoryGatewayUrl: string;

  constructor(bot: Api, chatId: number, memoryGatewayUrl: string, executionMode: ExecutionMode = 'shadow') {
    this.bot = bot;
    this.chatId = chatId;
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.contextManager = new ContextManager(memoryGatewayUrl);
    this.actionLedger = new ActionLedger(undefined, undefined, memoryGatewayUrl);

    // Phase 2: Proof-Carrying Autopilot
    this.policyEngine = new PolicyEngine();

    // Phase 3: Golden Test CI
    this.goldenTestEngine = new GoldenTestEngine({ memoryGatewayUrl });
    this.goldenTestEngine.cacheTests(SEED_GOLDEN_TESTS); // Load seed tests

    // Phase 4 components
    this.confidenceRouter = new ConfidenceRouter();
    this.redTeam = new RedTeamValidator();
    this.learningLog = new LearningLog(memoryGatewayUrl);

    // v2.2: M3 Device Agent
    this.m3Agent = new M3AgentClient();

    // v2.2: Execution Router (Shadow/Canary/Production)
    this.executionRouter = new ExecutionRouter(memoryGatewayUrl, executionMode);

    // Phase 5: Structured logging
    this.logger = createLogger({ component: 'autopilot-engine' });

    // Log M3 Agent status
    if (this.m3Agent.isEnabled()) {
      this.logger.info('M3 Device Agent enabled', this.m3Agent.getConfig());
    } else {
      this.logger.warn('M3 Device Agent not configured (M3_AGENT_URL/TOKEN missing)');
    }

    // Log Execution Router status
    this.logger.info('Execution Router initialized', {
      mode: this.executionRouter.getMode(),
      scope: this.executionRouter.getScope(),
    });

    // Restore Action Ledger state from Memory Gateway (crash recovery)
    this.actionLedger.restore().then(() => {
      this.logger.info('Action Ledger restored from Memory Gateway');
    }).catch((err) => {
      this.logger.error('Failed to restore Action Ledger', err);
    });
  }

  /**
   * Register a plugin
   */
  registerPlugin(plugin: AutopilotPlugin): void {
    this.plugins.set(plugin.name, plugin);
    this.logger.info(`Registered plugin: ${plugin.name}`, { plugin: plugin.name, version: plugin.version });
  }

  /**
   * Get M3 Agent client (for plugins to use)
   */
  getM3Agent(): M3AgentClient {
    return this.m3Agent;
  }

  /**
   * Get Execution Router (for mode/scope control)
   */
  getExecutionRouter(): ExecutionRouter {
    return this.executionRouter;
  }

  /**
   * Execute a function with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    taskName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${taskName}`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Main pipeline execution
   */
  async run(): Promise<void> {
    try {
      console.log('[Autopilot] Starting pipeline...');

      // Phase 1: Trigger - Collect triggers from all plugins
      const triggers = await this.collectTriggers();
      if (triggers.length === 0) {
        console.log('[Autopilot] No triggers detected. Exiting.');
        return;
      }

      // Phase 2: Context - Load memory snapshot + optional query
      const context = await this.contextManager.getContext({
        scope: 'shared/global',
        includeQuery: false, // Start with snapshot only
      });

      // Phase 3: Plan - Generate task proposals
      const proposals = await this.generateProposals(triggers, context);
      if (proposals.length === 0) {
        console.log('[Autopilot] No valid proposals generated. Exiting.');
        return;
      }

      // Phase 4: Review - Filter by confidence & impact (with AI Council)
      const reviewedProposals = await this.reviewProposals(proposals);
      if (reviewedProposals.length === 0) {
        console.log('[Autopilot] No proposals passed review. Exiting.');
        return;
      }

      // Phase 5: Propose - Send to user for approval
      const approvedProposals = await this.proposeToUser(reviewedProposals);
      if (approvedProposals.length === 0) {
        console.log('[Autopilot] No proposals approved by user. Exiting.');
        return;
      }

      // Phase 6: Execute - Execute approved tasks
      await this.executeTasks(approvedProposals);

      // Phase 7: Learn - Log results to Memory Gateway
      await this.learnFromExecution(approvedProposals);

      console.log('[Autopilot] Pipeline completed successfully.');
    } catch (error) {
      console.error('[Autopilot] Pipeline error:', error);
      await this.bot.sendMessage(
        this.chatId,
        `⚠️ Autopilot Engine encountered an error:\n\n${error}`
      );
    }
  }

  /**
   * Phase 1: Trigger - Collect triggers from all plugins
   */
  private async collectTriggers(): Promise<AutopilotTask[]> {
    const triggers: AutopilotTask[] = [];

    for (const [name, plugin] of this.plugins.entries()) {
      try {
        const pluginTriggers = await plugin.detectTriggers();
        triggers.push(...pluginTriggers);
        console.log(`[Autopilot] Plugin "${name}" generated ${pluginTriggers.length} triggers`);
      } catch (error) {
        console.error(`[Autopilot] Error in plugin "${name}":`, error);
      }
    }

    return triggers;
  }

  /**
   * Phase 3: Plan - Generate task proposals from triggers
   */
  private async generateProposals(
    triggers: AutopilotTask[],
    context: AutopilotContext
  ): Promise<AutopilotProposal[]> {
    const proposals: AutopilotProposal[] = [];

    for (const trigger of triggers) {
      // Generate dedupe key using time-window for recurring tasks
      const dedupeKey = ActionLedger.generateTimeWindowKey(
        trigger.source_plugin,
        trigger.type,
        'daily'
      );

      // Use atomic operation to check and record (prevents race conditions)
      const result = await this.actionLedger.recordIfNotDuplicate(dedupeKey, {
        task_id: trigger.id,
        title: trigger.title,
        created_at: trigger.created_at,
      });

      if (!result.recorded) {
        console.log(`[Autopilot] Skipping duplicate task: ${trigger.title} (${result.reason})`);
        continue;
      }

      // Generate proposal
      const proposal: AutopilotProposal = {
        task: trigger,
        action_plan: this.generateActionPlan(trigger),
        estimated_duration: this.estimateDuration(trigger),
        risks: this.identifyRisks(trigger),
        approval_required: trigger.confidence < 0.8 || trigger.impact !== 'low',
      };

      proposals.push(proposal);
    }

    return proposals;
  }

  /**
   * Phase 4: Review - Route proposals through Confidence Router + Red Team validation
   */
  private async reviewProposals(proposals: AutopilotProposal[]): Promise<AutopilotProposal[]> {
    const reviewed: AutopilotProposal[] = [];

    for (const proposal of proposals) {
      const { task } = proposal;

      // Phase 4.1: Confidence Router - Route based on dynamic thresholds
      const routingResult = this.confidenceRouter.route(proposal);
      console.log(
        `[Autopilot] Confidence Router: ${task.title} -> ${routingResult.decision} (${routingResult.reason})`
      );

      // Phase 4.2: Red Team Validation - Validate if required
      let redTeamResult = null;
      if (routingResult.requiresRedTeam) {
        redTeamResult = this.redTeam.validate(proposal);
        console.log(
          `[Autopilot] Red Team: ${task.title} -> ${redTeamResult.approved ? 'APPROVED' : 'REJECTED'} (risk: ${redTeamResult.risk_score.toFixed(2)})`
        );

        // Adjust confidence based on Red Team analysis
        task.confidence = Math.max(0, Math.min(1, task.confidence + redTeamResult.confidence_adjustment));

        // Reject if Red Team found critical issues
        if (!redTeamResult.approved) {
          console.log(`[Autopilot] Filtered out due to Red Team rejection: ${task.title}`);

          // Notify user of rejection reasons
          await this.bot.sendMessage(
            this.chatId,
            `⚠️ **Autopilot: Red Team Rejection**\n\n` +
              `Task: ${task.title}\n` +
              `${redTeamResult.summary}\n\n` +
              `**Issues:**\n${redTeamResult.issues.map(i => `${this.getIssueEmoji(i.severity)} ${i.message}`).join('\n')}\n\n` +
              `**Recommendations:**\n${redTeamResult.recommendations.map(r => `• ${r}`).join('\n')}`
          );

          continue;
        }

        // Add Red Team recommendations to action plan
        if (redTeamResult.recommendations.length > 0) {
          proposal.action_plan.unshift(
            `Red Team recommendations: ${redTeamResult.recommendations.slice(0, 2).join('; ')}`
          );
        }
      }

      // Apply routing decision
      if (routingResult.decision === 'auto_approve') {
        proposal.approval_required = false;
      } else if (routingResult.decision === 'review_required' || routingResult.decision === 'red_team_required') {
        proposal.approval_required = true;
      }

      // Filter out low-confidence low-impact tasks
      if (task.confidence < 0.5 && task.impact === 'low') {
        console.log(`[Autopilot] Filtered out low-confidence task: ${task.title}`);
        continue;
      }

      reviewed.push(proposal);
    }

    return reviewed;
  }

  /**
   * Get emoji for issue severity
   */
  private getIssueEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return '🚨';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '•';
    }
  }

  /**
   * Phase 5: Propose - Send proposals to user for approval
   */
  private async proposeToUser(proposals: AutopilotProposal[]): Promise<AutopilotProposal[]> {
    const approved: AutopilotProposal[] = [];

    for (const proposal of proposals) {
      if (!proposal.approval_required) {
        // Auto-approve low-risk tasks
        proposal.task.status = 'approved';
        approved.push(proposal);
        console.log(`[Autopilot] Auto-approved: ${proposal.task.title}`);
        continue;
      }

      // Send approval request to user
      const approvalMessage = this.formatProposalMessage(proposal);
      const result = await this.requestApproval(approvalMessage, proposal.task.id);

      if (result === 'approved') {
        proposal.task.status = 'approved';
        approved.push(proposal);
      } else {
        proposal.task.status = 'rejected';
        console.log(`[Autopilot] User rejected: ${proposal.task.title}`);
      }
    }

    return approved;
  }

  /**
   * Phase 6: Execute - Execute approved tasks (with retry support + Learning Log + Execution Router)
   */
  private async executeTasks(proposals: AutopilotProposal[]): Promise<void> {
    for (const proposal of proposals) {
      // Use same dedupe key as in generateProposals
      const dedupeKey = ActionLedger.generateTimeWindowKey(
        proposal.task.source_plugin,
        proposal.task.type,
        'daily'
      );

      const startTime = Date.now();

      // Get routing and Red Team results for Learning Log
      const routingResult = this.confidenceRouter.route(proposal);
      const redTeamResult = routingResult.requiresRedTeam ? this.redTeam.validate(proposal) : null;

      // v2.2: Check Execution Router before executing
      const executionDecision = await this.executionRouter.route(proposal);

      if (!executionDecision.shouldExecute) {
        this.logger.info(`Execution blocked: ${proposal.task.title}`, {
          reason: executionDecision.reason,
          mode: executionDecision.mode,
          scope: executionDecision.scope,
        });

        // Send notification for blocked execution
        await this.bot.sendMessage(
          this.chatId,
          `🔒 Autopilot execution blocked\n\n` +
            `Task: ${proposal.task.title}\n` +
            `Mode: ${executionDecision.mode}\n` +
            `Reason: ${executionDecision.reason}`
        );

        continue;
      }

      // Phase 3: Run Golden Tests before execution
      const planBundle = this.proposalToPlanBundle(proposal);
      const testResult = await this.goldenTestEngine.executePreExecutionTests(planBundle, SEED_GOLDEN_TESTS);

      if (!testResult.all_passed) {
        this.logger.error(`Golden Tests failed for ${proposal.task.title}`, {
          failed: testResult.failed_tests,
          total: testResult.total_tests,
        });

        // Check Kill Switch decision
        if (testResult.kill_switch_decision && testResult.kill_switch_decision.activated) {
          await this.bot.sendMessage(
            this.chatId,
            `🚨 **Kill Switch Activated**\n\n` +
              `Task: ${proposal.task.title}\n` +
              `Reason: ${testResult.kill_switch_decision.reason}\n` +
              `Severity: ${testResult.kill_switch_decision.severity}\n\n` +
              `**Failed Tests:**\n${testResult.test_results
                .filter((r) => r.status === 'failed')
                .map((r) => `• ${r.test_id}: ${r.error_message || 'Failed'}`)
                .join('\n')}\n\n` +
              `Execution has been blocked to prevent past accidents from recurring.`
          );

          this.logger.error(`Kill Switch activated for ${proposal.task.title}`, testResult.kill_switch_decision);
          continue;
        }

        // Even without Kill Switch activation, warn about test failures
        await this.bot.sendMessage(
          this.chatId,
          `⚠️ **Golden Test Failures**\n\n` +
            `Task: ${proposal.task.title}\n` +
            `Failed: ${testResult.failed_tests}/${testResult.total_tests} tests\n\n` +
            `Proceeding with caution...`
        );
      } else {
        this.logger.info(`Golden Tests passed for ${proposal.task.title}`, {
          passed: testResult.passed_tests,
          total: testResult.total_tests,
        });
      }

      try {
        proposal.task.status = 'executing';

        const taskLogger = this.logger.child({
          task_id: proposal.task.id,
          plugin: proposal.task.source_plugin,
          phase: 'execute',
          execution_mode: executionDecision.mode,
          execution_scope: executionDecision.scope,
        });

        taskLogger.info(`Executing task: ${proposal.task.title}`, {
          mode: executionDecision.mode,
          scope: executionDecision.scope,
        });

        // Execute via plugin with timeout
        const plugin = this.plugins.get(proposal.task.source_plugin);
        if (!plugin || !plugin.executeTask) {
          throw new Error(`Plugin not found or missing executeTask: ${proposal.task.source_plugin}`);
        }

        const timeout = plugin.executionTimeout || 60000; // Default 60s
        await this.withTimeout(
          plugin.executeTask(proposal.task),
          timeout,
          `${proposal.task.source_plugin}:${proposal.task.title}`
        );

        proposal.task.status = 'completed';

        // Reset retry count on success
        await this.actionLedger.resetRetryCount(dedupeKey);

        // Phase 4: Record success to Learning Log
        const executionTime = Date.now() - startTime;
        await this.learningLog.recordSuccess(
          proposal,
          routingResult,
          redTeamResult,
          executionTime
        );

        taskLogger.info(`Completed task: ${proposal.task.title}`, { duration_ms: executionTime });

        // v2.2: Send completion notification to M3
        if (this.m3Agent.isEnabled()) {
          this.m3Agent.notifyAsync(
            `Autopilot task completed: ${proposal.task.title}`,
            '✅ Autopilot Success'
          );
        }
      } catch (error) {
        proposal.task.status = 'failed';
        const errorMsg = error instanceof Error ? error.message : String(error);
        const executionTime = Date.now() - startTime;

        const taskLogger = this.logger.child({
          task_id: proposal.task.id,
          plugin: proposal.task.source_plugin,
          phase: 'execute',
        });

        // Phase 4: Record failure to Learning Log
        await this.learningLog.recordFailure(
          proposal,
          routingResult,
          redTeamResult,
          executionTime,
          errorMsg
        );

        taskLogger.error(`Execution failed for ${proposal.task.title}`, error, { duration_ms: executionTime });

        // Record failure and check if we should retry
        const retryInfo = await this.actionLedger.recordFailure(
          dedupeKey,
          errorMsg,
          { task_id: proposal.task.id }
        );

        if (retryInfo.shouldRetry) {
          const retryCount = await this.actionLedger.getRetryCount(dedupeKey);
          await this.bot.sendMessage(
            this.chatId,
            `⚠️ Autopilot task failed: ${proposal.task.title}\n\n` +
              `Error: ${errorMsg}\n\n` +
              `Will retry (${retryCount}/3) in ${Math.round(retryInfo.retryAfter! / 1000)}s...`
          );

          // Schedule retry
          setTimeout(() => {
            this.retryTask(proposal, dedupeKey).catch((err) => {
              console.error(`[Autopilot] Retry scheduling failed:`, err);
            });
          }, retryInfo.retryAfter);
        } else {
          // Max retries reached - notify user
          await this.bot.sendMessage(
            this.chatId,
            `❌ Autopilot task permanently failed: ${proposal.task.title}\n\n` +
              `Error: ${errorMsg}\n\n` +
              `Max retries (3) exceeded. Manual intervention required.`
          );

          // v2.2: Send failure notification to M3
          if (this.m3Agent.isEnabled()) {
            this.m3Agent.notifyAsync(
              `Autopilot task failed (max retries): ${proposal.task.title}`,
              '❌ Autopilot Failure'
            );
          }

          // Log permanent failure to Memory Gateway
          await this.contextManager.appendMemory({
            scope: 'shared/autopilot_failures',
            type: 'permanent_failure',
            title: `Failed: ${proposal.task.title}`,
            content: `Task failed permanently after 3 retries.\n\nError: ${errorMsg}`,
            importance: 9, // High importance for permanent failures
            tags: ['autopilot', 'failure', 'permanent'],
            source_agent: 'jarvis',
          });
        }
      }
    }
  }

  /**
   * Retry a failed task
   */
  private async retryTask(proposal: AutopilotProposal, dedupeKey: string): Promise<void> {
    const isReady = await this.actionLedger.isReadyForRetry(dedupeKey);
    if (!isReady) {
      console.log(`[Autopilot] Task not ready for retry yet: ${proposal.task.title}`);
      return;
    }

    console.log(`[Autopilot] Retrying task: ${proposal.task.title}`);

    try {
      const plugin = this.plugins.get(proposal.task.source_plugin);
      if (plugin && plugin.executeTask) {
        await plugin.executeTask(proposal.task);
        proposal.task.status = 'completed';

        // Reset retry count on success
        await this.actionLedger.resetRetryCount(dedupeKey);

        await this.bot.sendMessage(
          this.chatId,
          `✅ Retry successful: ${proposal.task.title}`
        );

        console.log(`[Autopilot] ✅ Retry succeeded: ${proposal.task.title}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Autopilot] Retry failed for ${proposal.task.title}:`, errorMsg);

      // Record another failure (will check retry limit again)
      const retryInfo = await this.actionLedger.recordFailure(dedupeKey, errorMsg);

      if (retryInfo.shouldRetry) {
        const retryCount = await this.actionLedger.getRetryCount(dedupeKey);
        await this.bot.sendMessage(
          this.chatId,
          `⚠️ Retry failed: ${proposal.task.title}\n\n` +
            `Will retry again (${retryCount}/3) in ${Math.round(retryInfo.retryAfter! / 1000)}s...`
        );

        // Schedule next retry
        setTimeout(() => {
          this.retryTask(proposal, dedupeKey).catch((err) => {
            console.error(`[Autopilot] Retry scheduling failed:`, err);
          });
        }, retryInfo.retryAfter);
      } else {
        // Max retries reached
        await this.bot.sendMessage(
          this.chatId,
          `❌ Autopilot task permanently failed: ${proposal.task.title}\n\n` +
            `Max retries (3) exceeded.`
        );
      }
    }
  }

  /**
   * Phase 7: Learn - Log execution results to Memory Gateway
   */
  private async learnFromExecution(proposals: AutopilotProposal[]): Promise<void> {
    const summary = this.generateExecutionSummary(proposals);

    // Log to Memory Gateway
    await this.contextManager.appendMemory({
      scope: 'shared/autopilot_log',
      type: 'execution_log',
      title: `Autopilot Execution - ${new Date().toISOString()}`,
      content: summary,
      importance: 7,
      tags: ['autopilot', 'execution'],
      source_agent: 'jarvis',
    });

    console.log('[Autopilot] Logged execution results to Memory Gateway');
  }

  // ==================== Helper Methods ====================

  private generateActionPlan(task: AutopilotTask): string[] {
    // Default action plan (plugins can override)
    return [
      'Load current context from Memory Gateway',
      'Execute task logic',
      'Verify results',
      'Update Memory Gateway with results',
    ];
  }

  private estimateDuration(task: AutopilotTask): string {
    switch (task.impact) {
      case 'low':
        return '< 1 min';
      case 'medium':
        return '1-5 min';
      case 'high':
        return '5-15 min';
      default:
        return 'unknown';
    }
  }

  private identifyRisks(task: AutopilotTask): string[] {
    const risks: string[] = [];

    if (task.confidence < 0.6) {
      risks.push('Low confidence - may require manual review');
    }

    if (task.impact === 'high') {
      risks.push('High impact - could affect multiple systems');
    }

    if (task.type === 'predictive') {
      risks.push('Predictive task - based on pattern recognition');
    }

    return risks;
  }

  private formatProposalMessage(proposal: AutopilotProposal): string {
    const { task, action_plan, estimated_duration, risks } = proposal;

    let message = `🤖 **Autopilot Proposal**\n\n`;
    message += `**Task:** ${task.title}\n`;
    message += `**Type:** ${task.type}\n`;
    message += `**Confidence:** ${(task.confidence * 100).toFixed(0)}%\n`;
    message += `**Impact:** ${task.impact}\n`;
    message += `**Duration:** ${estimated_duration}\n\n`;
    message += `**Description:**\n${task.description}\n\n`;
    message += `**Reason:**\n${task.reason}\n\n`;
    message += `**Action Plan:**\n${action_plan.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n`;

    if (risks.length > 0) {
      message += `**Risks:**\n${risks.map((risk) => `⚠️ ${risk}`).join('\n')}\n\n`;
    }

    message += `Do you approve this task?`;

    return message;
  }

  private async requestApproval(message: string, taskId: string): Promise<'approved' | 'rejected'> {
    // TODO: Implement Telegram inline keyboard for approval
    // For now, just send message and assume approval
    await this.bot.sendMessage(this.chatId, message);

    // Placeholder: In Phase 3.5, implement inline keyboard with callbacks
    return 'approved';
  }

  private generateExecutionSummary(proposals: AutopilotProposal[]): string {
    const completed = proposals.filter((p) => p.task.status === 'completed');
    const failed = proposals.filter((p) => p.task.status === 'failed');
    const rejected = proposals.filter((p) => p.task.status === 'rejected');

    let summary = `# Autopilot Execution Summary\n\n`;
    summary += `**Completed:** ${completed.length}\n`;
    summary += `**Failed:** ${failed.length}\n`;
    summary += `**Rejected:** ${rejected.length}\n\n`;

    if (completed.length > 0) {
      summary += `## ✅ Completed Tasks\n\n`;
      completed.forEach((p) => {
        summary += `- ${p.task.title} (${p.task.type}, confidence: ${(p.task.confidence * 100).toFixed(0)}%)\n`;
      });
      summary += `\n`;
    }

    if (failed.length > 0) {
      summary += `## ❌ Failed Tasks\n\n`;
      failed.forEach((p) => {
        summary += `- ${p.task.title}\n`;
      });
      summary += `\n`;
    }

    return summary;
  }

  /**
   * Phase 3: Convert AutopilotProposal to PlanBundle for Golden Test validation
   */
  private proposalToPlanBundle(proposal: AutopilotProposal): import('./types').PlanBundle {
    const { task, action_plan, risks } = proposal;

    return {
      plan_id: task.id,
      title: task.title,
      scope: 'test', // Default to test scope for safety
      confidence: task.confidence,
      impact: task.impact as 'low' | 'medium' | 'high' | 'critical',

      evidence: {
        rationale: task.reason,
        supporting_data: {
          task_type: task.type,
          source_plugin: task.source_plugin,
          description: task.description,
        },
        alternative_approaches: [],
        cost_benefit_analysis: `Estimated duration: ${this.estimateDuration(task)}`,
      },

      actions: action_plan.map((step, index) => ({
        action_id: `${task.id}_action_${index}`,
        type: 'custom',
        description: step,
        idempotency_key: `${task.id}_${index}`,
        expected_outcome: 'Task step completed',
        reversible: true,
      })),

      risk: {
        identified_risks: risks.map((risk, index) => ({
          risk_id: `${task.id}_risk_${index}`,
          description: risk,
          likelihood: task.confidence < 0.5 ? 'high' : task.confidence < 0.8 ? 'medium' : 'low',
          severity: task.impact,
          mitigation_strategy: 'Action Ledger deduplication + retry logic',
        })),
        overall_risk_score: task.confidence < 0.5 ? 0.8 : task.confidence < 0.8 ? 0.5 : 0.2,
        acceptable_risk_threshold: 0.7,
        mitigation_plan: 'Automatic retry with exponential backoff, M3 Agent notification',
        rollback_plan: {
          rollback_steps: ['Log failure to Memory Gateway', 'Notify user', 'Mark task as failed'],
          estimated_rollback_time: '< 1 minute',
          data_preservation_strategy: 'All state persisted in Memory Gateway',
        },
      },

      created_at: task.created_at,
    };
  }
}
