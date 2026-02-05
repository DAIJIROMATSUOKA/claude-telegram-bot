/**
 * Auto-Resume System v2 - Interrupt Recovery
 *
 * 「状況は？」→説明→「実装続行」の無駄なループを自動化
 *
 * @module auto-resume
 */

import { callMemoryGateway } from '../handlers/ai-router';

// ============================================================================
// Types
// ============================================================================

export interface InterruptSnapshot {
  id?: number;
  user_id: string;
  session_id: string;
  work_mode: string; // 'coding' | 'debugging' | 'planning' | 'research' | 'urgent'
  current_task: string | null;
  current_phase: string | null;
  snapshot_data: string; // JSON: full context snapshot
  created_at?: string;
  restored: number; // 0=not restored, 1=restored
}

export interface SnapshotData {
  task_description: string;
  next_action: string;
  context_summary: string;
  priority: 'normal' | 'urgent';
  auto_resume_eligible: boolean;
}

// ============================================================================
// Snapshot Management
// ============================================================================

/**
 * Save interrupt snapshot to database
 *
 * @param userId - Telegram user ID
 * @param sessionId - Current session ID
 * @param workMode - Current work mode
 * @param snapshotData - Detailed snapshot data
 */
export async function saveInterruptSnapshot(
  userId: string,
  sessionId: string,
  workMode: string,
  currentTask: string | null,
  currentPhase: string | null,
  snapshotData: SnapshotData
): Promise<void> {
  try {
    const sql = `
      INSERT INTO interrupt_snapshot
      (user_id, session_id, work_mode, current_task, current_phase, snapshot_data, created_at, restored)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `;

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql,
      params: [
        userId,
        sessionId,
        workMode,
        currentTask,
        currentPhase,
        JSON.stringify(snapshotData),
      ],
    });

    console.log('[Auto-Resume] ✅ Snapshot saved:', {
      task: snapshotData.task_description,
      phase: currentPhase,
      priority: snapshotData.priority,
    });
  } catch (error) {
    console.error('[Auto-Resume] ❌ Failed to save snapshot:', error);
  }
}

/**
 * Get latest unrestored snapshot for user
 *
 * @param userId - Telegram user ID
 * @returns Latest snapshot or null
 */
export async function getLatestSnapshot(userId: string): Promise<InterruptSnapshot | null> {
  try {
    const sql = `
      SELECT * FROM interrupt_snapshot
      WHERE user_id = ? AND restored = 0
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql,
      params: [userId],
    });

    if (!response.data?.results?.[0]) {
      console.log('[Auto-Resume] No unrestored snapshot found');
      return null;
    }

    const snapshot = response.data.results[0] as InterruptSnapshot;
    console.log('[Auto-Resume] 📋 Latest snapshot:', snapshot.id);
    return snapshot;
  } catch (error) {
    console.error('[Auto-Resume] ❌ Failed to get snapshot:', error);
    return null;
  }
}

/**
 * Mark snapshot as restored
 *
 * @param snapshotId - Snapshot ID to mark as restored
 */
export async function markAsRestored(snapshotId: number): Promise<void> {
  try {
    const sql = `
      UPDATE interrupt_snapshot
      SET restored = 1
      WHERE id = ?
    `;

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql,
      params: [snapshotId],
    });

    console.log('[Auto-Resume] ✅ Snapshot marked as restored:', snapshotId);
  } catch (error) {
    console.error('[Auto-Resume] ❌ Failed to mark as restored:', error);
  }
}

/**
 * Get all unrestored snapshots for user
 *
 * @param userId - Telegram user ID
 * @returns Array of snapshots
 */
export async function getAllPendingSnapshots(userId: string): Promise<InterruptSnapshot[]> {
  try {
    const sql = `
      SELECT * FROM interrupt_snapshot
      WHERE user_id = ? AND restored = 0
      ORDER BY created_at DESC
    `;

    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql,
      params: [userId],
    });

    if (!response.data?.results) {
      return [];
    }

    return response.data.results as InterruptSnapshot[];
  } catch (error) {
    console.error('[Auto-Resume] ❌ Failed to get all snapshots:', error);
    return [];
  }
}

/**
 * Delete old restored snapshots (cleanup)
 *
 * @param daysOld - Delete snapshots older than X days
 */
export async function cleanupOldSnapshots(daysOld: number = 7): Promise<void> {
  try {
    const sql = `
      DELETE FROM interrupt_snapshot
      WHERE restored = 1
        AND datetime(created_at, '+${daysOld} days') < datetime('now')
    `;

    await callMemoryGateway('/v1/db/query', 'POST', { sql });
    console.log(`[Auto-Resume] 🧹 Cleaned up snapshots older than ${daysOld} days`);
  } catch (error) {
    console.error('[Auto-Resume] ❌ Failed to cleanup snapshots:', error);
  }
}
