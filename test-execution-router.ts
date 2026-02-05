/**
 * Execution Router Test - Autopilot Engine v2.2
 *
 * Tests Shadow/Canary/Production modes and Kill Switch
 */

import { ExecutionRouter } from './src/utils/execution-router';
import type { AutopilotProposal } from './src/autopilot/engine';

const MEMORY_GATEWAY_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

// Create mock proposal
const mockProposal: AutopilotProposal = {
  task: {
    id: 'task_test_001',
    type: 'predictive',
    title: 'Test Task',
    description: 'Test execution router',
    reason: 'Testing',
    confidence: 0.9,
    impact: 'low',
    created_at: new Date().toISOString(),
    status: 'proposed',
    source_plugin: 'test-plugin',
  },
  action_plan: ['Step 1', 'Step 2'],
  estimated_duration: '5 minutes',
  risks: [],
  approval_required: false,
};

async function testExecutionRouter() {
  console.log('🧪 Execution Router Test\n');

  const router = new ExecutionRouter(MEMORY_GATEWAY_URL, 'shadow');

  console.log('='.repeat(60));
  console.log('Test 1: Shadow Mode (default)');
  console.log('='.repeat(60));

  let decision = await router.route(mockProposal);
  console.log('Decision:', decision);
  console.log(`✅ Should execute: ${decision.shouldExecute}`);
  console.log(`   Reason: ${decision.reason}\n`);

  if (decision.shouldExecute) {
    console.error('❌ FAIL: Shadow mode should not execute');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 2: Canary Mode - Test Scope');
  console.log('='.repeat(60));

  router.setMode('canary');
  router.setScope('test');

  decision = await router.route(mockProposal);
  console.log('Decision:', decision);
  console.log(`✅ Should execute: ${decision.shouldExecute}`);
  console.log(`   Reason: ${decision.reason}`);
  console.log(`   Canary rollout:`, decision.canaryRollout);
  console.log();

  if (!decision.shouldExecute) {
    console.error('❌ FAIL: Canary mode (test scope) should execute');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 3: Scope Promotion (test → canary)');
  console.log('='.repeat(60));

  const promotion = router.promoteScope();
  console.log('Promotion:', promotion);
  console.log(`✅ Promoted: ${promotion.from} → ${promotion.to}\n`);

  if (promotion.to !== 'canary') {
    console.error('❌ FAIL: Should promote to canary');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 4: Canary Mode - Canary Scope');
  console.log('='.repeat(60));

  decision = await router.route(mockProposal);
  console.log('Decision:', decision);
  console.log(`✅ Should execute: ${decision.shouldExecute}`);
  console.log(`   Scope: ${decision.scope}\n`);

  console.log('='.repeat(60));
  console.log('Test 5: Scope Promotion (canary → production)');
  console.log('='.repeat(60));

  const promotion2 = router.promoteScope();
  console.log('Promotion:', promotion2);
  console.log(`✅ Promoted: ${promotion2.from} → ${promotion2.to}\n`);

  if (promotion2.to !== 'production') {
    console.error('❌ FAIL: Should promote to production');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 6: Production Mode');
  console.log('='.repeat(60));

  router.setMode('production');

  decision = await router.route(mockProposal);
  console.log('Decision:', decision);
  console.log(`✅ Should execute: ${decision.shouldExecute}`);
  console.log(`   Mode: ${decision.mode}`);
  console.log(`   Scope: ${decision.scope}\n`);

  if (!decision.shouldExecute || decision.mode !== 'production') {
    console.error('❌ FAIL: Production mode should execute');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 7: Kill Switch - Enable');
  console.log('='.repeat(60));

  await router.enableKillSwitch('Test emergency stop', 'test-script');
  console.log('✅ Kill switch enabled\n');

  console.log('='.repeat(60));
  console.log('Test 8: Kill Switch - Check Status');
  console.log('='.repeat(60));

  const killStatus = await router.checkKillSwitch();
  console.log('Kill Switch Status:', killStatus);

  if (!killStatus.enabled) {
    console.error('❌ FAIL: Kill switch should be enabled');
    process.exit(1);
  }

  console.log('✅ Kill switch is enabled\n');

  console.log('='.repeat(60));
  console.log('Test 9: Kill Switch - Block Execution');
  console.log('='.repeat(60));

  decision = await router.route(mockProposal);
  console.log('Decision:', decision);
  console.log(`✅ Should execute: ${decision.shouldExecute}`);
  console.log(`   Reason: ${decision.reason}\n`);

  if (decision.shouldExecute) {
    console.error('❌ FAIL: Kill switch should block execution');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Test 10: Kill Switch - Disable');
  console.log('='.repeat(60));

  await router.disableKillSwitch('test-script');
  console.log('✅ Kill switch disabled\n');

  console.log('='.repeat(60));
  console.log('Test 11: Router Status Summary');
  console.log('='.repeat(60));

  const status = await router.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));
  console.log();

  console.log('='.repeat(60));
  console.log('Test 12: Scope Rollback (production → canary)');
  console.log('='.repeat(60));

  const rollback = router.rollbackScope();
  console.log('Rollback:', rollback);
  console.log(`✅ Rolled back: ${rollback.from} → ${rollback.to}\n`);

  if (rollback.to !== 'canary') {
    console.error('❌ FAIL: Should rollback to canary');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('🎉 All Tests Passed!');
  console.log('='.repeat(60));
  console.log();
  console.log('Summary:');
  console.log('  ✅ Shadow Mode');
  console.log('  ✅ Canary Mode (test/canary/production scopes)');
  console.log('  ✅ Production Mode');
  console.log('  ✅ Kill Switch (enable/disable/check)');
  console.log('  ✅ Scope Promotion');
  console.log('  ✅ Scope Rollback');
  console.log('  ✅ Router Status');
  console.log();
}

// Run tests
testExecutionRouter().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
