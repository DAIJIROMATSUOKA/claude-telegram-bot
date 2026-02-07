/**
 * Phase 4 Notification Budget Test
 *
 * 通知スパム防止テスト - フェーズ完了時のみ1通ルール
 *
 * Current source behavior:
 * - startPhase: does NOT call ctx.reply(), only logs to console
 * - endPhase: sends exactly 1 notification via ctx.reply()
 * - Total per phase: 1 notification (end only)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Context } from 'grammy';

// No mocks needed — notification-buffer skips D1 writes when
// getSessionIdFromContext returns null (mock ctx has no real message).
// Previously mock.module was used here for control-tower-helper and
// session-helper, but that polluted the module cache and broke
// phase2-integration tests running in parallel.

import { notificationBuffer } from '../utils/notification-buffer';

// Mock Context
function createMockContext(): {
  ctx: Context;
  notifications: Array<{ text: string; options?: any }>;
} {
  const notifications: Array<{ text: string; options?: any }> = [];

  const ctx = {
    chat: { id: 12345 },
    message: { message_id: 67890 },
    reply: async (text: string, options?: any) => {
      notifications.push({ text, options });
      console.log(`[Mock Reply ${notifications.length}] ${text.substring(0, 80)}...`);
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
    (notificationBuffer as any).traceId = null;
  });

  test('Phase start sends 0 notifications, end sends exactly 1', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, '実装開始');
    // startPhase does NOT send any notification
    expect(notifications.length).toBe(0);

    await notificationBuffer.endPhase(ctx, true);
    // endPhase sends exactly 1 notification
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toContain('✅');
    expect(notifications[0].text).toContain('実装開始');
    expect(notifications[0].options).toEqual({ disable_notification: false });
  });

  test('End notification uses ━━━━━━━━━━━━━━━ separator format', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Separator Test');
    await notificationBuffer.endPhase(ctx, true);

    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toContain('━━━━━━━━━━━━━━━');
    // The message is wrapped: ━━━━━━━━━━━━━━━\n{summary}\n━━━━━━━━━━━━━━━
    const separatorCount = (notifications[0].text.match(/━━━━━━━━━━━━━━━/g) || []).length;
    expect(separatorCount).toBeGreaterThanOrEqual(2);
  });

  test('Activities are buffered, not sent individually', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Phase 4 Test');
    expect(notifications.length).toBe(0);

    // Add multiple activities
    notificationBuffer.addActivity('tool', 'Read file.ts');
    notificationBuffer.addActivity('tool', 'Edit file.ts');
    notificationBuffer.addActivity('thinking', 'Analyzing code');
    notificationBuffer.addTextResponse('Response segment 1');

    // Still 0 notifications
    expect(notifications.length).toBe(0);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);

    // Summary shows tool activities under 📋 やったこと: with bullet descriptions
    expect(notifications[0].text).toContain('📋 やったこと:');
    expect(notifications[0].text).toContain('• Read file.ts');
    expect(notifications[0].text).toContain('• Edit file.ts');
    expect(notifications[0].text).toContain('🧠 思考: 1回');
  });

  test('Text responses are buffered and included in phase completion', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Implementation');
    expect(notifications.length).toBe(0);

    // Add text responses
    notificationBuffer.addTextResponse('First response paragraph.');
    notificationBuffer.addTextResponse('Second response paragraph.');
    notificationBuffer.addTextResponse('Third response paragraph.');

    // Still 0 notifications
    expect(notifications.length).toBe(0);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);

    // Text should be in the final notification, joined by ---
    expect(notifications[0].text).toContain('First response paragraph');
    expect(notifications[0].text).toContain('Second response paragraph');
    expect(notifications[0].text).toContain('Third response paragraph');
    expect(notifications[0].text).toContain('---');
  });

  test('Error phase = exactly 1 notification', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Error Test');
    expect(notifications.length).toBe(0);

    notificationBuffer.addActivity('error', 'Failed to read file');
    notificationBuffer.addActivity('error', 'Network timeout');

    await notificationBuffer.endPhase(ctx, false);
    expect(notifications.length).toBe(1);

    expect(notifications[0].text).toContain('❌');
    expect(notifications[0].text).toContain('⚠️ エラー: 2回');
    expect(notifications[0].text).toContain('• Failed to read file');
    expect(notifications[0].text).toContain('• Network timeout');
  });

  test('Multiple phases in sequence = 1 notification per phase', async () => {
    const { ctx, notifications } = createMockContext();

    // Phase 1
    await notificationBuffer.startPhase(ctx, 'Phase 1');
    notificationBuffer.addActivity('tool', 'Action 1');
    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);

    // Phase 2
    await notificationBuffer.startPhase(ctx, 'Phase 2');
    notificationBuffer.addActivity('tool', 'Action 2');
    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(2);

    // Phase 1 end notification
    expect(notifications[0].text).toContain('Phase 1');
    expect(notifications[0].text).toContain('✅');

    // Phase 2 end notification
    expect(notifications[1].text).toContain('Phase 2');
    expect(notifications[1].text).toContain('✅');
  });

  test('isActive() returns correct state', async () => {
    expect(notificationBuffer.isActive()).toBe(false);

    const { ctx } = createMockContext();
    await notificationBuffer.startPhase(ctx, 'Test Phase');
    expect(notificationBuffer.isActive()).toBe(true);

    await notificationBuffer.endPhase(ctx, true);
    expect(notificationBuffer.isActive()).toBe(false);
  });

  test('Duplicate phase start is prevented', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Same Phase');
    expect(notifications.length).toBe(0);

    // Try to start same phase again - should be skipped
    await notificationBuffer.startPhase(ctx, 'Same Phase');
    expect(notifications.length).toBe(0); // Still 0, duplicate prevented

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);
  });

  test('Empty phase = exactly 1 notification', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Empty Phase');
    expect(notifications.length).toBe(0);

    // No activities added

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);

    expect(notifications[0].text).toContain('✅');
    expect(notifications[0].text).toContain('Empty Phase');
  });

  test('Text responses with activities = single combined notification', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Combined Test');
    expect(notifications.length).toBe(0);

    // Mix of activities and text
    notificationBuffer.addActivity('thinking', 'Planning');
    notificationBuffer.addTextResponse('Here is my response.');
    notificationBuffer.addActivity('tool', 'Read file');
    notificationBuffer.addTextResponse('Another paragraph.');
    notificationBuffer.addActivity('tool', 'Write file');

    // Still 0 notifications
    expect(notifications.length).toBe(0);

    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(1);

    // Final notification contains both text and summary
    expect(notifications[0].text).toContain('Here is my response');
    expect(notifications[0].text).toContain('Another paragraph');
    // Tool activities listed individually, not as count
    expect(notifications[0].text).toContain('📋 やったこと:');
    expect(notifications[0].text).toContain('• Read file');
    expect(notifications[0].text).toContain('• Write file');
    expect(notifications[0].text).toContain('🧠 思考: 1回');
  });

  test('getCurrentPhase() returns correct phase name', async () => {
    expect(notificationBuffer.getCurrentPhase()).toBeNull();

    const { ctx } = createMockContext();
    await notificationBuffer.startPhase(ctx, 'Test Phase Name');
    expect(notificationBuffer.getCurrentPhase()).toBe('Test Phase Name');
  });

  test('getActivityCount() returns correct count', async () => {
    expect(notificationBuffer.getActivityCount()).toBe(0);

    const { ctx } = createMockContext();
    await notificationBuffer.startPhase(ctx, 'Count Test');

    notificationBuffer.addActivity('tool', 'Action 1');
    expect(notificationBuffer.getActivityCount()).toBe(1);

    notificationBuffer.addActivity('thinking', 'Thought 1');
    expect(notificationBuffer.getActivityCount()).toBe(2);

    notificationBuffer.addActivity('tool', 'Action 2');
    expect(notificationBuffer.getActivityCount()).toBe(3);
  });

  test('End notification contains duration info', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Duration Test');
    await notificationBuffer.endPhase(ctx, true);

    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toContain('⏱ 所要時間:');
    expect(notifications[0].text).toContain('秒');
  });

  test('endPhase without active phase does nothing', async () => {
    const { ctx, notifications } = createMockContext();

    // No phase started
    await notificationBuffer.endPhase(ctx, true);
    expect(notifications.length).toBe(0);
  });

  test('Duplicate tool descriptions are deduplicated', async () => {
    const { ctx, notifications } = createMockContext();

    await notificationBuffer.startPhase(ctx, 'Dedup Test');

    // Same description multiple times
    notificationBuffer.addActivity('tool', 'Read config.ts');
    notificationBuffer.addActivity('tool', 'Read config.ts');
    notificationBuffer.addActivity('tool', 'Read config.ts');
    notificationBuffer.addActivity('tool', 'Write config.ts');

    await notificationBuffer.endPhase(ctx, true);

    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toContain('📋 やったこと:');
    expect(notifications[0].text).toContain('• Read config.ts');
    expect(notifications[0].text).toContain('• Write config.ts');

    // Count occurrences of "Read config.ts" - should appear only once (deduplicated)
    const readCount = (notifications[0].text.match(/• Read config\.ts/g) || []).length;
    expect(readCount).toBe(1);
  });
});
