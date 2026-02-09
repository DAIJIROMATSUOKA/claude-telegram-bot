// Capability Gap Analyzer
// Detects repeated manual operations from conversation history and proposes automation

import { ulid } from 'ulid';
import { getDb } from './db.js';
import { callMetaCLI } from './cli.js';
import type { CapabilityGap, MetaAgentLog } from './types.js';

const GAP_ANALYSIS_PROMPT = `You are an automation expert analyzing DJ's conversation history to detect repeated manual operations.

Recent conversation history (DJ's messages only):
{{HISTORY}}

Detect patterns where DJ repeatedly performs the same operation manually. Examples:
- Running the same git commands repeatedly
- Manually restarting services
- Repeatedly asking for the same type of information
- Manual file operations that could be automated
- Repeated testing steps

For each detected pattern, provide:
1. **Operation Name**: Short name (e.g., "Manual bot restart")
2. **Description**: What DJ is doing manually
3. **Manual Count**: How many times this was detected in history (estimate)
4. **Automation Suggestion**: How this could be automated
5. **Estimated Time Saved**: Minutes saved per automation
6. **Priority**: 'low', 'medium', or 'high' (based on frequency and time saved)

Return JSON array:
[
  {
    "operation_name": "Manual bot restart",
    "description": "DJ manually runs ./start-bot.sh multiple times",
    "manual_count": 5,
    "automation_suggestion": "Add /restart command to restart bot from Telegram",
    "estimated_time_saved_minutes": 2,
    "priority": "medium"
  }
]

Return ONLY the JSON array, no other text. If no patterns detected, return empty array [].`;

/**
 * Analyze conversation history to detect capability gaps
 */
export async function analyzeCapabilityGaps(daysBack: number = 7): Promise<CapabilityGap[]> {
  const db = getDb();
  const startTime = Date.now();

  // Log start
  const logId = ulid();
  db.prepare(`
    INSERT INTO meta_agent_log (log_id, action_type, action_status, started_at)
    VALUES (?, 'gap_analysis', 'started', datetime('now'))
  `).run(logId);

  try {
    // Get recent conversation history (DJ's messages only)
    const history = getRecentConversationHistory(daysBack);

    if (history.length === 0) {
      console.log('⚠️  No conversation history found');
      return [];
    }

    console.log(`🔍 Analyzing ${history.length} messages for capability gaps...`);

    const prompt = GAP_ANALYSIS_PROMPT.replace('{{HISTORY}}', history.join('\n\n'));

    // Call Claude CLI for gap analysis
    const response = await callMetaCLI(prompt);

    // Parse JSON response
    let gaps: any[] = [];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        gaps = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn(`   ⚠️  Failed to parse JSON from response`);
      return [];
    }

    // Convert to CapabilityGap objects
    const capabilityGaps: CapabilityGap[] = gaps.map((gap) => {
      const gapId = ulid();
      const capGap: CapabilityGap = {
        gap_id: gapId,
        operation_name: gap.operation_name || 'Unknown Operation',
        operation_description: gap.description || '',
        manual_count: gap.manual_count || 1,
        last_seen_at: new Date().toISOString(),
        automation_suggestion: gap.automation_suggestion || null,
        estimated_time_saved_minutes: gap.estimated_time_saved_minutes || null,
        priority: gap.priority || 'low',
        status: 'detected',
        created_at: new Date().toISOString(),
        metadata: JSON.stringify({ source: 'claude-cli', days_analyzed: daysBack }),
      };

      // Check if gap already exists (by operation_name)
      const existing = db.prepare('SELECT * FROM capability_gaps WHERE operation_name = ?').get(capGap.operation_name) as CapabilityGap | undefined;

      if (existing) {
        // Update existing gap
        db.prepare(`
          UPDATE capability_gaps
          SET manual_count = manual_count + ?, last_seen_at = ?, metadata = ?
          WHERE operation_name = ?
        `).run(capGap.manual_count, capGap.last_seen_at, capGap.metadata as any, capGap.operation_name);

        return { ...existing, manual_count: existing.manual_count + capGap.manual_count };
      } else {
        // Insert new gap
        db.prepare(`
          INSERT INTO capability_gaps
          (gap_id, operation_name, operation_description, manual_count, last_seen_at, automation_suggestion, estimated_time_saved_minutes, priority, status, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...[
          capGap.gap_id,
          capGap.operation_name,
          capGap.operation_description,
          capGap.manual_count,
          capGap.last_seen_at,
          capGap.automation_suggestion,
          capGap.estimated_time_saved_minutes,
          capGap.priority,
          capGap.status,
          capGap.metadata
        ] as any);

        return capGap;
      }
    });

    // Update log
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'completed', completed_at = datetime('now'), duration_ms = ?, result_summary = ?
      WHERE log_id = ?
    `).run(duration, `Detected ${capabilityGaps.length} capability gaps`, logId);

    console.log(`✅ Capability gap analysis complete: ${capabilityGaps.length} gaps detected`);
    return capabilityGaps;
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
 * Get recent conversation history (DJ's messages only)
 */
function getRecentConversationHistory(daysBack: number): string[] {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const messages = db.prepare(`
    SELECT user_message, created_at
    FROM jarvis_chat_history
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(cutoffDate.toISOString()) as { user_message: string; created_at: string }[];

  return messages.map((m) => `[${m.created_at}] ${m.user_message}`);
}

/**
 * Get detected capability gaps
 */
export function getDetectedGaps(): CapabilityGap[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM capability_gaps
    WHERE status = 'detected'
    ORDER BY priority DESC, manual_count DESC
  `).all() as CapabilityGap[];
}

/**
 * Get high-priority gaps (manual_count >= 5)
 */
export function getHighPriorityGaps(): CapabilityGap[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM capability_gaps
    WHERE status = 'detected' AND (manual_count >= 5 OR priority = 'high')
    ORDER BY manual_count DESC
  `).all() as CapabilityGap[];
}

/**
 * Approve capability gap for implementation
 */
export function approveGap(gapId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE capability_gaps
    SET status = 'approved', user_feedback = ?
    WHERE gap_id = ?
  `).run(userFeedback || null, gapId);
}

/**
 * Reject capability gap
 */
export function rejectGap(gapId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE capability_gaps
    SET status = 'rejected', user_feedback = ?
    WHERE gap_id = ?
  `).run(userFeedback || null, gapId);
}

/**
 * Mark gap as implemented
 */
export function markGapImplemented(gapId: string, userFeedback?: string) {
  const db = getDb();
  db.prepare(`
    UPDATE capability_gaps
    SET status = 'implemented', resolved_at = datetime('now'), user_feedback = ?
    WHERE gap_id = ?
  `).run(userFeedback || null, gapId);
}
