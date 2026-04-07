/**
 * Focus Mode Manager
 *
 * /focus on → 通知を抑制してバッファに溜める
 * /focus off → バッファの通知を一括表示
 *
 * Focus中はControl Tower更新のみ行い、通常メッセージ通知は送らない
 */

import { createLogger } from "./logger";
const log = createLogger("focus-mode");

import { callMemoryGateway } from '../handlers/ai-router';
import { getJarvisContext, updateJarvisContext } from './jarvis-context';
import type { Context } from 'grammy';

export interface FocusNotification {
  id: number;
  user_id: string;
  notification_type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  created_at: string;
  delivered: number;
}

/**
 * Check if user is in focus mode
 */
export async function isFocusModeEnabled(userId: string | number): Promise<boolean> {
  const context = await getJarvisContext(userId);
  return context?.focus_mode === 1;
}

/**
 * Enable focus mode
 */
export async function enableFocusMode(userId: string | number): Promise<void> {
  await updateJarvisContext(userId, { focus_mode: 1 });
  log.info(`[Focus Mode] Enabled for user ${userId}`);
}

/**
 * Disable focus mode
 */
export async function disableFocusMode(userId: string | number): Promise<void> {
  await updateJarvisContext(userId, { focus_mode: 0 });
  log.info(`[Focus Mode] Disabled for user ${userId}`);
}

/**
 * Buffer a notification (when focus mode is enabled)
 */
export async function bufferNotification(
  userId: string | number,
  notificationType: 'info' | 'warning' | 'error' | 'success',
  message: string
): Promise<void> {
  try {
    const userIdStr = String(userId);

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `INSERT INTO focus_mode_buffer (user_id, notification_type, message)
            VALUES (?, ?, ?)`,
      params: [userIdStr, notificationType, message],
    });

    log.info(`[Focus Mode] Buffered ${notificationType}: ${message.substring(0, 50)}...`);
  } catch (error) {
    log.error('[Focus Mode] Buffer error:', error);
  }
}

/**
 * Get all buffered notifications for user
 */
export async function getBufferedNotifications(userId: string | number): Promise<FocusNotification[]> {
  try {
    const userIdStr = String(userId);

    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, user_id, notification_type, message, created_at, delivered
            FROM focus_mode_buffer
            WHERE user_id = ? AND delivered = 0
            ORDER BY created_at ASC`,
      params: [userIdStr],
    });

    if (response.error || !response.data?.results) {
      return [];
    }

    return response.data.results as FocusNotification[];
  } catch (error) {
    log.error('[Focus Mode] Get buffer error:', error);
    return [];
  }
}

/**
 * Mark all buffered notifications as delivered
 */
export async function markNotificationsDelivered(userId: string | number): Promise<void> {
  try {
    const userIdStr = String(userId);

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `UPDATE focus_mode_buffer
            SET delivered = 1
            WHERE user_id = ? AND delivered = 0`,
      params: [userIdStr],
    });

    log.info(`[Focus Mode] Marked all notifications as delivered for user ${userId}`);
  } catch (error) {
    log.error('[Focus Mode] Mark delivered error:', error);
  }
}

/**
 * Deliver all buffered notifications to user
 */
export async function deliverBufferedNotifications(ctx: Context, userId: string | number): Promise<void> {
  try {
    const notifications = await getBufferedNotifications(userId);

    if (notifications.length === 0) {
      await ctx.reply('📭 バッファされた通知はありません');
      return;
    }

    // Group notifications by type
    const grouped: Record<string, string[]> = {
      info: [],
      warning: [],
      error: [],
      success: [],
    };

    for (const notif of notifications) {
      grouped[notif.notification_type]!.push(notif.message);
    }

    // Format and send
    let message = `📬 **Focus Mode バッファ** (${notifications.length}件)\n\n`;

    if (grouped.success!.length > 0) {
      message += `✅ **成功** (${grouped.success!.length}件)\n`;
      for (const msg of grouped.success!.slice(0, 5)) {
        message += `  • ${msg}\n`;
      }
      if (grouped.success!.length > 5) {
        message += `  ... 他${grouped.success!.length - 5}件\n`;
      }
      message += '\n';
    }

    if (grouped.info!.length > 0) {
      message += `ℹ️ **情報** (${grouped.info!.length}件)\n`;
      for (const msg of grouped.info!.slice(0, 5)) {
        message += `  • ${msg}\n`;
      }
      if (grouped.info!.length > 5) {
        message += `  ... 他${grouped.info!.length - 5}件\n`;
      }
      message += '\n';
    }

    if (grouped.warning!.length > 0) {
      message += `⚠️ **警告** (${grouped.warning!.length}件)\n`;
      for (const msg of grouped.warning!.slice(0, 5)) {
        message += `  • ${msg}\n`;
      }
      if (grouped.warning!.length > 5) {
        message += `  ... 他${grouped.warning!.length - 5}件\n`;
      }
      message += '\n';
    }

    if (grouped.error!.length > 0) {
      message += `❌ **エラー** (${grouped.error!.length}件)\n`;
      for (const msg of grouped.error!) {
        message += `  • ${msg}\n`;
      }
      message += '\n';
    }

    await ctx.reply(message);
    await markNotificationsDelivered(userId);
  } catch (error) {
    log.error('[Focus Mode] Deliver error:', error);
    await ctx.reply('⚠️ バッファ通知の配信に失敗しました');
  }
}
