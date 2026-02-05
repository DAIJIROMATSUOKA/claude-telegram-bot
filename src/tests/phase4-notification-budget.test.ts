/**
 * Phase 4 Notification Budget Test
 *
 * 通知スパム防止テスト - 最大2通ルール
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { notificationBuffer } from '../utils/notification-buffer';
import type { Context } from 'grammy';

// Mock Context
function createMockContext(): {
  ctx: Context;
  notifications: string[];
} {
  const notifications: string[] = [];

  const ctx = {
    chat: { id: 12345 },
    message: { message_id: 67890 },
    reply: async (text: string, options?: any) => {
      notifications.push(text);
      console.log(`[Mock Reply ${notifications.length}] ${text.substring(0, 50)}...`);
      return {} as any;
    },
  } as any;

  return { ctx, notifications };
}

describe('Phase 4 Notification Budget Tests', () => {
  beforeEach(() => {
    // Reset notification buffer state
    (notificationBuffer as any).currentPhase = null;
    (notificationBuffer as any).activities = [];
    (notificationBuffer as any).textResponses = [];
    (notificationBuffer as any).phaseStartTime = 0;
  });

  test('Phase start + end = exactly 2 notifications', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, '実装開始');
    expect(notifications.length).toBe(1);
    expect(notifications[0]).toContain('🔄 実装開始');

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);
    expect(notifications[1]).toContain('✅');
  });

  test('Activities are buffered, not sent', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Phase 4 Test');
    expect(notifications.length).toBe(1);

    // Add multiple activities
    notificationBuffer.addActivity('tool', 'Read file.ts');
    notificationBuffer.addActivity('tool', 'Edit file.ts');
    notificationBuffer.addActivity('thinking', 'Analyzing code');
    notificationBuffer.addActivity('text', 'Response segment 1');

    // Still only 1 notification
    expect(notifications.length).toBe(1);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Summary should include activity counts
    expect(notifications[1]).toContain('ツール実行: 2回');
    expect(notifications[1]).toContain('思考: 1回');
  });

  test('Text responses are buffered and sent in phase completion', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Implementation');
    expect(notifications.length).toBe(1);

    // Add text responses
    notificationBuffer.addTextResponse('First response paragraph.');
    notificationBuffer.addTextResponse('Second response paragraph.');
    notificationBuffer.addTextResponse('Third response paragraph.');

    // Still only 1 notification
    expect(notifications.length).toBe(1);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Text should be in the final notification
    expect(notifications[1]).toContain('First response paragraph');
    expect(notifications[1]).toContain('Second response paragraph');
    expect(notifications[1]).toContain('Third response paragraph');
  });

  test('Error phase = exactly 2 notifications', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Error Test');
    expect(notifications.length).toBe(1);

    notificationBuffer.addActivity('error', 'Failed to read file');
    notificationBuffer.addActivity('error', 'Network timeout');

    await notificationBuffer.endPhase(ctx, false);
    expect(notifications.length).toBe(2);

    expect(notifications[1]).toContain('❌');
    expect(notifications[1]).toContain('エラー: 2回');
  });

  test('Multiple phases in sequence = 2 notifications per phase', async () => {
    const { ctx, notifications } = createMockContext();

    // Phase 1
    await notificationBuffer.startPhase(ctx, 'Phase 1');
    notificationBuffer.addActivity('tool', 'Action 1');
    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Phase 2
    await notificationBuffer.startPhase(ctx, 'Phase 2');
    notificationBuffer.addActivity('tool', 'Action 2');
    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(4);

    // Each phase has exactly 2 notifications
    expect(notifications[0]).toContain('Phase 1');
    expect(notifications[1]).toContain('✅');
    expect(notifications[2]).toContain('Phase 2');
    expect(notifications[3]).toContain('✅');
  });

  test('isActive() returns correct state', () => {
    expect(notificationBuffer.isActive()).toBe(false);

    const { ctx } = createMockContext();
    notificationBuffer.startPhase(ctx, 'Test Phase');
    expect(notificationBuffer.isActive()).toBe(true);

    notificationBuffer.endPhase(ctx, true);
    // After async endPhase, it will be false (but we can't await here in sync test)
  });

  test('Duplicate phase start is prevented', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Same Phase');
    expect(notifications.length).toBe(1);

    // Try to start same phase again
    await notificationBuffer.startPhase(ctx, 'Same Phase');
    expect(notifications.length).toBe(1); // Still 1, duplicate prevented

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);
  });

  test('Empty phase = exactly 2 notifications', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Empty Phase');
    expect(notifications.length).toBe(1);

    // No activities added

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Summary should show 0 activities
    expect(notifications[1]).toContain('✅');
  });

  test('Text responses with activities = single combined notification', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Combined Test');
    expect(notifications.length).toBe(1);

    // Mix of activities and text
    notificationBuffer.addActivity('thinking', 'Planning');
    notificationBuffer.addTextResponse('Here is my response.');
    notificationBuffer.addActivity('tool', 'Read file');
    notificationBuffer.addTextResponse('Another paragraph.');
    notificationBuffer.addActivity('tool', 'Write file');

    // Still only 1 notification
    expect(notifications.length).toBe(1);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Final notification contains both text and summary
    expect(notifications[1]).toContain('Here is my response');
    expect(notifications[1]).toContain('Another paragraph');
    expect(notifications[1]).toContain('ツール実行: 2回');
  });

  test('getCurrentPhase() returns correct phase name', () => {
    expect(notificationBuffer.getCurrentPhase()).toBeNull();

    const { ctx } = createMockContext();
    notificationBuffer.startPhase(ctx, 'Test Phase Name');
    expect(notificationBuffer.getCurrentPhase()).toBe('Test Phase Name');
  });

  test('getActivityCount() returns correct count', () => {
    expect(notificationBuffer.getActivityCount()).toBe(0);

    const { ctx } = createMockContext();
    notificationBuffer.startPhase(ctx, 'Count Test');

    notificationBuffer.addActivity('tool', 'Action 1');
    expect(notificationBuffer.getActivityCount()).toBe(1);

    notificationBuffer.addActivity('thinking', 'Thought 1');
    expect(notificationBuffer.getActivityCount()).toBe(2);

    notificationBuffer.addActivity('tool', 'Action 2');
    expect(notificationBuffer.getActivityCount()).toBe(3);
  });
});
