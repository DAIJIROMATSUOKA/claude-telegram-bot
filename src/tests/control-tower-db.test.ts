/**
 * Control Tower DB - Integration Test
 *
 * D1データベースの動作確認テスト
 */

import { ControlTowerDB } from '../utils/control-tower-db';
import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = '/tmp/jarvis_control_tower_test.db';

describe('Control Tower DB', () => {
  let db: ControlTowerDB;

  beforeAll(() => {
    // テスト用DBを削除
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = new ControlTowerDB(TEST_DB_PATH);
  });

  afterAll(() => {
    db.close();
    // テスト用DBを削除
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  // =========================================================================
  // Control Tower Tests
  // =========================================================================

  test('updateControlTower - create new session', () => {
    db.updateControlTower({
      session_id: 'test-session-1',
      status: 'thinking',
      phase: 'Phase 1: Testing',
      current_action: 'Running test',
      metadata: { test: true },
    });

    const row = db.getControlTower('test-session-1');
    expect(row).not.toBeNull();
    expect(row!.session_id).toBe('test-session-1');
    expect(row!.status).toBe('thinking');
    expect(row!.phase).toBe('Phase 1: Testing');
    expect(row!.current_action).toBe('Running test');
    expect(JSON.parse(row!.metadata!)).toEqual({ test: true });
  });

  test('updateControlTower - update existing session', () => {
    db.updateControlTower({
      session_id: 'test-session-1',
      status: 'completed',
      phase: 'Phase 1: Testing',
      current_action: 'Test completed',
    });

    const row = db.getControlTower('test-session-1');
    expect(row).not.toBeNull();
    expect(row!.status).toBe('completed');
    expect(row!.current_action).toBe('Test completed');
  });

  test('getAllControlTowers', () => {
    db.updateControlTower({
      session_id: 'test-session-2',
      status: 'executing',
      phase: 'Phase 2: Execution',
    });

    const rows = db.getAllControlTowers();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // Action Trace Tests
  // =========================================================================

  test('startActionTrace and completeActionTrace', () => {
    const traceId = db.startActionTrace({
      session_id: 'test-session-1',
      action_type: 'tool',
      action_name: 'Read',
      metadata: { file: 'test.ts' },
    });

    expect(traceId).toBeGreaterThan(0);

    const now = Math.floor(Date.now() / 1000);
    db.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: now,
      duration_ms: 150,
    });

    const traces = db.getActionTraces('test-session-1');
    expect(traces.length).toBeGreaterThan(0);
    const trace = traces[0]!;
    expect(trace.action_type).toBe('tool');
    expect(trace.action_name).toBe('Read');
    expect(trace.status).toBe('completed');
    expect(trace.duration_ms).toBe(150);
  });

  test('getActionTraces with limit', () => {
    // 複数のトレースを追加
    for (let i = 0; i < 5; i++) {
      const traceId = db.startActionTrace({
        session_id: 'test-session-1',
        action_type: 'thinking',
        action_name: `Think ${i}`,
      });
      const now = Math.floor(Date.now() / 1000);
      db.completeActionTrace({
        id: traceId,
        status: 'completed',
        completed_at: now,
        duration_ms: 100,
      });
    }

    const traces = db.getActionTraces('test-session-1', 3);
    expect(traces.length).toBe(3);
  });

  // =========================================================================
  // Settings Tests
  // =========================================================================

  test('updateSetting - create new setting', () => {
    db.updateSetting({
      key: 'test_setting',
      value: 'test_value',
    });

    const row = db.getSetting('test_setting');
    expect(row).not.toBeNull();
    expect(row!.key).toBe('test_setting');
    expect(row!.value).toBe('test_value');
  });

  test('updateSetting - update existing setting', () => {
    db.updateSetting({
      key: 'test_setting',
      value: 'updated_value',
    });

    const row = db.getSetting('test_setting');
    expect(row!.value).toBe('updated_value');
  });

  test('getAllSettings', () => {
    const rows = db.getAllSettings();
    expect(rows.length).toBeGreaterThanOrEqual(4); // 3 defaults + 1 test
    expect(rows.some(r => r.key === 'notification_buffer_enabled')).toBe(true);
  });

  // =========================================================================
  // Default Settings Tests
  // =========================================================================

  test('default settings are created', () => {
    const notifBuffer = db.getSetting('notification_buffer_enabled');
    expect(notifBuffer).not.toBeNull();
    expect(notifBuffer!.value).toBe('true');

    const phaseNotif = db.getSetting('phase_notifications_enabled');
    expect(phaseNotif).not.toBeNull();
    expect(phaseNotif!.value).toBe('true');

    const threshold = db.getSetting('spam_prevention_threshold');
    expect(threshold).not.toBeNull();
    expect(threshold!.value).toBe('10');
  });
});

console.log('✅ All Control Tower DB tests passed!');
