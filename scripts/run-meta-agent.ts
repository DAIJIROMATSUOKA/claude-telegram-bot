#!/usr/bin/env bun
// Meta-Agent CLI Runner

import {
  runMetaAgent,
  getMetaAgentDashboard,
  isMetaAgentEnabled,
} from '../src/meta-agent/index.js';

const args = process.argv.slice(2);

async function main() {
  if (!isMetaAgentEnabled()) {
    console.log('🛑 Meta-Agent is disabled (Kill Switch active)');
    process.exit(0);
  }

  if (args.includes('--dashboard')) {
    // Show dashboard
    const dashboard = getMetaAgentDashboard();
    console.log('📊 Meta-Agent Dashboard:\n');
    console.log(`Status: ${dashboard.state.enabled ? '✅ Enabled' : '🛑 Disabled'}`);
    console.log(`Last Modified: ${dashboard.state.last_modified_at} by ${dashboard.state.last_modified_by}\n`);

    console.log('Feature Status:');
    console.log(`  Self-Audit:      ${dashboard.state.self_audit_enabled ? '✅' : '❌'}`);
    console.log(`  Code Review:     ${dashboard.state.code_review_enabled ? '✅' : '❌'}`);
    console.log(`  Refactor:        ${dashboard.state.refactor_enabled ? '✅' : '❌'}`);
    console.log(`  Gap Analysis:    ${dashboard.state.gap_analysis_enabled ? '✅' : '❌'}\n`);

    console.log('Current Status:');
    console.log(`  Pending Code Review Suggestions: ${dashboard.pendingSuggestions}`);
    console.log(`  Pending Refactor Proposals:      ${dashboard.pendingProposals}`);
    console.log(`  Detected Capability Gaps:        ${dashboard.detectedGaps}\n`);

    if (dashboard.latestAudit) {
      console.log('Latest Self-Audit:');
      console.log(`  Date:              ${dashboard.latestAudit.date}`);
      console.log(`  Error Count:       ${dashboard.latestAudit.error_count}`);
      console.log(`  Avg Response (ms): ${dashboard.latestAudit.avg_response_ms || 'N/A'}`);
      console.log(`  Satisfaction:      ${dashboard.latestAudit.satisfaction_score.toFixed(2)}\n`);
    }

    console.log('Recent Activity:');
    dashboard.recentLogs.slice(0, 5).forEach((log) => {
      const status = log.action_status === 'completed' ? '✅' : log.action_status === 'failed' ? '❌' : '⏳';
      console.log(`  ${status} ${log.action_type.padEnd(15)} ${log.started_at} (${log.duration_ms || 0}ms)`);
    });

    return;
  }

  // Run meta-agent
  const options = {
    selfAudit: args.includes('--self-audit') || args.includes('--all'),
    codeReview: args.includes('--code-review') || args.includes('--all'),
    refactor: args.includes('--refactor') || args.includes('--all'),
    gapAnalysis: args.includes('--gap-analysis') || args.includes('--all'),
  };

  await runMetaAgent(options);
}

main().catch((error) => {
  console.error('❌ Meta-Agent failed:', error);
  process.exit(1);
});
