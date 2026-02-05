/**
 * /meta コマンド - Jarvis Self-Improvement Engine Interface
 * Jarvis自身の自己分析・改善提案・進化ログを閲覧
 */

import db from '../db.js';
import logger from '../utils/logger.js';

/**
 * @param {string} chatId - Chat ID
 * @param {Array<string>} args - Command arguments
 */
export async function metaCommand(chatId, args) {
  const subcommand = args[0] || 'status';

  try {
    switch (subcommand) {
      case 'status':
        return await showStatus();
      case 'audit':
        return await showLatestAudit();
      case 'propose':
        return await showLatestProposal();
      case 'log':
        return await showEvolutionLog();
      default:
        return `❌ Unknown subcommand: ${subcommand}\n\nAvailable:\n- /meta status\n- /meta audit\n- /meta propose\n- /meta log`;
    }
  } catch (error) {
    logger.error('[meta] Command error:', error);
    return '❌ Meta-Agent error occurred';
  }
}

/**
 * Show current Meta-Agent status
 */
async function showStatus() {
  const latestAudit = db.prepare(`
    SELECT date, error_rate, avg_response_time, dj_satisfaction_score
    FROM self_audit_results
    ORDER BY date DESC
    LIMIT 1
  `).get();

  const totalProposals = db.prepare(`
    SELECT COUNT(*) as count FROM self_improvement_proposals WHERE status = 'pending'
  `).get().count;

  const totalEvolutions = db.prepare(`
    SELECT COUNT(*) as count FROM evolution_log
  `).get().count;

  if (!latestAudit) {
    return `🤖 **Jarvis Meta-Agent Status**\n\n` +
           `⚠️ No self-audit data yet.\n` +
           `Run self-audit first to see stats.`;
  }

  return `🤖 **Jarvis Meta-Agent Status**\n\n` +
         `📊 **Latest Self-Audit** (${latestAudit.date}):\n` +
         `- Error Rate: ${(latestAudit.error_rate * 100).toFixed(1)}%\n` +
         `- Avg Response Time: ${latestAudit.avg_response_time}ms\n` +
         `- DJ Satisfaction: ${latestAudit.dj_satisfaction_score}/100\n\n` +
         `💡 **Pending Proposals**: ${totalProposals}\n` +
         `🧬 **Total Evolutions**: ${totalEvolutions}\n\n` +
         `Use /meta audit, /meta propose, /meta log for details.`;
}

/**
 * Show latest self-audit result
 */
async function showLatestAudit() {
  const audit = db.prepare(`
    SELECT * FROM self_audit_results
    ORDER BY date DESC
    LIMIT 1
  `).get();

  if (!audit) {
    return '❌ No audit results found.\nRun self-audit first.';
  }

  return `📊 **Latest Self-Audit Report**\n\n` +
         `📅 Date: ${audit.date}\n` +
         `❌ Error Rate: ${(audit.error_rate * 100).toFixed(1)}%\n` +
         `⏱️ Avg Response: ${audit.avg_response_time}ms\n` +
         `😊 DJ Satisfaction: ${audit.dj_satisfaction_score}/100\n\n` +
         `📝 **Issues Found**:\n${audit.issues_found || 'None'}\n\n` +
         `✅ **Suggestions**:\n${audit.suggestions || 'None'}`;
}

/**
 * Show latest improvement proposal
 */
async function showLatestProposal() {
  const proposal = db.prepare(`
    SELECT * FROM self_improvement_proposals
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  if (!proposal) {
    return '✅ No pending improvement proposals.\nJarvis is satisfied with current implementation!';
  }

  const statusEmoji = {
    pending: '⏳',
    approved: '✅',
    rejected: '❌'
  }[proposal.status] || '❓';

  return `💡 **Latest Improvement Proposal**\n\n` +
         `${statusEmoji} Status: ${proposal.status}\n` +
         `📂 File: ${proposal.file_path}\n` +
         `🔧 Change: ${proposal.change_type}\n\n` +
         `**Reason**:\n${proposal.reason}\n\n` +
         `**Impact**:\n${proposal.impact}\n\n` +
         `**Code Diff**:\n\`\`\`\n${proposal.code_diff}\n\`\`\``;
}

/**
 * Show evolution log (recent 5 entries)
 */
async function showEvolutionLog() {
  const logs = db.prepare(`
    SELECT * FROM evolution_log
    ORDER BY timestamp DESC
    LIMIT 5
  `).all();

  if (logs.length === 0) {
    return '📜 No evolution history yet.\nJarvis hasn\'t evolved yet!';
  }

  let response = '🧬 **Jarvis Evolution Log** (Recent 5)\n\n';

  logs.forEach((log, index) => {
    response += `${index + 1}. **${log.change_type}** - ${log.timestamp}\n`;
    response += `   📂 ${log.file_path}\n`;
    response += `   📝 ${log.description}\n`;
    response += `   ✅ Result: ${log.result}\n\n`;
  });

  return response;
}
