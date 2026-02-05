// Meta-Agent Command Handlers
// /meta commands for self-improvement engine

import type { Context } from 'grammy';
import { isAuthorized } from '../security.js';
import { ALLOWED_USERS } from '../config.js';
import {
  runMetaAgent,
  getMetaAgentDashboard,
  enableMetaAgent,
  disableMetaAgent,
  isMetaAgentEnabled,
  getPendingSuggestions,
  getPendingProposals,
  getDetectedGaps,
  updateSuggestionStatus,
  approveProposal,
  rejectProposal,
  approveGap,
  rejectGap,
  getHighPriorityGaps,
} from '../meta-agent/index.js';

/**
 * /meta - Show meta-agent dashboard
 */
export async function handleMeta(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const dashboard = getMetaAgentDashboard();

    const statusEmoji = dashboard.state.enabled ? '✅' : '🛑';
    const features = [
      `Self-Audit: ${dashboard.state.self_audit_enabled ? '✅' : '❌'}`,
      `Code Review: ${dashboard.state.code_review_enabled ? '✅' : '❌'}`,
      `Refactor: ${dashboard.state.refactor_enabled ? '✅' : '❌'}`,
      `Gap Analysis: ${dashboard.state.gap_analysis_enabled ? '✅' : '❌'}`,
    ].join('\n');

    let auditInfo = 'No audit data yet';
    if (dashboard.latestAudit) {
      const audit = dashboard.latestAudit;
      auditInfo = [
        `Date: ${audit.date}`,
        `Errors: ${audit.error_count}`,
        `Avg Response: ${audit.avg_response_ms || 'N/A'}ms`,
        `Satisfaction: ${audit.satisfaction_score.toFixed(2)}`,
      ].join('\n');
    }

    const message = `🤖 <b>Meta-Agent Dashboard</b>\n\n` +
      `<b>Status:</b> ${statusEmoji} ${dashboard.state.enabled ? 'Enabled' : 'Disabled (Kill Switch)'}\n` +
      `<b>Last Modified:</b> ${dashboard.state.last_modified_at}\n\n` +
      `<b>Features:</b>\n${features}\n\n` +
      `<b>Pending Items:</b>\n` +
      `Code Review Suggestions: ${dashboard.pendingSuggestions}\n` +
      `Refactor Proposals: ${dashboard.pendingProposals}\n` +
      `Capability Gaps: ${dashboard.detectedGaps}\n\n` +
      `<b>Latest Self-Audit:</b>\n${auditInfo}\n\n` +
      `<b>Commands:</b>\n` +
      `/meta_run - Run full meta-agent cycle\n` +
      `/meta_audit - Run self-audit only\n` +
      `/meta_review - Run code review only\n` +
      `/meta_gaps - Show capability gaps\n` +
      `/meta_stop - Activate kill switch\n` +
      `/meta_start - Deactivate kill switch`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in /meta:', error);
    await ctx.reply('❌ Failed to fetch meta-agent dashboard');
  }
}

/**
 * /meta_run - Run full meta-agent cycle
 */
export async function handleMetaRun(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  if (!isMetaAgentEnabled()) {
    await ctx.reply('🛑 Meta-Agent is disabled (Kill Switch active). Use /meta_start to enable.');
    return;
  }

  await ctx.reply('🤖 Running full Meta-Agent cycle... This may take a few minutes.');

  try {
    const results = await runMetaAgent();

    const summary = [
      '✅ Meta-Agent cycle complete!\n',
      `<b>Self-Audit:</b>`,
      results.selfAudit
        ? `  Errors: ${results.selfAudit.error_count}, Satisfaction: ${results.selfAudit.satisfaction_score.toFixed(2)}`
        : '  (Skipped)',
      '',
      `<b>Code Review:</b>`,
      results.codeReview
        ? `  ${results.codeReview.length} suggestions generated`
        : '  (Skipped)',
      '',
      `<b>Refactor Proposals:</b>`,
      results.refactor
        ? `  ${results.refactor.length} proposals generated`
        : '  (Skipped)',
      '',
      `<b>Capability Gaps:</b>`,
      results.gapAnalysis
        ? `  ${results.gapAnalysis.length} gaps detected`
        : '  (Skipped)',
    ].join('\n');

    await ctx.reply(summary, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in /meta_run:', error);
    await ctx.reply(`❌ Meta-Agent failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * /meta_audit - Run self-audit only
 */
export async function handleMetaAudit(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  if (!isMetaAgentEnabled()) {
    await ctx.reply('🛑 Meta-Agent is disabled (Kill Switch active). Use /meta_start to enable.');
    return;
  }

  await ctx.reply('📊 Running Self-Audit...');

  try {
    const results = await runMetaAgent({ selfAudit: true, codeReview: false, refactor: false, gapAnalysis: false });

    if (results.selfAudit) {
      const audit = results.selfAudit;
      const message = [
        '✅ Self-Audit complete!\n',
        `<b>Date:</b> ${audit.date}`,
        `<b>Error Count:</b> ${audit.error_count}`,
        `<b>Avg Response:</b> ${audit.avg_response_ms || 'N/A'}ms`,
        `<b>Satisfaction Score:</b> ${audit.satisfaction_score.toFixed(2)}`,
        '',
        `<b>Issues Found:</b> ${JSON.parse(audit.issues_found).length}`,
        `<b>Recommendations:</b> ${JSON.parse(audit.recommendations).length}`,
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'HTML' });
    } else {
      await ctx.reply('⚠️  Self-Audit returned no results');
    }
  } catch (error) {
    console.error('Error in /meta_audit:', error);
    await ctx.reply(`❌ Self-Audit failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * /meta_review - Run code review only
 */
export async function handleMetaReview(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  if (!isMetaAgentEnabled()) {
    await ctx.reply('🛑 Meta-Agent is disabled (Kill Switch active). Use /meta_start to enable.');
    return;
  }

  await ctx.reply('🔍 Running Code Review... This may take several minutes.');

  try {
    const results = await runMetaAgent({ selfAudit: false, codeReview: true, refactor: true, gapAnalysis: false });

    const message = [
      '✅ Code Review complete!\n',
      `<b>Suggestions:</b> ${results.codeReview?.length || 0}`,
      `<b>Refactor Proposals:</b> ${results.refactor?.length || 0}`,
      '',
      'Use /meta_suggestions to review pending suggestions',
    ].join('\n');

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in /meta_review:', error);
    await ctx.reply(`❌ Code Review failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * /meta_gaps - Show capability gaps
 */
export async function handleMetaGaps(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const gaps = getHighPriorityGaps();

    if (gaps.length === 0) {
      await ctx.reply('✅ No high-priority capability gaps detected');
      return;
    }

    const gapsList = gaps.slice(0, 5).map((gap, idx) => {
      const priority = gap.priority === 'high' ? '🔴' : gap.priority === 'medium' ? '🟡' : '🟢';
      return [
        `${idx + 1}. ${priority} <b>${gap.operation_name}</b>`,
        `   Count: ${gap.manual_count} times`,
        `   Suggestion: ${gap.automation_suggestion || 'N/A'}`,
        `   Time Saved: ${gap.estimated_time_saved_minutes || 0} min/occurrence`,
      ].join('\n');
    }).join('\n\n');

    const message = `🔍 <b>High-Priority Capability Gaps</b>\n\n` +
      gapsList +
      `\n\n<i>Showing top ${Math.min(gaps.length, 5)} of ${gaps.length} gaps</i>`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in /meta_gaps:', error);
    await ctx.reply('❌ Failed to fetch capability gaps');
  }
}

/**
 * /meta_stop - Activate kill switch (disable meta-agent)
 */
export async function handleMetaStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  disableMetaAgent('DJ');
  await ctx.reply('🛑 Kill Switch activated. Meta-Agent disabled.');
}

/**
 * /meta_start - Deactivate kill switch (enable meta-agent)
 */
export async function handleMetaStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  enableMetaAgent('DJ');
  await ctx.reply('✅ Kill Switch deactivated. Meta-Agent enabled.');
}
