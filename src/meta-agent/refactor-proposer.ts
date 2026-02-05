// Auto-Refactor Proposer
// Generates concrete refactoring proposals based on code review suggestions

import { ulid } from 'ulid';
import { getDb } from './db.js';
import { callMetaCLI } from './cli.js';
import type { CodeReviewSuggestion, RefactorProposal, MetaAgentLog } from './types.js';

const REFACTOR_PROMPT = `You are a refactoring architect. Based on the following code review suggestions, create a concrete refactoring proposal.

Code Review Suggestions:
{{SUGGESTIONS}}

Generate a refactoring proposal with:
1. **Title**: Short, descriptive title (e.g., "Extract duplicate auth logic into utility")
2. **Description**: Detailed explanation of what needs to be refactored
3. **Affected Files**: List of files that will be modified
4. **Estimated Impact**: 'low', 'medium', or 'high'
5. **Estimated Time**: Time in minutes to complete the refactor
6. **Benefits**: List of benefits (e.g., reduced code duplication, improved performance)
7. **Risks**: List of potential risks (e.g., breaking existing functionality)
8. **Rollback Plan**: How to undo if something goes wrong

Return JSON:
{
  "title": "...",
  "description": "...",
  "affected_files": ["src/file1.ts", "src/file2.ts"],
  "estimated_impact": "medium",
  "estimated_time_minutes": 30,
  "benefits": ["Reduced duplication", "Easier maintenance"],
  "risks": ["May affect dependent modules"],
  "rollback_plan": "git stash pop to restore original state"
}

Return ONLY the JSON object, no other text.`;

/**
 * Generate refactor proposals from pending code review suggestions
 */
export async function generateRefactorProposals(suggestions: CodeReviewSuggestion[]): Promise<RefactorProposal[]> {
  const db = getDb();
  const startTime = Date.now();

  // Log start
  const logId = ulid();
  db.prepare(`
    INSERT INTO meta_agent_log (log_id, action_type, action_status, started_at)
    VALUES (?, 'refactor', 'started', datetime('now'))
  `).run(logId);

  try {
    // Group suggestions by file
    const suggestionsByFile = new Map<string, CodeReviewSuggestion[]>();
    suggestions.forEach((s) => {
      const existing = suggestionsByFile.get(s.file_path) || [];
      existing.push(s);
      suggestionsByFile.set(s.file_path, existing);
    });

    const proposals: RefactorProposal[] = [];

    // Generate proposal for each file with multiple suggestions
    for (const [filePath, fileSuggestions] of suggestionsByFile.entries()) {
      if (fileSuggestions.length < 2) continue; // Only refactor if multiple issues

      console.log(`🔨 Generating refactor proposal for: ${filePath}`);

      try {
        const proposal = await generateProposalForFile(filePath, fileSuggestions);
        if (proposal) {
          proposals.push(proposal);
        }
      } catch (error) {
        console.error(`   ⚠️  Failed to generate proposal for ${filePath}:`, error);
      }
    }

    // Update log
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'completed', completed_at = datetime('now'), duration_ms = ?, result_summary = ?
      WHERE log_id = ?
    `).run(duration, `Generated ${proposals.length} refactor proposals`, logId);

    console.log(`✅ Generated ${proposals.length} refactor proposals`);
    return proposals;
  } catch (error) {
    // Log failure
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'failed', completed_at = datetime('now'), error_message = ?
      WHERE log_id = ?
    `).run(error instanceof Error ? error.message : String(error), logId);

    throw error;
  }
}

/**
 * Generate refactor proposal for a single file
 */
async function generateProposalForFile(
  filePath: string,
  suggestions: CodeReviewSuggestion[]
): Promise<RefactorProposal | null> {
  const db = getDb();

  const suggestionsSummary = suggestions.map((s) => ({
    issue_type: s.issue_type,
    severity: s.severity,
    description: s.description,
    line_number: s.line_number,
  }));

  const prompt = REFACTOR_PROMPT.replace(
    '{{SUGGESTIONS}}',
    JSON.stringify(suggestionsSummary, null, 2)
  );

  try {
    // Call Claude CLI for refactor proposal
    const response = await callMetaCLI(prompt);

    // Parse JSON response
    let proposalData: any = null;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        proposalData = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn(`   ⚠️  Failed to parse JSON from response`);
      return null;
    }

    if (!proposalData) return null;

    // Create RefactorProposal object
    const proposalId = ulid();
    const proposal: RefactorProposal = {
      proposal_id: proposalId,
      proposal_title: proposalData.title || 'Untitled Refactor',
      proposal_description: proposalData.description || '',
      affected_files: JSON.stringify(proposalData.affected_files || [filePath]),
      estimated_impact: proposalData.estimated_impact || 'medium',
      estimated_time_minutes: proposalData.estimated_time_minutes || 30,
      benefits: JSON.stringify(proposalData.benefits || []),
      risks: JSON.stringify(proposalData.risks || []),
      rollback_plan: proposalData.rollback_plan || 'Use git stash to rollback',
      status: 'proposed',
      created_at: new Date().toISOString(),
      metadata: JSON.stringify({ source: 'claude-cli', suggestions: suggestions.map((s) => s.suggestion_id) }),
    };

    // Save to DB
    db.prepare(`
      INSERT INTO refactor_proposals
      (proposal_id, proposal_title, proposal_description, affected_files, estimated_impact, estimated_time_minutes, benefits, risks, rollback_plan, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.proposal_id,
      proposal.proposal_title,
      proposal.proposal_description,
      proposal.affected_files,
      proposal.estimated_impact,
      proposal.estimated_time_minutes,
      proposal.benefits,
      proposal.risks,
      proposal.rollback_plan,
      proposal.status,
      proposal.metadata
    );

    return proposal;
  } catch (error) {
    console.error(`   ⚠️  Error generating proposal:`, error);
    return null;
  }
}

/**
 * Get pending refactor proposals
 */
export function getPendingProposals(): RefactorProposal[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM refactor_proposals
    WHERE status = 'proposed'
    ORDER BY estimated_impact DESC, created_at DESC
  `).all() as RefactorProposal[];
}

/**
 * Approve refactor proposal
 */
export function approveProposal(proposalId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE refactor_proposals
    SET status = 'approved', approved_at = datetime('now'), user_feedback = ?
    WHERE proposal_id = ?
  `).run(userFeedback || null, proposalId);
}

/**
 * Reject refactor proposal
 */
export function rejectProposal(proposalId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE refactor_proposals
    SET status = 'rejected', user_feedback = ?
    WHERE proposal_id = ?
  `).run(userFeedback || null, proposalId);
}

/**
 * Mark proposal as completed
 */
export function completeProposal(proposalId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE refactor_proposals
    SET status = 'completed', completed_at = datetime('now'), user_feedback = ?
    WHERE proposal_id = ?
  `).run(userFeedback || null, proposalId);
}
