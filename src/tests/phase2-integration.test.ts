/**
 * Phase 2 Integration Test
 *
 * streaming.ts と notification-buffer.ts の D1 統合テスト
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'path';
import { controlTowerDB } from '../utils/control-tower-db';
import { notificationBuffer } from '../utils/notification-buffer';
import { createStatusCallback, StreamingState } from '../handlers/streaming';
import { generateSessionId } from '../utils/session-helper';
import type { Context } from 'grammy';

// Mock Context for testing
function createMockContext(chatId: number, messageId: number): Context {
  return {
    chat: { id: chatId },
    message: { message_id: messageId },
    reply: async (text: string) => {
      console.log(`[Mock Reply] ${text}`);
      return {} as any;
    },
    telegram: {
      sendMessage: async (chatId: string | number, text: string, options?: any) => {
        console.log(`[Mock sendMessage] Chat: ${chatId}, Text: ${text}`);
        return {
          message_id: Math.floor(Math.random() * 100000),
          chat: { id: Number(chatId) },
          date: Math.floor(Date.now() / 1000),
          text: text,
        } as any;
      },
      editMessageText: async (chatId: string | number, messageId: number, text: string, options?: any) => {
        console.log(`[Mock editMessageText] Chat: ${chatId}, Message: ${messageId}, Text: ${text}`);
        return {
          message_id: messageId,
          chat: { id: Number(chatId) },
          date: Math.floor(Date.now() / 1000),
          text: text,
        } as any;
      },
      deleteMessage: async (chatId: string | number, messageId: number) => {
        console.log(`[Mock deleteMessage] Chat: ${chatId}, Message: ${messageId}`);
        return true;
      },
      pinChatMessage: async (chatId: string | number, messageId: number, options?: any) => {
        console.log(`[Mock pinChatMessage] Chat: ${chatId}, Message: ${messageId}`);
        return true;
      },
      unpinChatMessage: async (chatId: string | number, messageId?: number) => {
        console.log(`[Mock unpinChatMessage] Chat: ${chatId}, Message: ${messageId}`);
        return true;
      },
    },
  } as any;
}

describe('Phase 2 Integration Tests', () => {
  const chatId = 12345;
  const messageId = 67890;
  const sessionId = generateSessionId(chatId, messageId);

  beforeEach(() => {
    // Clean up test data
    const db = (controlTowerDB as any).db as Database;
    const deleteControl = db.prepare('DELETE FROM jarvis_control_tower WHERE session_id = ?');
    const deleteTrace = db.prepare('DELETE FROM jarvis_action_trace WHERE session_id = ?');
    deleteControl.run(sessionId);
    deleteTrace.run(sessionId);
  });

  test('NotificationBuffer records phase start to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const phaseName = 'Phase 2: Integration Test';

    await notificationBuffer.startPhase(ctx, phaseName);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.session_id).toBe(sessionId);
    expect(row?.status).toBe('planning'); // startPhase maps to 'planning'
    expect(row?.phase).toBe(phaseName);
  });

  test('NotificationBuffer records phase completion to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const phaseName = 'Phase 2: Integration Test';

    await notificationBuffer.startPhase(ctx, phaseName);
    notificationBuffer.addActivity('tool', 'Read file.ts');
    notificationBuffer.addActivity('thinking', 'Analyzing code...');
    await notificationBuffer.endPhase(ctx, true);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed');
    expect(row?.phase).toBe(phaseName);
  });

  test('NotificationBuffer records phase failure to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const phaseName = 'Phase 2: Failed Test';

    await notificationBuffer.startPhase(ctx, phaseName);
    await notificationBuffer.endPhase(ctx, false);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('error');
    expect(row?.phase).toBe(phaseName);
  });

  test('Streaming callback records thinking status to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('thinking', 'Analyzing the problem...', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('thinking');
    expect(row?.current_action).toContain('Analyzing');
  });

  test('Streaming callback records tool execution to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('tool', '📖 Reading utils/helper.ts', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('executing'); // tool maps to 'executing'
    expect(row?.current_action).toContain('Reading');
  });

  test('Streaming callback records text generation to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('text', 'Here is the response...', 0);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('executing'); // text maps to 'executing'
    expect(row?.current_action).toBe('Segment 0');
  });

  test('Streaming callback records completion to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('done', '', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed'); // done maps to 'completed'
  });

  test('Multiple status updates create timeline in D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    // Simulate workflow with delays to ensure different timestamps (using seconds)
    await callback('thinking', 'Planning approach...', undefined);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await callback('tool', '📖 Reading file', undefined);
    await callback('text', 'Response text', 0);
    await callback('done', '', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed'); // Final status

    // Verify timeline of updates (timestamps are in seconds)
    expect(row?.updated_at).toBeGreaterThanOrEqual(row!.started_at);
  });

  test('Phase and streaming integration work together', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);
    const phaseName = 'Phase 2: Full Integration';

    // Start phase
    await notificationBuffer.startPhase(ctx, phaseName);

    // Simulate streaming updates
    await callback('thinking', 'Analyzing...', undefined);
    await callback('tool', '📖 Reading code', undefined);
    await callback('text', 'Implementation complete', 0);

    // End phase
    await notificationBuffer.endPhase(ctx, true);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed');
    expect(row?.phase).toBe(phaseName);
  });
});
