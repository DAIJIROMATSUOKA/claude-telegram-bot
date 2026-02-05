// Meta-Agent Orchestrator
// Coordinates all meta-agent operations, manages state, provides kill switch

import { getDb } from './db.js';
import { performSelfAudit, getLatestAudit } from './self-audit.js';
import { performCodeReview, getPendingSuggestions } from './code-review.js';
import { generateRefactorProposals, getPendingProposals } from './refactor-proposer.js';
import { analyzeCapabilityGaps, getDetectedGaps } from './capability-gap.js';
import type { MetaAgentState, MetaAgentLog } from './types.js';

/**
 * Get meta-agent state (singleton)
 */
export function getMetaAgentState(): MetaAgentState {
  const db = getDb();
  const state = db.prepare('SELECT * FROM meta_agent_state WHERE id = 1').get() as MetaAgentState | undefined;

  if (!state) {
    // Initialize state if not exists
    db.prepare(`
      INSERT INTO meta_agent_state (id, enabled, self_audit_enabled, code_review_enabled, refactor_enabled, gap_analysis_enabled)
      VALUES (1, 1, 1, 1, 1, 1)
    `).run();
    return getMetaAgentState();
  }

  return state;
}

/**
 * Check if meta-agent is enabled
 */
export function isMetaAgentEnabled(): boolean {
  const state = getMetaAgentState();
  return state.enabled === 1;
}

/**
 * Enable meta-agent (global kill switch OFF)
 */
export function enableMetaAgent(modifiedBy: string = 'DJ') {
  const db = getDb();
  db.prepare(`
    UPDATE meta_agent_state
    SET enabled = 1, last_modified_at = datetime('now'), last_modified_by = ?
    WHERE id = 1
  `).run(modifiedBy);

  console.log('✅ Meta-Agent enabled');
}

/**
 * Disable meta-agent (global kill switch ON)
 */
export function disableMetaAgent(modifiedBy: string = 'DJ') {
  const db = getDb();
  db.prepare(`
    UPDATE meta_agent_state
    SET enabled = 0, last_modified_at = datetime('now'), last_modified_by = ?
    WHERE id = 1
  `).run(modifiedBy);

  console.log('🛑 Meta-Agent disabled (Kill Switch activated)');
}

/**
 * Toggle individual feature
 */
export function toggleFeature(
  feature: 'self_audit' | 'code_review' | 'refactor' | 'gap_analysis',
  enabled: boolean
) {
  const db = getDb();
  const column = `${feature}_enabled`;
  db.prepare(`
    UPDATE meta_agent_state
    SET ${column} = ?, last_modified_at = datetime('now')
    WHERE id = 1
  `).run(enabled ? 1 : 0);

  console.log(`✅ ${feature} ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Run all meta-agent operations
 */
export async function runMetaAgent(options: {
  selfAudit?: boolean;
  codeReview?: boolean;
  refactor?: boolean;
  gapAnalysis?: boolean;
} = {}): Promise<{
  selfAudit: any;
  codeReview: any;
  refactor: any;
  gapAnalysis: any;
}> {
  if (!isMetaAgentEnabled()) {
    throw new Error('Meta-Agent is disabled (Kill Switch active)');
  }

  const state = getMetaAgentState();
  const results: any = {
    selfAudit: null,
    codeReview: null,
    refactor: null,
    gapAnalysis: null,
  };

  console.log('🤖 Meta-Agent: Starting self-improvement cycle...');

  // 1. Self-Audit
  if ((options.selfAudit !== false) && state.self_audit_enabled === 1) {
    try {
      console.log('📊 Running Self-Audit...');
      results.selfAudit = await performSelfAudit();
      console.log(`   ✅ Self-Audit complete: ${results.selfAudit.error_count} errors, satisfaction ${results.selfAudit.satisfaction_score.toFixed(2)}`);
    } catch (error) {
      console.error('   ❌ Self-Audit failed:', error);
    }
  }

  // 2. Code Review
  if ((options.codeReview !== false) && state.code_review_enabled === 1) {
    try {
      console.log('🔍 Running Code Review...');
      results.codeReview = await performCodeReview();
      console.log(`   ✅ Code Review complete: ${results.codeReview.length} suggestions`);
    } catch (error) {
      console.error('   ❌ Code Review failed:', error);
    }
  }

  // 3. Generate Refactor Proposals (if code review found issues)
  if ((options.refactor !== false) && state.refactor_enabled === 1) {
    try {
      const pendingSuggestions = getPendingSuggestions();
      if (pendingSuggestions.length > 0) {
        console.log(`🔨 Generating Refactor Proposals (${pendingSuggestions.length} suggestions)...`);
        results.refactor = await generateRefactorProposals(pendingSuggestions);
        console.log(`   ✅ Refactor Proposals complete: ${results.refactor.length} proposals`);
      }
    } catch (error) {
      console.error('   ❌ Refactor Proposals failed:', error);
    }
  }

  // 4. Capability Gap Analysis
  if ((options.gapAnalysis !== false) && state.gap_analysis_enabled === 1) {
    try {
      console.log('🔍 Running Capability Gap Analysis...');
      results.gapAnalysis = await analyzeCapabilityGaps(7);
      console.log(`   ✅ Capability Gap Analysis complete: ${results.gapAnalysis.length} gaps detected`);
    } catch (error) {
      console.error('   ❌ Capability Gap Analysis failed:', error);
    }
  }

  console.log('✅ Meta-Agent: Self-improvement cycle complete!');

  return results;
}

/**
 * Get meta-agent activity logs
 */
export function getMetaAgentLogs(limit: number = 20): MetaAgentLog[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM meta_agent_log
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as MetaAgentLog[];
}

/**
 * Get latest logs by action type
 */
export function getLogsByActionType(actionType: string, limit: number = 10): MetaAgentLog[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM meta_agent_log
    WHERE action_type = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(actionType, limit) as MetaAgentLog[];
}

/**
 * Get meta-agent dashboard summary
 */
export function getMetaAgentDashboard(): {
  state: MetaAgentState;
  latestAudit: any;
  pendingSuggestions: number;
  pendingProposals: number;
  detectedGaps: number;
  recentLogs: MetaAgentLog[];
} {
  const state = getMetaAgentState();
  const latestAudit = getLatestAudit();
  const pendingSuggestions = getPendingSuggestions();
  const pendingProposals = getPendingProposals();
  const detectedGaps = getDetectedGaps();
  const recentLogs = getMetaAgentLogs(10);

  return {
    state,
    latestAudit,
    pendingSuggestions: pendingSuggestions.length,
    pendingProposals: pendingProposals.length,
    detectedGaps: detectedGaps.length,
    recentLogs,
  };
}
