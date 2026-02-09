/**
 * Session Helper - Session ID generation and management
 *
 * Session IDはchat_idとmessage_idから生成
 */

import type { Context } from 'grammy';
import type { SessionInfo } from '../types/control-tower';

/**
 * Session ID生成
 *
 * Format: `chat_{chat_id}_msg_{message_id}`
 */
export function generateSessionId(chatId: number, messageId: number): string {
  return `chat_${chatId}_msg_${messageId}`;
}

/**
 * ContextからSession ID生成
 */
export function getSessionIdFromContext(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!chatId || !messageId) {
    console.warn('[SessionHelper] Missing chat_id or message_id', { chatId, messageId });
    return null;
  }

  return generateSessionId(chatId, messageId);
}

/**
 * ContextからSessionInfo取得
 */
export function getSessionInfo(ctx: Context): SessionInfo | null {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!chatId || !messageId) {
    return null;
  }

  return {
    session_id: generateSessionId(chatId, messageId),
    chat_id: chatId,
    message_id: messageId,
  };
}

/**
 * Session IDをパース
 *
 * Format: `chat_{chat_id}_msg_{message_id}`
 * Returns: { chat_id, message_id } | null
 */
export function parseSessionId(sessionId: string): { chat_id: number; message_id: number } | null {
  const match = sessionId.match(/^chat_(\d+)_msg_(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    chat_id: parseInt(match[1]!, 10),
    message_id: parseInt(match[2]!, 10),
  };
}
