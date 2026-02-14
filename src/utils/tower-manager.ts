/**
 * Tower Manager v1.0
 * Purpose: Manage Control Tower pinned message updates
 * Philosophy: "Safe, transparent, self-healing"
 */

import type { Context } from 'grammy';
import {
  renderTower,
  computeRenderHash,
  type TowerState,
} from './tower-renderer.js';
import type {
  TowerIdentifier,
  TowerUpdateResult,
  TowerEditError,
  EditErrorType,
} from '../types/control-tower.js';

// ============================================================================
// Constants
// ============================================================================

const LOCK_TIMEOUT_MS = 5000; // 5 seconds single-flight lock
const MIN_UPDATE_INTERVAL_MS = 3000; // 3 seconds between updates (from settings)
const RECOVERY_MESSAGE_PREFIX = '🔧 [RECOVERED]';

// ============================================================================
// In-Memory State
// ============================================================================

interface CachedTowerState {
  messageId: string | null;
  lastRenderHash: string | null;
  lastUpdateTime: number;
  revision: number;
  status: 'active' | 'suspended' | 'permission_error';
}

const towerCache = new Map<string, CachedTowerState>();
const updateLocks = new Map<string, number>(); // chatId -> expiresAt

// ============================================================================
// Helper: Tower Cache Key
// ============================================================================

function getTowerKey(identifier: TowerIdentifier): string {
  return `${identifier.tenantId}:${identifier.userId}:${identifier.chatId}`;
}

// ============================================================================
// Helper: Single-Flight Lock
// ============================================================================

function acquireLock(chatId: string): boolean {
  const now = Date.now();
  const existingLock = updateLocks.get(chatId);

  if (existingLock && existingLock > now) {
    return false; // Lock already held
  }

  // Acquire lock
  updateLocks.set(chatId, now + LOCK_TIMEOUT_MS);
  return true;
}

function releaseLock(chatId: string): void {
  updateLocks.delete(chatId);
}

// ============================================================================
// Helper: Classify Telegram Edit Errors
// ============================================================================

function classifyEditError(error: any): TowerEditError {
  const message = error.message || String(error);
  const description = error.description || '';

  // "message is not modified"
  if (
    message.includes('not modified') ||
    description.includes('not modified')
  ) {
    return {
      code: 'not_modified',
      message: 'Content unchanged',
      retryable: false,
    };
  }

  // "message to edit not found" or "MESSAGE_ID_INVALID"
  if (
    message.includes('not found') ||
    message.includes('MESSAGE_ID_INVALID') ||
    description.includes('not found')
  ) {
    return {
      code: 'not_found',
      message: 'Message deleted or invalid',
      retryable: false,
    };
  }

  // 429 - Rate limit
  if (message.includes('429') || description.includes('Too Many Requests')) {
    const retryAfterMatch = description.match(/retry after (\d+)/i);
    const retryAfter = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : 30;

    return {
      code: 'rate_limit',
      message: 'Rate limited by Telegram',
      retryable: true,
      retryAfter,
    };
  }

  // 403 - Forbidden
  if (message.includes('403') || description.includes('Forbidden')) {
    return {
      code: 'forbidden',
      message: 'No permission to edit message',
      retryable: false,
    };
  }

  // 401 - Unauthorized
  if (message.includes('401') || description.includes('Unauthorized')) {
    return {
      code: 'unauthorized',
      message: 'Bot token invalid',
      retryable: false,
    };
  }

  // Unknown error
  return {
    code: 'unknown',
    message: message.substring(0, 200),
    retryable: false,
  };
}

// ============================================================================
// Main: Update Tower
// ============================================================================

export async function updateTower(
  ctx: Context,
  identifier: TowerIdentifier,
  state: TowerState
): Promise<TowerUpdateResult> {
  const { chatId } = identifier;
  const key = getTowerKey(identifier);

  // 1. Acquire single-flight lock
  if (!acquireLock(chatId)) {
    console.log(`[TowerManager] Update skipped - lock held: ${chatId}`);
    return {
      success: true,
      action: 'skipped',
    };
  }

  try {
    // 2. Get cached state
    const cached = towerCache.get(key) || {
      messageId: null,
      lastRenderHash: null,
      lastUpdateTime: 0,
      revision: 0,
      status: 'active' as const,
    };

    // 3. Check if suspended
    if (cached.status === 'suspended' || cached.status === 'permission_error') {
      console.log(`[TowerManager] Tower suspended: ${cached.status}`);
      return {
        success: false,
        action: 'failed',
        errorCode: cached.status,
        errorMessage: 'Tower is suspended',
      };
    }

    // 4. Render new content
    const rendered = renderTower(state);
    const newHash = computeRenderHash(state);

    // 5. Check if content changed (skip if same)
    if (newHash === cached.lastRenderHash && cached.messageId) {
      console.log(`[TowerManager] Content unchanged - skipping update`);
      return {
        success: true,
        action: 'skipped',
        messageId: cached.messageId,
      };
    }

    // 6. Check min update interval (only for edits, not creates)
    const now = Date.now();
    const timeSinceLastUpdate = now - cached.lastUpdateTime;
    if (
      cached.messageId && // Only rate-limit if message exists (not first creation)
      cached.lastUpdateTime > 0 &&
      timeSinceLastUpdate < MIN_UPDATE_INTERVAL_MS
    ) {
      console.log(
        `[TowerManager] Rate limit - ${MIN_UPDATE_INTERVAL_MS - timeSinceLastUpdate}ms remaining`
      );
      return {
        success: true,
        action: 'skipped',
        messageId: cached.messageId,
      };
    }

    // 7. Update or create message
    let result: TowerUpdateResult;

    if (cached.messageId) {
      // Try to edit existing message
      result = await editTowerMessage(ctx, cached.messageId, rendered, cached);
    } else {
      // Create new pinned message
      result = await createTowerMessage(ctx, chatId, rendered, null);
    }

    // 8. Update cache on success
    if (result.success && result.messageId) {
      towerCache.set(key, {
        messageId: result.messageId,
        lastRenderHash: newHash,
        lastUpdateTime: Date.now(),
        revision: cached.revision + 1,
        status: cached.status,
      });
    }

    // 9. Update cache status on permission error
    if (result.errorCode === 'forbidden' || result.errorCode === 'unauthorized') {
      towerCache.set(key, {
        ...cached,
        status: 'permission_error',
      });
    }

    return result;
  } finally {
    // Always release lock
    releaseLock(chatId);
  }
}

// ============================================================================
// Helper: Edit Existing Message
// ============================================================================

async function editTowerMessage(
  ctx: Context,
  messageId: string,
  content: string,
  cached: CachedTowerState
): Promise<TowerUpdateResult> {
  try {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      parseInt(messageId, 10),
      content,
      { parse_mode: undefined } // Plain text only
    );

    console.log(`[TowerManager] Message edited: ${messageId}`);
    return {
      success: true,
      action: 'updated',
      messageId,
    };
  } catch (error: any) {
    const editError = classifyEditError(error);
    console.error(`[TowerManager] Edit failed:`, editError);

    // Handle specific error types
    if (editError.code === 'not_modified') {
      // Content unchanged - treat as success
      return {
        success: true,
        action: 'skipped',
        messageId,
      };
    }

    if (editError.code === 'not_found') {
      // Message deleted - recover by creating new one
      console.log(`[TowerManager] Message not found - recovering...`);
      return await recoverTower(ctx, content, messageId);
    }

    if (editError.code === 'rate_limit') {
      // Rate limited - retry after delay
      if (editError.retryAfter) {
        console.log(
          `[TowerManager] Rate limited - retry after ${editError.retryAfter}s`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, editError.retryAfter! * 1000)
        );
        // Retry once
        try {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            parseInt(messageId, 10),
            content,
            { parse_mode: undefined }
          );
          return {
            success: true,
            action: 'updated',
            messageId,
          };
        } catch (retryError) {
          // Give up after retry
          return {
            success: false,
            action: 'failed',
            errorCode: 'rate_limit_retry_failed',
            errorMessage: 'Rate limit persisted after retry',
          };
        }
      }
    }

    if (editError.code === 'forbidden' || editError.code === 'unauthorized') {
      // Permission error - suspend tower (status updated by caller)
      console.error(`[TowerManager] Permission error - suspending tower`);
      return {
        success: false,
        action: 'failed',
        errorCode: editError.code,
        errorMessage: editError.message,
      };
    }

    // Unknown error - fail
    return {
      success: false,
      action: 'failed',
      errorCode: editError.code,
      errorMessage: editError.message,
    };
  }
}

// ============================================================================
// Helper: Create New Message
// ============================================================================

async function createTowerMessage(
  ctx: Context,
  chatId: string,
  content: string,
  oldMessageId: string | null
): Promise<TowerUpdateResult> {
  try {
    const message = await ctx.api.sendMessage(chatId, content, {
      parse_mode: undefined,
    });

    console.log(`[TowerManager] Message created: ${message.message_id}`);

    return {
      success: true,
      action: 'created',
      messageId: String(message.message_id),
    };
  } catch (error: any) {
    console.error(`[TowerManager] Create failed:`, error);
    return {
      success: false,
      action: 'failed',
      errorCode: 'create_failed',
      errorMessage: error.message || String(error),
    };
  }
}

// ============================================================================
// Helper: Recover Tower (Self-Healing)
// ============================================================================

async function recoverTower(
  ctx: Context,
  content: string,
  oldMessageId: string | null = null
): Promise<TowerUpdateResult> {
  const now = new Date().toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });

  const recoveryContent = `${RECOVERY_MESSAGE_PREFIX}\nRecovered at ${now}\n\n${content}`;

  const result = await createTowerMessage(
    ctx,
    String(ctx.chat!.id),
    recoveryContent,
    oldMessageId
  );

  if (result.success) {
    return {
      ...result,
      action: 'recovered',
    };
  }

  return result;
}

// ============================================================================
// Helper: Get Tower Status
// ============================================================================

export function getTowerStatus(identifier: TowerIdentifier): CachedTowerState | null {
  const key = getTowerKey(identifier);
  return towerCache.get(key) || null;
}

// ============================================================================
// Helper: Clear Tower Cache
// ============================================================================

export function clearTowerCache(identifier: TowerIdentifier): void {
  const key = getTowerKey(identifier);
  towerCache.delete(key);
  console.log(`[TowerManager] Cache cleared: ${key}`);
}
