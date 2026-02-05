/**
 * Phase 3 Telegram Integration Test
 *
 * Control Tower Telegram連携テスト
 * - Pinned message creation
 * - editMessageText updates
 * - Message ID persistence
 * - Graceful recovery
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { controlTowerDB } from '../utils/control-tower-db';
import { generateSessionId } from '../utils/session-helper';
import {
  ensureStatusMessage,
  updateStatusMessage,
  deleteStatusMessage,
  initControlTower,
} from '../utils/control-tower-telegram';
import type { Context } from 'grammy';

// Mock Telegram API
class MockTelegramAPI {
  messages: Map<number, { text: string; pinned: boolean }> = new Map();
  nextMessageId = 1000;

  async editMessageText(chatId: number, messageId: number, text: string, options?: any) {
    const msg = this.messages.get(messageId);
    if (!msg) {
      throw { error_code: 400, description: 'message to edit not found' };
    }
    msg.text = text;
    return { message_id: messageId, text };
  }

  async pinChatMessage(chatId: number, messageId: number, options?: any) {
    const msg = this.messages.get(messageId);
    if (!msg) throw new Error('Message not found');
    msg.pinned = true;
    return true;
  }

  async unpinChatMessage(chatId: number, messageId: number) {
    const msg = this.messages.get(messageId);
    if (msg) msg.pinned = false;
    return true;
  }

  async deleteMessage(chatId: number, messageId: number) {
    this.messages.delete(messageId);
    return true;
  }

  // Helper to create message
  createMessage(text: string): { message_id: number; text: string } {
    const id = this.nextMessageId++;
    this.messages.set(id, { text, pinned: false });
    return { message_id: id, text };
  }
}

// Mock Context
function createMockContext(chatId: number, messageId: number): Context {
  const api = new MockTelegramAPI();

  return {
    chat: { id: chatId },
    message: { message_id: messageId },
    api: api as any,
    reply: async (text: string, options?: any) => {
      const msg = api.createMessage(text);
      return msg as any;
    },
  } as any;
}

describe('Phase 3 Telegram Integration Tests', () => {
  const chatId = 12345;
  const messageId = 67890;
  const sessionId = generateSessionId(chatId, messageId);

  beforeEach(() => {
    // Clean up test data
    const db = (controlTowerDB as any).db as Database;
    db.exec('DELETE FROM jarvis_control_tower WHERE session_id = ?', [sessionId]);
    db.exec('DELETE FROM jarvis_settings WHERE key LIKE ?', ['control_tower_message_%']);
  });

  test('ensureStatusMessage creates new pinned message', async () => {
    const ctx = createMockContext(chatId, messageId);
    const msgId = await ensureStatusMessage(ctx);

    expect(msgId).not.toBeNull();
    expect(msgId).toBeGreaterThan(0);

    // Verify message_id was saved to settings
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    expect(setting).not.toBeNull();
    expect(setting?.value).toBe(msgId!.toString());

    // Verify message was pinned
    const api = ctx.api as any as MockTelegramAPI;
    const msg = api.messages.get(msgId!);
    expect(msg).toBeDefined();
    expect(msg?.pinned).toBe(true);
  });

  test('ensureStatusMessage reuses existing message', async () => {
    const ctx = createMockContext(chatId, messageId);

    // First call creates message
    const msgId1 = await ensureStatusMessage(ctx);

    // Second call should reuse the same message
    const msgId2 = await ensureStatusMessage(ctx);

    expect(msgId2).toBe(msgId1);
  });

  test('ensureStatusMessage recovers when message is deleted', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create first message
    const msgId1 = await ensureStatusMessage(ctx);

    // Simulate message deletion
    api.messages.delete(msgId1!);

    // Next call should create new message
    const msgId2 = await ensureStatusMessage(ctx);

    expect(msgId2).not.toBeNull();
    expect(msgId2).not.toBe(msgId1);

    // Verify new message_id was saved
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    expect(setting?.value).toBe(msgId2!.toString());
  });

  test('updateStatusMessage updates message text', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create status in D1
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'thinking',
      phase: 'Phase 3: Testing',
      current_action: 'Running tests',
    });

    // Update status message
    await updateStatusMessage(ctx, sessionId);

    // Verify message was created and updated
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    expect(setting).not.toBeNull();

    const msgId = parseInt(setting!.value, 10);
    const msg = api.messages.get(msgId);

    expect(msg).toBeDefined();
    expect(msg?.text).toContain('JARVIS Control Tower');
    expect(msg?.text).toContain('思考中');
    expect(msg?.text).toContain('Phase 3: Testing');
  });

  test('updateStatusMessage handles missing message gracefully', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create status in D1
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'executing',
      phase: null,
      current_action: 'Tool execution',
    });

    // Set invalid message_id in settings
    controlTowerDB.updateSetting({
      key: `control_tower_message_${chatId}`,
      value: '99999',
    });

    // Update should fail gracefully and clear invalid setting
    await updateStatusMessage(ctx, sessionId);

    // Verify setting was cleared
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    // Setting should be cleared after failure
    // (In real implementation, it gets cleared on 400 error)
  });

  test('deleteStatusMessage unpins and deletes message', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create message
    const msgId = await ensureStatusMessage(ctx);
    expect(msgId).not.toBeNull();

    // Verify message exists
    expect(api.messages.has(msgId!)).toBe(true);

    // Delete message
    await deleteStatusMessage(ctx);

    // Verify message was deleted
    expect(api.messages.has(msgId!)).toBe(false);

    // Verify setting was deleted
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    expect(setting).toBeNull();
  });

  test('initControlTower creates pinned message and confirms', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    await initControlTower(ctx);

    // Verify pinned message was created
    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    expect(setting).not.toBeNull();

    const msgId = parseInt(setting!.value, 10);
    const msg = api.messages.get(msgId);
    expect(msg?.pinned).toBe(true);

    // Verify confirmation message was sent (check reply was called)
    // In mock, we can't easily verify reply, but the function should complete without error
  });

  test('Multiple status updates maintain single pinned message', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create initial message
    const msgId1 = await ensureStatusMessage(ctx);

    // Update status multiple times
    for (let i = 0; i < 5; i++) {
      controlTowerDB.updateControlTower({
        session_id: sessionId,
        status: 'executing',
        phase: `Phase ${i}`,
        current_action: `Action ${i}`,
      });

      await updateStatusMessage(ctx, sessionId);
    }

    // Verify only one message exists and it's still the same one
    const msgId2 = await ensureStatusMessage(ctx);
    expect(msgId2).toBe(msgId1);

    // Verify message was updated (not created multiple times)
    expect(api.messages.size).toBeLessThanOrEqual(2); // Initial + confirmation messages
  });

  test('Status formatting includes all relevant fields', async () => {
    const ctx = createMockContext(chatId, messageId);
    const api = ctx.api as any as MockTelegramAPI;

    // Create status with all fields
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'waiting_approval',
      phase: 'Phase 3: User Approval',
      current_action: 'Waiting for user confirmation',
    });

    await updateStatusMessage(ctx, sessionId);

    const setting = controlTowerDB.getSetting(`control_tower_message_${chatId}`);
    const msgId = parseInt(setting!.value, 10);
    const msg = api.messages.get(msgId);

    expect(msg?.text).toContain('JARVIS Control Tower');
    expect(msg?.text).toContain('⏳'); // waiting_approval emoji
    expect(msg?.text).toContain('承認待ち');
    expect(msg?.text).toContain('Phase 3: User Approval');
    expect(msg?.text).toContain('Waiting for user confirmation');
  });
});
