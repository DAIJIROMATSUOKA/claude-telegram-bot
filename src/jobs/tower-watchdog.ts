/**
 * Tower Watchdog - Phase F
 *
 * Purpose: Monitor Control Tower health and perform self-healing
 * - Runs every 5 minutes (cron schedule)
 * - Checks last_checked_at_epoch_ms (異常検出: 10分以上古い)
 * - Single-flight lock to prevent concurrent execution
 * - Self-healing: Try edit → If failed, create new message + pin + update message_id
 *
 * Usage:
 *   bun run src/jobs/tower-watchdog.ts
 */

import { Bot } from 'grammy';
import { TELEGRAM_TOKEN, ALLOWED_USERS } from '../config';
import { controlTowerDB } from '../utils/control-tower-db';
import type { Context } from 'grammy';

// ============================================================================
// Constants
// ============================================================================

const WATCHDOG_LOCK_KEY = 'tower_watchdog_lock';
const WATCHDOG_LOCK_TTL_MS = 4 * 60 * 1000; // 4 minutes
const ANOMALY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const EDIT_FAILURE_THRESHOLD = 3; // 3 consecutive failures

// ============================================================================
// Single-Flight Lock (In-Memory)
// ============================================================================

interface LockState {
  acquired: boolean;
  expiresAt: number;
}

const locks = new Map<string, LockState>();

function acquireLock(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const existing = locks.get(key);

  // Check if existing lock is still valid
  if (existing && existing.expiresAt > now) {
    console.log(`[TowerWatchdog] Lock already held: ${key}`);
    return false;
  }

  // Acquire new lock
  locks.set(key, {
    acquired: true,
    expiresAt: now + ttlMs,
  });

  console.log(`[TowerWatchdog] Lock acquired: ${key}`);
  return true;
}

function releaseLock(key: string): void {
  locks.delete(key);
  console.log(`[TowerWatchdog] Lock released: ${key}`);
}

// ============================================================================
// Helper: Get Tower Message ID from Settings
// ============================================================================

function getTowerMessageId(chatId: string): string | null {
  const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
  return setting ? setting.value : null;
}

function setTowerMessageId(chatId: string, messageId: string): void {
  controlTowerDB.updateSetting({
    key: `control_tower_message_${chatId}`,
    value: messageId,
  });
}

// ============================================================================
// Helper: Check Tower Health
// ============================================================================

interface TowerHealthStatus {
  healthy: boolean;
  reason?: string;
  lastCheckedAt?: number;
  messageId?: string | null;
}

function checkTowerHealth(chatId: string): TowerHealthStatus {
  // Get all control towers for this chat
  const towers = controlTowerDB.getAllControlTowers();
  const chatTowers = towers.filter(t => t.session_id.includes(String(chatId)));

  if (chatTowers.length === 0) {
    // No towers found - create initial state
    return {
      healthy: true,
      reason: 'No towers found (normal for first run)',
    };
  }

  // Get latest tower
  const latestTower = chatTowers[0];
  const now = Date.now();
  const lastCheckedAt = latestTower!.updated_at * 1000; // Convert to ms
  const timeSinceUpdate = now - lastCheckedAt;

  // Check if last update is too old (> 10 minutes)
  if (timeSinceUpdate > ANOMALY_THRESHOLD_MS) {
    return {
      healthy: false,
      reason: `Last update was ${Math.floor(timeSinceUpdate / 1000 / 60)} minutes ago`,
      lastCheckedAt,
    };
  }

  // Check message_id
  const messageId = getTowerMessageId(String(chatId));
  if (!messageId) {
    return {
      healthy: false,
      reason: 'No message_id found in settings',
      messageId: null,
    };
  }

  return {
    healthy: true,
    lastCheckedAt,
    messageId,
  };
}

// ============================================================================
// Self-Healing: Try Edit Tower
// ============================================================================

async function tryEditTower(
  bot: Bot,
  chatId: number,
  messageId: string
): Promise<{ success: boolean; error?: any }> {
  try {
    const timestamp = new Date().toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
    });

    const content = `🔧 Self-healed at ${timestamp}\n\n✅ Tower is operational`;

    await bot.api.editMessageText(chatId, parseInt(messageId, 10), content);

    console.log(`[TowerWatchdog] Tower edit successful: chat=${chatId}, msg=${messageId}`);
    return { success: true };
  } catch (error) {
    console.error(`[TowerWatchdog] Tower edit failed:`, error);
    return { success: false, error };
  }
}

// ============================================================================
// Self-Healing: Create New Tower
// ============================================================================

async function createNewTower(
  bot: Bot,
  chatId: number
): Promise<{ success: boolean; messageId?: string; error?: any }> {
  try {
    const timestamp = new Date().toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
    });

    const content = `🔧 Self-healed at ${timestamp}\n\n✅ New tower created`;

    // Send new message (no pin — pin disabled)
    const message = await bot.api.sendMessage(chatId, content);

    console.log(`[TowerWatchdog] New tower message created: ${message.message_id}`);

    // Update message_id in settings
    setTowerMessageId(String(chatId), String(message.message_id));

    return {
      success: true,
      messageId: String(message.message_id),
    };
  } catch (error) {
    console.error(`[TowerWatchdog] Create new tower failed:`, error);
    return { success: false, error };
  }
}

// ============================================================================
// Self-Healing Flow
// ============================================================================

async function performSelfHealing(
  bot: Bot,
  chatId: number,
  health: TowerHealthStatus
): Promise<void> {
  console.log(`[TowerWatchdog] Starting self-healing for chat ${chatId}`);
  console.log(`[TowerWatchdog] Reason: ${health.reason}`);

  // Try to edit existing tower first
  const messageId = getTowerMessageId(String(chatId));

  if (messageId) {
    console.log(`[TowerWatchdog] Attempting to edit existing tower: ${messageId}`);
    const editResult = await tryEditTower(bot, chatId, messageId);

    if (editResult.success) {
      console.log(`[TowerWatchdog] ✅ Self-healing completed via edit`);
      return;
    }

    console.log(`[TowerWatchdog] Edit failed, creating new tower...`);
  } else {
    console.log(`[TowerWatchdog] No message_id found, creating new tower...`);
  }

  // Create new tower
  const createResult = await createNewTower(bot, chatId);

  if (createResult.success) {
    console.log(`[TowerWatchdog] ✅ Self-healing completed via new tower: ${createResult.messageId}`);
  } else {
    console.error(`[TowerWatchdog] ❌ Self-healing failed completely`);
  }
}

// ============================================================================
// Main Watchdog Function
// ============================================================================

async function runWatchdog() {
  console.log('='.repeat(50));
  console.log('Tower Watchdog - Phase F');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  // Acquire lock
  if (!acquireLock(WATCHDOG_LOCK_KEY, WATCHDOG_LOCK_TTL_MS)) {
    console.log('[TowerWatchdog] Skipping - lock already held');
    return;
  }

  try {
    if (!TELEGRAM_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    if (ALLOWED_USERS.length === 0) {
      throw new Error('TELEGRAM_ALLOWED_USERS is not set');
    }

    const chatId = ALLOWED_USERS[0]; // Primary user
    const bot = new Bot(TELEGRAM_TOKEN);

    console.log(`[TowerWatchdog] Checking tower health for chat: ${chatId}`);

    // Check tower health
    const health = checkTowerHealth(String(chatId));

    if (health.healthy) {
      console.log('[TowerWatchdog] ✅ Tower is healthy');
      if (health.lastCheckedAt) {
        const minutesAgo = Math.floor((Date.now() - health.lastCheckedAt) / 1000 / 60);
        console.log(`[TowerWatchdog] Last update: ${minutesAgo} minutes ago`);
      }
    } else {
      console.warn(`[TowerWatchdog] ⚠️ Tower is unhealthy: ${health.reason}`);
      await performSelfHealing(bot, chatId!, health);
    }

    console.log('[TowerWatchdog] ✅ Watchdog completed successfully');
  } catch (error) {
    console.error('[TowerWatchdog] ❌ Error:', error);
    throw error;
  } finally {
    // Always release lock
    releaseLock(WATCHDOG_LOCK_KEY);
  }

  console.log('='.repeat(50));
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log('='.repeat(50));
}

// ============================================================================
// Entry Point
// ============================================================================

runWatchdog()
  .then(() => {
    console.log('[TowerWatchdog] Exiting successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[TowerWatchdog] Fatal error:', error);
    process.exit(1);
  });
