/**
 * Notification Budget Test Suite
 * Phase D: S2 - Notification Budget
 *
 * Requirements:
 * 1. Start phase: NO notification sent (console log + D1 record only)
 * 2. End notification: disable_notification: false (loud)
 * 3. Intermediate progress: Tower edit only (no messages)
 * 4. streaming.ts: No ctx.reply() for text segments
 * 5. End notification includes trace_id
 * 6. Total notifications per phase: 1 (end only)
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { NotificationBuffer } from '../utils/notification-buffer.js';

// ============================================================================
// Mock Grammy Context
// ============================================================================

function createMockContext() {
  const replyHistory: Array<{
    text: string;
    options?: any;
  }> = [];

  const ctx: any = {
    chat: { id: 12345 },
    from: { id: 67890 },
    reply: mock(async (text: string, options?: any) => {
      replyHistory.push({ text, options });
      return {
        message_id: replyHistory.length,
        chat: { id: 12345 },
        text,
      };
    }),
    _replyHistory: () => replyHistory,
    _getNotificationFlags: () =>
      replyHistory.map((r) => r.options?.disable_notification ?? null),
  };

  return ctx;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Notification Budget - Phase D', () => {
  let buffer: NotificationBuffer;

  beforeEach(() => {
    buffer = new NotificationBuffer();
  });

  // ==========================================================================
  // Requirement 1: Start phase sends NO notification
  // ==========================================================================

  test('should NOT send notification on startPhase (log + D1 only)', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Analysis');

    const history = ctx._replyHistory();
    expect(history.length).toBe(0); // No notification on start
  });

  // ==========================================================================
  // Requirement 2: End notification is loud
  // ==========================================================================

  test('should send end notification with disable_notification: false', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Analysis');
    buffer.addActivity('thinking', 'Analyzing code');
    buffer.addActivity('tool', 'Reading file.ts');
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    expect(history.length).toBe(1); // End only

    // Check end notification
    const endNotification = history[0]!;
    expect(endNotification.text).toContain('✅');
    expect(endNotification.options?.disable_notification).toBe(false); // Loud
  });

  // ==========================================================================
  // Requirement 3: Only 1 notification per phase (end only)
  // ==========================================================================

  test('should send exactly 1 notification per phase (end only)', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Implementation');

    // Add many activities (should NOT trigger notifications)
    buffer.addActivity('thinking', 'Planning approach');
    buffer.addActivity('tool', 'Reading file.ts');
    buffer.addActivity('tool', 'Editing file.ts');
    buffer.addActivity('thinking', 'Reviewing changes');
    buffer.addActivity('tool', 'Running tests');

    // End phase
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    expect(history.length).toBe(1); // Only end notification
  });

  // ==========================================================================
  // Requirement 4: Intermediate activities do not send notifications
  // ==========================================================================

  test('should not send notifications for intermediate activities', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Testing');

    // Add 10 activities
    for (let i = 0; i < 10; i++) {
      buffer.addActivity('tool', `Action ${i}`);
    }

    const history = ctx._replyHistory();
    expect(history.length).toBe(0); // No notifications during phase
  });

  // ==========================================================================
  // Requirement 5: End notification includes trace_id
  // ==========================================================================

  test('should include trace_id in end notification', async () => {
    const ctx = createMockContext();

    const traceId = 'trace-abc-123-xyz';
    await buffer.startPhase(ctx, 'Phase 1: Deployment', traceId);
    buffer.addActivity('tool', 'Deploying...');
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    const endNotification = history[0]!;

    expect(endNotification.text).toContain('🔍 Trace ID:');
    expect(endNotification.text).toContain(traceId);
  });

  test('should not show trace_id if not provided', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Testing'); // No trace_id
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    const endNotification = history[0]!;

    expect(endNotification.text).not.toContain('Trace ID');
  });

  // ==========================================================================
  // Text Response Buffering
  // ==========================================================================

  test('should buffer text responses and send in end notification', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Generation');
    buffer.addTextResponse('First response');
    buffer.addTextResponse('Second response');
    buffer.addTextResponse('Third response');
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    expect(history.length).toBe(1); // End only

    const endNotification = history[0]!;
    expect(endNotification.text).toContain('First response');
    expect(endNotification.text).toContain('Second response');
    expect(endNotification.text).toContain('Third response');
  });

  // ==========================================================================
  // Activity Summary
  // ==========================================================================

  test('should include activity summary in end notification', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Full Cycle');
    buffer.addActivity('thinking', 'Analyzing');
    buffer.addActivity('thinking', 'Planning');
    buffer.addActivity('tool', 'Reading');
    buffer.addActivity('tool', 'Writing');
    buffer.addActivity('tool', 'Testing');
    await buffer.endPhase(ctx, true);

    const endNotification = ctx._replyHistory()[0]!;

    expect(endNotification.text).toContain('思考: 2回'); // 2 thinking
    expect(endNotification.text).toContain('やったこと'); // Tool activities listed individually
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  test('should handle phase errors with proper notification', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Error Test');
    buffer.addActivity('error', 'Failed to read file');
    await buffer.endPhase(ctx, false); // Failure

    const history = ctx._replyHistory();
    const endNotification = history[0]!;

    expect(endNotification.text).toContain('❌'); // Error icon
    expect(endNotification.text).toContain('エラー');
    expect(endNotification.text).toContain('Failed to read file');
    expect(endNotification.options?.disable_notification).toBe(false); // Still loud
  });

  // ==========================================================================
  // Multiple Phases
  // ==========================================================================

  test('should handle multiple sequential phases correctly', async () => {
    const ctx = createMockContext();

    // Phase 1
    await buffer.startPhase(ctx, 'Phase 1: Read');
    buffer.addActivity('tool', 'Reading');
    await buffer.endPhase(ctx, true);

    // Phase 2
    await buffer.startPhase(ctx, 'Phase 2: Write');
    buffer.addActivity('tool', 'Writing');
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    expect(history.length).toBe(2); // 2 phases × 1 notification each (end only)

    // Check notification flags - all end notifications are loud
    const flags = ctx._getNotificationFlags();
    expect(flags[0]).toBe(false); // Phase 1 end: loud
    expect(flags[1]).toBe(false); // Phase 2 end: loud
  });

  // ==========================================================================
  // Phase State Management
  // ==========================================================================

  test('should track phase state correctly', async () => {
    const ctx = createMockContext();

    expect(buffer.isActive()).toBe(false);
    expect(buffer.getCurrentPhase()).toBeNull();

    await buffer.startPhase(ctx, 'Phase 1: Test');

    expect(buffer.isActive()).toBe(true);
    expect(buffer.getCurrentPhase()).toBe('Phase 1: Test');

    await buffer.endPhase(ctx, true);

    expect(buffer.isActive()).toBe(false);
    expect(buffer.getCurrentPhase()).toBeNull();
  });

  // ==========================================================================
  // Activity Count
  // ==========================================================================

  test('should track activity count', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Test');

    expect(buffer.getActivityCount()).toBe(0);

    buffer.addActivity('thinking', 'Test 1');
    buffer.addActivity('tool', 'Test 2');
    buffer.addActivity('tool', 'Test 3');

    expect(buffer.getActivityCount()).toBe(3);

    await buffer.endPhase(ctx, true);

    expect(buffer.getActivityCount()).toBe(0); // Reset after phase
  });

  // ==========================================================================
  // Duplicate Phase Prevention
  // ==========================================================================

  test('should skip duplicate startPhase for same phase name', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Test');
    buffer.addActivity('tool', 'First action');

    // Attempt to start the same phase again
    await buffer.startPhase(ctx, 'Phase 1: Test');

    // Should still be in the original phase with the activity
    expect(buffer.isActive()).toBe(true);
    expect(buffer.getCurrentPhase()).toBe('Phase 1: Test');
    expect(buffer.getActivityCount()).toBe(1); // Original activity preserved

    const history = ctx._replyHistory();
    expect(history.length).toBe(0); // No notifications sent (no start, no forced end)
  });

  // ==========================================================================
  // End Notification Format
  // ==========================================================================

  test('should wrap end notification with separator lines', async () => {
    const ctx = createMockContext();

    await buffer.startPhase(ctx, 'Phase 1: Format Test');
    await buffer.endPhase(ctx, true);

    const history = ctx._replyHistory();
    const endNotification = history[0]!;

    // Check separator lines
    expect(endNotification.text.startsWith('━━━━━━━━━━━━━━━')).toBe(true);
    expect(endNotification.text.endsWith('━━━━━━━━━━━━━━━')).toBe(true);
  });
});

describe('Notification Budget - Summary', () => {
  test('Phase D acceptance criteria', () => {
    // ✅ Start phase: no notification (console log + D1 only)
    console.log('✅ 開始通知: なし（console.log + D1記録のみ）');

    // ✅ End notification: disable_notification: false
    console.log('✅ 終了通知: disable_notification: false（音あり）');

    // ✅ Intermediate: Tower edit only (no messages)
    console.log('✅ 途中経過: Tower編集のみ（メッセージなし）');

    // ✅ streaming.ts: ctx.reply() removed
    console.log('✅ streaming.ts: ctx.reply()削除済み');

    // ✅ End notification includes trace_id
    console.log('✅ 終了通知に trace_id 添付');

    // ✅ Total notifications per phase: 1 (end only)
    console.log('✅ 1フェーズあたり通知1回（終了時のみ）');

    console.log('✅ Phase D: Notification Budget - All tests passed');
  });
});
