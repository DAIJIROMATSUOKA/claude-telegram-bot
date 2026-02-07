/**
 * Control Tower Helper - Integration layer for Tower Manager
 * Purpose: Bridge between notification system and tower manager
 * Phase D: Notification Budget
 */

import type { Context } from 'grammy';
import { updateTower, getTowerStatus } from './tower-manager.js';
import type { TowerState } from './tower-renderer.js';
import type { TowerIdentifier } from '../types/control-tower.js';
import { controlTowerDB } from './control-tower-db.js';

// Status mapping for D1 database
const STATUS_MAPPING: Record<string, string> = {
  // streaming.ts statuses
  thinking: 'thinking',
  tool: 'executing',
  text: 'executing',
  segment_end: 'executing',
  done: 'completed',

  // NotificationBuffer statuses
  error: 'error',
  completed: 'completed',

  // Autopilot statuses
  approval: 'waiting_approval',
  planning: 'planning',

  // Initial state
  idle: 'idle',
};

// ============================================================================
// Helper: Create Tower Identifier from Context
// ============================================================================

function createTowerIdentifier(ctx: Context): TowerIdentifier {
  const chatId = String(ctx.chat?.id || '0');
  const userId = String(ctx.from?.id || '0');

  // For Telegram bot, tenant is the bot itself (single-tenant for now)
  const tenantId = 'telegram-bot';

  return {
    tenantId,
    userId,
    chatId,
  };
}

// ============================================================================
// Phase Management
// ============================================================================

/**
 * Start a new phase - update tower with phase start notification
 */
export async function startPhase(
  sessionId: string,
  phaseName: string,
  ctx: Context
): Promise<void> {
  const identifier = createTowerIdentifier(ctx);

  const state: TowerState = {
    status: 'running',
    taskTitle: phaseName,
    startedAt: Date.now(),
  };

  await updateTower(ctx, identifier, state);

  // Write to D1 database
  try {
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'planning', // startPhase maps to 'planning'
      phase: phaseName,
      current_action: null,
    });
  } catch (error) {
    console.error('[ControlTowerHelper] Failed to write to D1:', error);
  }

  console.log(`[ControlTowerHelper] Phase started: ${phaseName}`);
}

/**
 * Complete current phase - update tower with completion status
 */
export async function completePhase(
  sessionId: string,
  phaseName: string,
  success: boolean,
  ctx: Context
): Promise<void> {
  const identifier = createTowerIdentifier(ctx);

  const state: TowerState = {
    status: success ? 'completed' : 'error',
    taskTitle: phaseName,
    startedAt: Date.now() - 1000, // Assume 1s ago for demo
  };

  await updateTower(ctx, identifier, state);

  // Write to D1 database
  try {
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: success ? 'completed' : 'error',
      phase: phaseName,
      current_action: null,
    });
  } catch (error) {
    console.error('[ControlTowerHelper] Failed to write to D1:', error);
  }

  console.log(`[ControlTowerHelper] Phase completed: ${phaseName} (${success ? 'success' : 'error'})`);
}

/**
 * Update status during phase execution - update tower with intermediate state
 */
export async function updateStatus(
  sessionId: string,
  statusType: string,
  toolName: string | null,
  detail: string | null,
  ctx: Context
): Promise<void> {
  const identifier = createTowerIdentifier(ctx);

  // Get current tower state
  const cached = getTowerStatus(identifier);

  const state: TowerState = {
    status: statusType === 'done' ? 'completed' : 'running',
    currentStep: detail || undefined,
  };

  await updateTower(ctx, identifier, state);

  // Write to D1 database
  try {
    const mappedStatus = STATUS_MAPPING[statusType] || 'executing';
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: mappedStatus,
      current_action: detail,
    });
  } catch (error) {
    console.error('[ControlTowerHelper] Failed to write to D1:', error);
  }

  console.log(`[ControlTowerHelper] Status updated: ${statusType} - ${detail}`);
}

// ============================================================================
// Notification Helpers (Phase D)
// ============================================================================

/**
 * Send start notification — 無効化（完了時のみ通知する仕様）
 * DB記録のみ行い、Telegram通知は送らない
 */
export async function sendStartNotification(
  ctx: Context,
  taskTitle: string
): Promise<void> {
  // 開始通知は送らない（完了時のみ通知する仕様）
  console.log(`[ControlTowerHelper] Start logged (no notification): ${taskTitle}`);
}

/**
 * Send end notification (loud - disable_notification: false)
 * Includes work summary and optional trace_id
 */
export async function sendEndNotification(
  ctx: Context,
  taskTitle: string,
  success: boolean,
  traceId?: string,
  workSummary?: string
): Promise<void> {
  const status = success ? '✅ 完了' : '❌ エラー';
  let message = `${status}: ${taskTitle}`;

  if (workSummary) {
    message += `\n\n📋 やったこと:\n${workSummary}`;
  }

  if (traceId) {
    message += `\n\n🔍 Trace ID: ${traceId}`;
  }

  await ctx.reply(`━━━━━━━━━━━━━━━\n${message}\n━━━━━━━━━━━━━━━`, {
    disable_notification: false, // Loud
  });
  console.log(`[ControlTowerHelper] End notification sent (loud): ${taskTitle} [${traceId || 'no-trace'}]`);
}
