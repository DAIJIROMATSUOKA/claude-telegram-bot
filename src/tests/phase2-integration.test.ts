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

// Mock Context for testing — needs ctx.api (used by tower-manager) and ctx.reply
function createMockContext(chatId: number, messageId: number): Context {
  return {
    chat: { id: chatId },
    from: { id: chatId },
    message: { message_id: messageId },
    reply: async (text: string, options?: any) => {
      console.log(`[Mock Reply] ${text.substring(0, 60)}`);
      return {
        message_id: Math.floor(Math.random() * 100000),
        chat: { id: chatId },
        date: Math.floor(Date.now() / 1000),
        text,
      } as any;
    },
    api: {
      sendMessage: async (chat: string | number, text: string, options?: any) => {
        console.log(`[Mock sendMessage] Chat: ${chat}`);
        return {
          message_id: Math.floor(Math.random() * 100000),
          chat: { id: Number(chat) },
          date: Math.floor(Date.now() / 1000),
          text,
        } as any;
      },
      editMessageText: async (chat: string | number, msgId: number, text: string, options?: any) => {
        return { message_id: msgId, chat: { id: Number(chat) }, text } as any;
      },
      deleteMessage: async (chat: string | number, msgId: number) => true,
      pinChatMessage: async (chat: string | number, msgId: number, options?: any) => true,
      unpinChatMessage: async (chat: string | number, msgId?: number) => true,
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

    // Reset notification buffer state
    (notificationBuffer as any).currentPhase = null;
    (notificationBuffer as any).activities = [];
    (notificationBuffer as any).textResponses = [];
    (notificationBuffer as any).phaseStartTime = 0;
    (notificationBuffer as any).traceId = null;
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
    expect(row?.status).toBe('executing');
    expect(row?.current_action).toContain('Reading');
  });

  test('Streaming callback records text generation to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('text', 'Here is the response...', 0);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('executing');
    expect(row?.current_action).toBe('Segment 0');
  });

  test('Streaming callback records completion to D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('done', '', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed');
  });

  test('Multiple status updates create timeline in D1', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);

    await callback('thinking', 'Planning approach...', undefined);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await callback('tool', '📖 Reading file', undefined);
    await callback('text', 'Response text', 0);
    await callback('done', '', undefined);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed');
    expect(row?.updated_at).toBeGreaterThanOrEqual(row!.started_at);
  });

  test('Phase and streaming integration work together', async () => {
    const ctx = createMockContext(chatId, messageId);
    const state = new StreamingState();
    const callback = createStatusCallback(ctx, state);
    const phaseName = 'Phase 2: Full Integration';

    await notificationBuffer.startPhase(ctx, phaseName);

    await callback('thinking', 'Analyzing...', undefined);
    await callback('tool', '📖 Reading code', undefined);
    await callback('text', 'Implementation complete', 0);

    await notificationBuffer.endPhase(ctx, true);

    const row = controlTowerDB.getControlTower(sessionId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('completed');
    expect(row?.phase).toBe(phaseName);
  });
});
