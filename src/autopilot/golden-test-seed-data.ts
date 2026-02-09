/**
 * Golden Test Seed Data - Real accident patterns from AI_MEMORY
 *
 * Purpose: Bootstrap Golden Test suite with actual past problems
 * Source: AI_MEMORY (2026-02-03 ~ 2026-02-04)
 *
 * This file contains 5 actual accident patterns extracted from AI_MEMORY:
 * 1. Notification Spam (2026-02-03 12:04)
 * 2. Action Ledger Race Condition (2026-02-03 10:26)
 * 3. Memory Gateway Persistence Missing (2026-02-03 10:26)
 * 4. Device Health Check Missing (2026-02-04 05:28)
 * 5. Policy Engine Bypass (2026-02-04 05:28)
 */

import type { AccidentPattern, GoldenTest, TestSelectionCriteria } from './golden-test-types';

/**
 * AI_MEMORY抽出: 実際の事故パターン（5つ）
 */
export const SEED_ACCIDENT_PATTERNS: AccidentPattern[] = [
  {
    pattern_id: 'ACC-001-NOTIFICATION-SPAM',
    title: '通知スパム問題（10通以上連続）',
    description:
      '実装中に「📖 Reading...」「✏️ Editing...」などの中間通知が10通以上連続してTelegramに送信され、ユーザー体験が著しく悪化した',

    // Severity assessment
    severity: 'medium',
    blast_radius: 'project', // Affects user experience across all tasks

    // Occurrence tracking
    first_occurred_at: '2026-02-03T12:00:00Z',
    last_occurred_at: '2026-02-03T12:05:00Z',
    occurrence_count: 1, // Fixed immediately after first occurrence

    // Root cause
    root_cause:
      'src/handlers/streaming.ts が全ての tool 実行・thinking 段階で Telegram 通知を送信していた。Phase通知の概念がなく、個別のアクション毎に通知が発生',
    trigger_conditions: [
      '複数のファイル読み取り・編集を伴う実装タスク',
      'streaming.ts の notifyProgress() が全てのツール実行で呼ばれる',
      '通知レート制限なし',
    ],

    // Prevention
    golden_test_id: 'GT-001-NOTIFICATION-SPAM',
    fixed_at: '2026-02-03T12:30:00Z',

    // Source data
    conversation_ids: ['ai_memory_2026-02-03_12-04'],
    extracted_from: 'manual_report', // AI_MEMORYから手動抽出

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    updated_at: '2026-02-04T07:30:00Z',
  },

  {
    pattern_id: 'ACC-002-ACTION-LEDGER-RACE',
    title: 'Action Ledger Race Condition（並行実行時の重複）',
    description:
      'isDuplicate()とrecord()の間にタイムラグがあり、並行実行時に同じアクションが複数回記録される可能性があった',

    // Severity assessment
    severity: 'high',
    blast_radius: 'system', // Could cause duplicate dangerous actions

    // Occurrence tracking
    first_occurred_at: '2026-02-03T10:00:00Z',
    last_occurred_at: '2026-02-03T10:26:00Z',
    occurrence_count: 1, // Detected during code review

    // Root cause
    root_cause:
      'src/utils/action-ledger.ts の isDuplicate() と record() が分離されており、2つの呼び出しの間に race condition が存在。並行実行時に同じ dedupe_key で複数のアクションが通過する可能性',
    trigger_conditions: [
      '複数のAutopilot Engineが並行実行',
      '同じ dedupe_key を持つアクションが短時間に発生',
      'Memory Gatewayのレスポンス遅延',
    ],

    // Prevention
    golden_test_id: 'GT-002-ACTION-LEDGER-RACE',
    fixed_at: '2026-02-03T10:30:00Z',

    // Source data
    conversation_ids: ['ai_memory_2026-02-03_10-26'],
    extracted_from: 'manual_report',

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    updated_at: '2026-02-04T07:30:00Z',
  },

  {
    pattern_id: 'ACC-003-MEMORY-GATEWAY-PERSISTENCE',
    title: 'Memory Gateway永続化欠如（Bot再起動で重複防止記録消失）',
    description:
      'Action Ledgerの重複防止記録がメモリ内のみで保持されており、Bot再起動時に消失。クラッシュ後に重複アクションが実行される可能性',

    // Severity assessment
    severity: 'critical',
    blast_radius: 'system', // Could cause catastrophic duplicate actions after crash

    // Occurrence tracking
    first_occurred_at: '2026-02-03T10:00:00Z',
    last_occurred_at: '2026-02-03T10:26:00Z',
    occurrence_count: 1, // Detected during code review

    // Root cause
    root_cause:
      'src/utils/action-ledger.ts が重複防止記録を Map<string, ActionRecord> のみで管理。Memory Gatewayへの永続化が未実装。Bot クラッシュ→再起動で全記録が消失',
    trigger_conditions: [
      'Botクラッシュ後の再起動',
      'M1 Maxサーバーの再起動',
      '同じ dedupe_key のアクションが再実行',
    ],

    // Prevention
    golden_test_id: 'GT-003-MEMORY-GATEWAY-PERSISTENCE',
    fixed_at: '2026-02-03T10:30:00Z',

    // Source data
    conversation_ids: ['ai_memory_2026-02-03_10-26'],
    extracted_from: 'manual_report',

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    updated_at: '2026-02-04T07:30:00Z',
  },

  {
    pattern_id: 'ACC-004-DEVICE-HEALTH-CHECK',
    title: 'デバイスヘルスチェック欠如（M3スリープ/ロック状態の誤判定）',
    description:
      'M3 MacBook Proがスリープ・ロック状態でもオンラインと誤判定し、open_url/notifyアクションが失敗。ユーザー体験が悪化',

    // Severity assessment
    severity: 'medium',
    blast_radius: 'project', // Affects device routing accuracy

    // Occurrence tracking
    first_occurred_at: '2026-02-04T05:00:00Z',
    last_occurred_at: '2026-02-04T05:28:00Z',
    occurrence_count: 2, // Happened multiple times during testing

    // Root cause
    root_cause:
      'src/mesh/mesh-registry.ts がデバイスのオンライン判定を LAN ping のみで実施。M3 が network 接続されているだけでオンライン判定し、実際のサービス稼働状態を確認しない',
    trigger_conditions: [
      'M3 MacBook Proがスリープ状態（network接続は維持）',
      'M3がロック画面状態（M3 Device Agentは応答しない）',
      'open_url/notify アクションが M3 に routing',
    ],

    // Prevention
    golden_test_id: 'GT-004-DEVICE-HEALTH-CHECK',
    fixed_at: '2026-02-04T05:37:00Z',

    // Source data
    conversation_ids: ['ai_memory_2026-02-04_05-28'],
    extracted_from: 'manual_report',

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    updated_at: '2026-02-04T07:30:00Z',
  },

  {
    pattern_id: 'ACC-005-POLICY-ENGINE-BYPASS',
    title: 'Policy Engine バイパス（既存コードが検証をスキップ）',
    description:
      '既存の実装コードパスがPolicy Engineの検証をスキップし、危険なアクションが無審査で実行される可能性があった',

    // Severity assessment
    severity: 'critical',
    blast_radius: 'system', // Could allow dangerous actions without safety checks

    // Occurrence tracking
    first_occurred_at: '2026-02-04T05:00:00Z',
    last_occurred_at: '2026-02-04T05:28:00Z',
    occurrence_count: 1, // Detected during AI Council review

    // Root cause
    root_cause:
      'src/autopilot/engine.ts (v2.2) の既存実装パスが Policy Engine をバイパス可能。特定の条件下で validatePolicyBundle() が呼ばれずに execute() に進む経路が存在',
    trigger_conditions: [
      'Legacy code pathが実行される',
      'Policy Engine統合前の古いPlanBundle形式',
      'Approval Flow が既に承認済みの場合のショートカット',
    ],

    // Prevention
    golden_test_id: 'GT-005-POLICY-ENGINE-BYPASS',
    fixed_at: '2026-02-04T05:48:00Z',

    // Source data
    conversation_ids: ['ai_memory_2026-02-04_05-28'],
    extracted_from: 'manual_report',

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    updated_at: '2026-02-04T07:30:00Z',
  },
];

/**
 * AI_MEMORY抽出: 実際のGolden Test（5つ）
 */
export const SEED_GOLDEN_TESTS: GoldenTest[] = [
  {
    test_id: 'GT-001-NOTIFICATION-SPAM',
    title: '通知スパム防止テスト',
    description: '複数ファイル編集時に通知が10通を超えないことを検証',

    // Test selection criteria (calculated)
    severity: 'medium',
    blast_radius: 'project',
    frequency: 1,
    selection_score: 0.63, // (0.5*0.5 + 0.3*0.75 + 0.2*0.33) = 0.63

    // Test structure (Given-When-Then)
    given: '複数ファイル（5ファイル）の編集を伴う実装タスク',
    when: 'Autopilot Engineがタスクを実行',
    then: 'Telegram通知が10通以下（Phase開始1通 + Phase完了1通 = 2-3通）',

    // Test execution
    test_function: `
async function testNotificationSpamPrevention() {
  // Setup: Mock notification counter
  const notifications: string[] = [];
  const originalNotify = global.sendTelegramNotification;
  global.sendTelegramNotification = async (msg: string) => {
    notifications.push(msg);
  };

  try {
    // Given: Complex implementation task (5 files)
    const task = {
      type: 'implementation',
      files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'],
    };

    // When: Execute task
    await executeImplementationTask(task);

    // Then: Notifications should be <= 10
    if (notifications.length > 10) {
      throw new Error(\`Notification spam detected: \${notifications.length} notifications sent (expected <= 10)\`);
    }

    // Ideal: Phase-based notifications (2-3 total)
    console.log(\`✅ Notification count: \${notifications.length} (expected 2-3)\`);
  } finally {
    global.sendTelegramNotification = originalNotify;
  }
}
`,
    timeout_ms: 30000,

    // Flaky detection
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,

    // Kill Switch integration
    kill_switch_threshold: 'delayed', // Medium severity → 3 consecutive failures

    // Coverage tracking
    accident_pattern_id: 'ACC-001-NOTIFICATION-SPAM',
    times_prevented: 0,

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    source: 'conversation_log',
    tags: ['notifications', 'ux', 'spam-prevention'],
  },

  {
    test_id: 'GT-002-ACTION-LEDGER-RACE',
    title: 'Action Ledger Race Condition防止テスト',
    description: '並行実行時に同じアクションが重複記録されないことを検証',

    // Test selection criteria (calculated)
    severity: 'high',
    blast_radius: 'system',
    frequency: 1,
    selection_score: 0.78, // (0.5*0.75 + 0.3*1.0 + 0.2*0.33) = 0.78

    // Test structure (Given-When-Then)
    given: '同じ dedupe_key を持つ3つのアクションが並行実行',
    when: 'Action Ledger の recordIfNotDuplicate() が並行呼び出し',
    then: '1つのアクションのみが記録され、2つは duplicate として拒否',

    // Test execution
    test_function: `
async function testActionLedgerRaceCondition() {
  const ledger = new ActionLedger({ memoryGatewayUrl: process.env.MEMORY_GATEWAY_URL });

  // Given: Same dedupe_key
  const dedupeKey = 'test-action-' + Date.now();

  // When: Concurrent calls
  const results = await Promise.all([
    ledger.recordIfNotDuplicate(dedupeKey, { action: 'test', index: 1 }),
    ledger.recordIfNotDuplicate(dedupeKey, { action: 'test', index: 2 }),
    ledger.recordIfNotDuplicate(dedupeKey, { action: 'test', index: 3 }),
  ]);

  // Then: Only 1 should succeed
  const successCount = results.filter((r) => !r.isDuplicate).length;
  if (successCount !== 1) {
    throw new Error(\`Race condition detected: \${successCount} actions recorded (expected 1)\`);
  }

  console.log('✅ Race condition prevented: Only 1 action recorded');
}
`,
    timeout_ms: 10000,

    // Flaky detection
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,

    // Kill Switch integration
    kill_switch_threshold: 'immediate', // High severity → immediate kill

    // Coverage tracking
    accident_pattern_id: 'ACC-002-ACTION-LEDGER-RACE',
    times_prevented: 0,

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    source: 'conversation_log',
    tags: ['action-ledger', 'race-condition', 'concurrency'],
  },

  {
    test_id: 'GT-003-MEMORY-GATEWAY-PERSISTENCE',
    title: 'Memory Gateway永続化テスト',
    description: 'Action Ledgerの記録がBot再起動後も復元されることを検証',

    // Test selection criteria (calculated)
    severity: 'critical',
    blast_radius: 'system',
    frequency: 1,
    selection_score: 0.86, // (0.5*1.0 + 0.3*1.0 + 0.2*0.33) = 0.86

    // Test structure (Given-When-Then)
    given: 'Action Ledgerに1つのアクションを記録',
    when: 'Action Ledgerを破棄・再作成（Bot再起動をシミュレート）',
    then: '以前に記録したアクションが duplicate として検出',

    // Test execution
    test_function: `
async function testMemoryGatewayPersistence() {
  const dedupeKey = 'test-persistence-' + Date.now();

  // Given: Record an action
  const ledger1 = new ActionLedger({ memoryGatewayUrl: process.env.MEMORY_GATEWAY_URL });
  const result1 = await ledger1.recordIfNotDuplicate(dedupeKey, { action: 'test' });
  if (result1.isDuplicate) {
    throw new Error('First record should not be duplicate');
  }

  // Wait for Memory Gateway persistence
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // When: Destroy and recreate ledger (simulate bot restart)
  await ledger1.destroy();
  const ledger2 = new ActionLedger({ memoryGatewayUrl: process.env.MEMORY_GATEWAY_URL });

  // Then: Should detect duplicate
  const result2 = await ledger2.recordIfNotDuplicate(dedupeKey, { action: 'test' });
  if (!result2.isDuplicate) {
    throw new Error('Persistence failed: Action was not detected as duplicate after restart');
  }

  console.log('✅ Persistence verified: Action survived restart');
  await ledger2.destroy();
}
`,
    timeout_ms: 15000,

    // Flaky detection
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,

    // Kill Switch integration
    kill_switch_threshold: 'immediate', // Critical severity → immediate kill

    // Coverage tracking
    accident_pattern_id: 'ACC-003-MEMORY-GATEWAY-PERSISTENCE',
    times_prevented: 0,

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    source: 'conversation_log',
    tags: ['memory-gateway', 'persistence', 'crash-recovery'],
  },

  {
    test_id: 'GT-004-DEVICE-HEALTH-CHECK',
    title: 'デバイスヘルスチェックテスト',
    description: 'M3がスリープ時にオフラインと判定されることを検証',

    // Test selection criteria (calculated)
    severity: 'medium',
    blast_radius: 'project',
    frequency: 2,
    selection_score: 0.7, // (0.5*0.5 + 0.3*0.75 + 0.2*0.67) = 0.70

    // Test structure (Given-When-Then)
    given: 'M3 Device Agent が応答しない状態（health endpoint timeout）',
    when: 'Mesh Registryがデバイスステータスを確認',
    then: 'M3は offline と判定され、アクションは M1 にフォールバック',

    // Test execution
    test_function: `
async function testDeviceHealthCheck() {
  const registry = new MeshRegistry();

  // Given: M3 health endpoint is down
  const mockM3Offline = () => {
    // Mock HTTP request to fail
    global.fetch = async (url: string) => {
      if (url.includes('192.168.1.3:3500/health')) {
        throw new Error('Connection timeout');
      }
      return { ok: true };
    };
  };
  mockM3Offline();

  // When: Check device status
  await registry.updateDeviceHealth('m3-macbook-pro');

  // Then: M3 should be offline
  const m3Status = registry.getDeviceStatus('m3-macbook-pro');
  if (m3Status.online) {
    throw new Error('Device health check failed: M3 should be offline when health endpoint fails');
  }

  // Then: Actions should fallback to M1
  const targetDevice = registry.selectDevice('open_url');
  if (targetDevice.deviceId !== 'm1-max-mothership') {
    throw new Error(\`Fallback failed: Action routed to \${targetDevice.deviceId} instead of M1\`);
  }

  console.log('✅ Health check verified: M3 offline detection + M1 fallback');
}
`,
    timeout_ms: 10000,

    // Flaky detection
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,

    // Kill Switch integration
    kill_switch_threshold: 'delayed', // Medium severity → 3 consecutive failures

    // Coverage tracking
    accident_pattern_id: 'ACC-004-DEVICE-HEALTH-CHECK',
    times_prevented: 0,

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    source: 'conversation_log',
    tags: ['mesh-registry', 'device-routing', 'health-check'],
  },

  {
    test_id: 'GT-005-POLICY-ENGINE-BYPASS',
    title: 'Policy Engine バイパス防止テスト',
    description: '全てのPlanBundleがPolicy Engine検証を通過することを検証',

    // Test selection criteria (calculated)
    severity: 'critical',
    blast_radius: 'system',
    frequency: 1,
    selection_score: 0.86, // (0.5*1.0 + 0.3*1.0 + 0.2*0.33) = 0.86

    // Test structure (Given-When-Then)
    given: 'Policy Engine検証をバイパス可能な古いPlanBundle形式',
    when: 'Autopilot Engine が PlanBundle を実行',
    then: 'Policy Engine の validatePolicyBundle() が必ず呼ばれる',

    // Test execution
    test_function: `
async function testPolicyEngineBypassPrevention() {
  let policyEngineCallCount = 0;

  // Mock Policy Engine to track calls
  const originalValidate = PolicyEngine.prototype.validatePolicyBundle;
  PolicyEngine.prototype.validatePolicyBundle = async function (bundle: PlanBundle) {
    policyEngineCallCount++;
    return originalValidate.call(this, bundle);
  };

  try {
    // Given: Old-format PlanBundle (potential bypass path)
    const oldBundle = {
      plan_id: 'test-old-format',
      title: 'Test Action',
      scope: 'test' as const,
      confidence: 0.9,
      impact: 'low' as const,
      actions: [{ action: 'test' }],
      // Missing: evidence, risk (old format)
    };

    // When: Execute PlanBundle
    const engine = new AutopilotEngine();
    try {
      await engine.executePlanBundle(oldBundle as any);
    } catch (err) {
      // Expected: Should fail validation, but must call Policy Engine
    }

    // Then: Policy Engine must be called
    if (policyEngineCallCount === 0) {
      throw new Error('Policy Engine bypass detected: validatePolicyBundle() was not called');
    }

    console.log('✅ Policy Engine bypass prevented: Validation enforced');
  } finally {
    PolicyEngine.prototype.validatePolicyBundle = originalValidate;
  }
}
`,
    timeout_ms: 10000,

    // Flaky detection
    flaky_status: 'stable',
    failure_count: 0,
    retry_count: 0,

    // Kill Switch integration
    kill_switch_threshold: 'immediate', // Critical severity → immediate kill

    // Coverage tracking
    accident_pattern_id: 'ACC-005-POLICY-ENGINE-BYPASS',
    times_prevented: 0,

    // Metadata
    created_at: '2026-02-04T07:30:00Z',
    source: 'conversation_log',
    tags: ['policy-engine', 'security', 'bypass-prevention'],
  },
];

/**
 * Default Test Selection Criteria (AI Council consensus)
 */
export const DEFAULT_TEST_SELECTION_CRITERIA: TestSelectionCriteria = {
  // 3-axis scoring
  severity_weight: 0.5, // 50%
  blast_radius_weight: 0.3, // 30%
  frequency_weight: 0.2, // 20%

  // Thresholds
  minimum_score: 0.6, // Top 60% of accidents become tests
  maximum_tests: 20, // To avoid slow CI

  // Selection logic
  force_include_severity: ['critical', 'high'], // Always include these
  exclude_low_frequency: false, // Include even one-time accidents if severe
};
