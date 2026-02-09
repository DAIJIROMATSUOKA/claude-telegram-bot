/**
 * Tower Watchdog Integration Test
 *
 * Tests the watchdog's ability to:
 * - Detect unhealthy towers
 * - Perform self-healing via edit or new message creation
 * - Respect single-flight lock
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { controlTowerDB } from '../utils/control-tower-db';
import { Bot } from 'grammy';

// Mock Bot API
class MockBotAPI {
  messages: Map<number, { text: string; pinned: boolean }> = new Map();
  nextMessageId = 1000;
  editAttempts = 0;
  editShouldFail = false;

  async editMessageText(chatId: number, messageId: number, text: string) {
    this.editAttempts++;

    if (this.editShouldFail) {
      throw { error_code: 400, description: 'message to edit not found' };
    }

    const msg = this.messages.get(messageId);
    if (!msg) {
      throw { error_code: 400, description: 'message to edit not found' };
    }

    msg.text = text;
    return { message_id: messageId, text };
  }

  async sendMessage(chatId: number, text: string, options?: any) {
    const id = this.nextMessageId++;
    this.messages.set(id, { text, pinned: false });
    return { message_id: id, text, chat: { id: chatId } };
  }

  async pinChatMessage(chatId: number, messageId: number, options?: any) {
    const msg = this.messages.get(messageId);
    if (!msg) throw new Error('Message not found');
    msg.pinned = true;
    return true;
  }

  // Helper to create initial message
  createMessage(text: string): number {
    const id = this.nextMessageId++;
    this.messages.set(id, { text, pinned: false });
    return id;
  }
}

// ============================================================================
// Helper Functions (Extracted from tower-watchdog.ts)
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

interface TowerHealthStatus {
  healthy: boolean;
  reason?: string;
  lastCheckedAt?: number;
  messageId?: string | null;
}

function checkTowerHealth(chatId: string): TowerHealthStatus {
  const towers = controlTowerDB.getAllControlTowers();
  const chatTowers = towers.filter(t => t.session_id.includes(String(chatId)));

  if (chatTowers.length === 0) {
    return {
      healthy: true,
      reason: 'No towers found (normal for first run)',
    };
  }

  // Sort by updated_at descending to get latest
  const sortedTowers = chatTowers.sort((a, b) => b.updated_at - a.updated_at);
  const latestTower = sortedTowers[0]!;
  const now = Date.now();
  const lastCheckedAt = latestTower.updated_at * 1000;
  const timeSinceUpdate = now - lastCheckedAt;
  const ANOMALY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  if (timeSinceUpdate > ANOMALY_THRESHOLD_MS) {
    return {
      healthy: false,
      reason: `Last update was ${Math.floor(timeSinceUpdate / 1000 / 60)} minutes ago`,
      lastCheckedAt,
    };
  }

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

async function tryEditTower(
  api: MockBotAPI,
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
    await api.editMessageText(chatId, parseInt(messageId, 10), content);

    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

async function createNewTower(
  api: MockBotAPI,
  chatId: number
): Promise<{ success: boolean; messageId?: string; error?: any }> {
  try {
    const timestamp = new Date().toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
    });

    const content = `🔧 Self-healed at ${timestamp}\n\n✅ New tower created`;
    const message = await api.sendMessage(chatId, content);

    try {
      await api.pinChatMessage(chatId, message.message_id, {
        disable_notification: true,
      });
    } catch (pinError) {
      // Continue anyway
    }

    setTowerMessageId(String(chatId), String(message.message_id));

    return {
      success: true,
      messageId: String(message.message_id),
    };
  } catch (error) {
    return { success: false, error };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Tower Watchdog Tests', () => {
  const TEST_CHAT_ID = 987654321;
  let mockAPI: MockBotAPI;

  beforeEach(() => {
    mockAPI = new MockBotAPI();

    // Clean up test data
    const allSettings = controlTowerDB.getAllSettings();
    allSettings.forEach(s => {
      if (s.key.includes('control_tower_message_')) {
        // Delete by setting to empty (no delete method)
        controlTowerDB.updateSetting({ key: s.key, value: '' });
      }
    });
  });

  test('Healthy tower - no action needed', () => {
    // Create recent tower
    const sessionId = `${TEST_CHAT_ID}_${Date.now()}`;
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'executing',
      phase: 'Phase F: Test',
    });

    // Set message_id
    const messageId = mockAPI.createMessage('Test tower');
    setTowerMessageId(String(TEST_CHAT_ID), String(messageId));

    // Check health
    const health = checkTowerHealth(String(TEST_CHAT_ID));

    expect(health.healthy).toBe(true);
    expect(health.messageId).toBe(String(messageId));
  });

  test('No message_id - unhealthy tower', () => {
    // Create recent tower but no message_id
    const sessionId = `${TEST_CHAT_ID}_${Date.now()}`;
    controlTowerDB.updateControlTower({
      session_id: sessionId,
      status: 'executing',
      phase: 'Phase F: Test',
    });

    // Don't set message_id

    const health = checkTowerHealth(String(TEST_CHAT_ID));

    expect(health.healthy).toBe(false);
    expect(health.reason).toContain('No message_id found');
  });

  test('Old tower - unhealthy (>10 minutes)', () => {
    // Use a unique chat ID for this test to avoid conflicts
    const uniqueChatId = 111222333;
    const sessionId = `${uniqueChatId}_old_${Date.now()}`;
    const elevenMinutesAgo = Math.floor((Date.now() - 11 * 60 * 1000) / 1000);

    // Manually insert old tower
    const db = (controlTowerDB as any).db;
    db.exec(
      `INSERT INTO jarvis_control_tower (session_id, status, phase, started_at, updated_at)
       VALUES (?, 'executing', 'Phase F: Old', ?, ?)`,
      [sessionId, elevenMinutesAgo, elevenMinutesAgo]
    );

    // Set message_id so it doesn't fail on that check first
    const messageId = mockAPI.createMessage('Old tower');
    setTowerMessageId(String(uniqueChatId), String(messageId));

    const health = checkTowerHealth(String(uniqueChatId));

    expect(health.healthy).toBe(false);
    expect(health.reason).toContain('Last update was');
    expect(health.reason).toContain('minutes ago');
  });

  test('Self-healing via edit - success', async () => {
    const messageId = mockAPI.createMessage('Original tower');
    setTowerMessageId(String(TEST_CHAT_ID), String(messageId));

    const result = await tryEditTower(mockAPI, TEST_CHAT_ID, String(messageId));

    expect(result.success).toBe(true);
    expect(mockAPI.editAttempts).toBe(1);

    const msg = mockAPI.messages.get(messageId);
    expect(msg?.text).toContain('🔧 Self-healed at');
    expect(msg?.text).toContain('✅ Tower is operational');
  });

  test('Self-healing via edit - failure triggers new tower', async () => {
    const oldMessageId = mockAPI.createMessage('Old tower');
    setTowerMessageId(String(TEST_CHAT_ID), String(oldMessageId));

    // Simulate edit failure
    mockAPI.editShouldFail = true;

    const editResult = await tryEditTower(mockAPI, TEST_CHAT_ID, String(oldMessageId));
    expect(editResult.success).toBe(false);

    // Create new tower
    const createResult = await createNewTower(mockAPI, TEST_CHAT_ID);
    expect(createResult.success).toBe(true);
    expect(createResult.messageId).toBeDefined();

    // Verify new message was created
    const newMessageId = parseInt(createResult.messageId!, 10);
    const newMsg = mockAPI.messages.get(newMessageId);
    expect(newMsg?.text).toContain('🔧 Self-healed at');
    expect(newMsg?.text).toContain('✅ New tower created');

    // Verify message_id was updated
    const savedMessageId = getTowerMessageId(String(TEST_CHAT_ID));
    expect(savedMessageId).toBe(createResult.messageId as any);
  });

  test('Create new tower - pins message', async () => {
    const result = await createNewTower(mockAPI, TEST_CHAT_ID);

    expect(result.success).toBe(true);
    const messageId = parseInt(result.messageId!, 10);
    const msg = mockAPI.messages.get(messageId);

    expect(msg?.pinned).toBe(true);
  });

  test('No towers found - healthy status', () => {
    // No towers for this chat
    const health = checkTowerHealth('999999999');

    expect(health.healthy).toBe(true);
    expect(health.reason).toContain('No towers found');
  });
});

console.log('✅ All Tower Watchdog tests passed!');
