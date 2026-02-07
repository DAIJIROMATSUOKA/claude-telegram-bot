/**
 * /why Command Integration Test
 *
 * Tests the /why command handler with various scenarios
 */

import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { controlTowerDB } from '../utils/control-tower-db';
import { handleWhy } from '../handlers/why';
import type { Context } from 'grammy';

// Mock Context
function createMockContext(userId: number, chatId: number): {
  ctx: Context;
  replies: string[];
} {
  const replies: string[] = [];

  const ctx = {
    from: { id: userId, username: 'testuser' },
    chat: { id: chatId },
    message: { message_id: 12345 },
    reply: async (text: string, options?: any) => {
      replies.push(text);
      return { message_id: 99999, text } as any;
    },
  } as any;

  return { ctx, replies };
}

describe('/why Command Tests', () => {
  const TEST_USER_ID = 8484023872; // Must be in ALLOWED_USERS in .env
  const TEST_CHAT_ID = 987654321;
  const TEST_SESSION_ID = `${TEST_CHAT_ID}_12345`;

  beforeAll(() => {
    // Initialize test data
    controlTowerDB.updateControlTower({
      session_id: TEST_SESSION_ID,
      status: 'executing',
      phase: 'Phase E: Testing',
      current_action: 'Running /why test',
    });
  });

  afterAll(() => {
    // Clean up test data
    // Note: We don't have a delete method, but it's OK for testing
  });

  beforeEach(() => {
    // Reset allowlist
    controlTowerDB.updateSetting({
      key: 'why_allowlist_user_ids',
      value: '[]',
    });

    // Clean up test traces by using a fresh session ID for each test
    // We'll use a timestamp to ensure uniqueness
  });

  test('Unauthorized user gets rejected', async () => {
    const UNAUTHORIZED_USER_ID = 999999999; // Not in ALLOWED_USERS
    const { ctx, replies } = createMockContext(UNAUTHORIZED_USER_ID, TEST_CHAT_ID);

    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    expect(replies[0]).toBe('⛔ Unauthorized');
  });

  test('No action trace found', async () => {
    // Use a chatId that never appears in any session_id
    const unusedChatId = 111222333;
    const { ctx, replies } = createMockContext(TEST_USER_ID, unusedChatId);

    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    expect(replies[0]).toBe('❌ No action trace found');
  });

  test('Successful /why command with full trace data', async () => {
    // Use unique session ID for this test to avoid conflicts
    const uniqueSessionId = `${TEST_CHAT_ID}_${Date.now() + 2000}`;

    // First create the control tower entry
    controlTowerDB.updateControlTower({
      session_id: uniqueSessionId,
      status: 'executing',
      phase: 'Phase E: Testing',
      current_action: 'Running test',
    });

    // Create a full action trace
    const traceId = controlTowerDB.startActionTrace({
      session_id: uniqueSessionId,
      action_type: 'tool',
      action_name: 'Edit',
      trace_id: 'trace_001',
      task_id: 'task_001',
      inputs_redacted: 'File: test.ts, Lines: 10-20',
      decisions: JSON.stringify({
        rationale: 'User requested code refactoring to improve readability',
      }),
      metadata: {
        file_path: '/Users/test/test.ts',
        next_step: 'Run tests to verify changes',
      },
    });

    const now = Math.floor(Date.now() / 1000);
    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: now,
      duration_ms: 250,
      outputs_summary: 'Successfully refactored 3 functions, removed 15 lines of duplicate code',
      rollback_instruction: 'git checkout HEAD -- test.ts',
    });

    const { ctx, replies } = createMockContext(TEST_USER_ID, TEST_CHAT_ID);
    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    const response = replies[0];

    // Verify response contains all sections
    expect(response).toContain('🔍 <b>AI Decision Analysis</b>');
    expect(response).toContain('📌 What');
    expect(response).toContain('Action: Edit');
    expect(response).toContain('Status: completed');
    expect(response).toContain('Duration: 250ms');

    expect(response).toContain('💡 Why');
    expect(response).toContain('User requested code refactoring');

    expect(response).toContain('📊 Evidence');
    expect(response).toContain('File: test.ts');

    expect(response).toContain('🔄 Change');
    expect(response).toContain('Successfully refactored 3 functions');

    expect(response).toContain('↩️ Rollback');
    expect(response).toContain('git checkout HEAD -- test.ts');

    expect(response).toContain('➡️ Next');
    expect(response).toContain('Run tests to verify changes');

    expect(response).toContain('⏰ Executed at:');
  });

  test('Failed action trace shows error summary', async () => {
    // Use unique session ID for this test
    const uniqueSessionId = `${TEST_CHAT_ID}_${Date.now()}`;

    controlTowerDB.updateControlTower({
      session_id: uniqueSessionId,
      status: 'error',
      phase: 'Phase E: Error Test',
    });

    const traceId = controlTowerDB.startActionTrace({
      session_id: uniqueSessionId,
      action_type: 'tool',
      action_name: 'Bash',
      inputs_redacted: 'Command: npm test',
    });

    const now = Math.floor(Date.now() / 1000);
    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'failed',
      completed_at: now,
      duration_ms: 5000,
      error_summary: 'Test suite failed: 3 tests failed out of 10',
      rollback_instruction: 'Fix failing tests before proceeding',
    });

    const { ctx, replies } = createMockContext(TEST_USER_ID, TEST_CHAT_ID);
    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    const response = replies[0];

    expect(response).toContain('Status: failed');
    expect(response).toContain('🔄 Change');
    expect(response).toContain('⚠️ Error: Test suite failed');
  });

  test('Allowlist enforcement works', async () => {
    // Set allowlist to include only one user
    controlTowerDB.updateSetting({
      key: 'why_allowlist_user_ids',
      value: JSON.stringify([111111111]), // Different user
    });

    const { ctx, replies } = createMockContext(TEST_USER_ID, TEST_CHAT_ID);
    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    expect(replies[0]).toBe('⛔ Access denied');
  });

  test('Allowlist allows authorized user', async () => {
    // Add test user to allowlist
    controlTowerDB.updateSetting({
      key: 'why_allowlist_user_ids',
      value: JSON.stringify([TEST_USER_ID]),
    });

    // Create a trace
    const traceId = controlTowerDB.startActionTrace({
      session_id: TEST_SESSION_ID,
      action_type: 'tool',
      action_name: 'Read',
    });

    const now = Math.floor(Date.now() / 1000);
    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: now,
    });

    const { ctx, replies } = createMockContext(TEST_USER_ID, TEST_CHAT_ID);
    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('🔍 <b>AI Decision Analysis</b>');
  });

  test('Minimal trace data shows fallback messages', async () => {
    // Use unique session ID for this test
    const uniqueSessionId = `${TEST_CHAT_ID}_${Date.now() + 1000}`;

    controlTowerDB.updateControlTower({
      session_id: uniqueSessionId,
      status: 'thinking',
      phase: 'Phase E: Minimal Test',
    });

    // Create minimal trace
    const traceId = controlTowerDB.startActionTrace({
      session_id: uniqueSessionId,
      action_type: 'thinking',
    });

    const now = Math.floor(Date.now() / 1000);
    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: now,
    });

    const { ctx, replies } = createMockContext(TEST_USER_ID, TEST_CHAT_ID);
    await handleWhy(ctx);

    expect(replies.length).toBe(1);
    const response = replies[0];

    expect(response).toContain('(No decision rationale recorded)');
    expect(response).toContain('(No input evidence recorded)');
    expect(response).toContain('(No change summary recorded)');
    expect(response).toContain('(No rollback instruction available)');
    expect(response).toContain('(No next step suggestion)');
  });
});

console.log('✅ All /why command tests passed!');
