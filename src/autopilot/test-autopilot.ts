/**
 * Autopilot Engine v1 - Basic Test
 *
 * Tests the basic flow with Predictive Task Generator
 */

import { AutopilotEngine } from './engine';
import { PredictiveTaskGenerator } from './plugins/predictive-task-generator';
import { Bot } from 'grammy';

/**
 * Mock test without real Telegram bot
 */
async function testAutopilotBasic() {
  console.log('='.repeat(60));
  console.log('Autopilot Engine v1 - Basic Test');
  console.log('='.repeat(60));

  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';

  // Create mock bot (for testing without real Telegram)
  const mockBot = {
    sendMessage: async (chatId: number, text: string, options?: any) => {
      console.log(`\n[Mock Bot] Sending message to chat ${chatId}:`);
      console.log(text);
      return { message_id: Date.now() };
    },
    editMessageReplyMarkup: async (chatId: number, messageId: number, options?: any) => {
      console.log(`[Mock Bot] Editing message ${messageId}`);
    },
    editMessageText: async (chatId: number, messageId: number, text: string) => {
      console.log(`[Mock Bot] Updating message ${messageId}: ${text}`);
    },
  };

  // Create autopilot engine
  const engine = new AutopilotEngine(
    mockBot as any,
    12345, // Mock chat ID
    memoryGatewayUrl
  );

  // Register Predictive Task Generator plugin
  const predictivePlugin = new PredictiveTaskGenerator(memoryGatewayUrl);
  engine.registerPlugin(predictivePlugin);

  console.log('\n✅ Registered plugins:');
  console.log('  - Predictive Task Generator');

  // Run pipeline
  console.log('\n🚀 Starting pipeline...\n');

  try {
    await engine.run();
    console.log('\n✅ Pipeline completed successfully');
  } catch (error) {
    console.error('\n❌ Pipeline failed:', error);
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Test individual plugin
 */
async function testPredictivePlugin() {
  console.log('='.repeat(60));
  console.log('Predictive Task Generator - Plugin Test');
  console.log('='.repeat(60));

  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
  const plugin = new PredictiveTaskGenerator(memoryGatewayUrl);

  console.log('\n🔍 Detecting triggers...\n');

  try {
    const triggers = await plugin.detectTriggers();

    console.log(`\n✅ Found ${triggers.length} triggers:`);

    triggers.forEach((trigger, i) => {
      console.log(`\n[${i + 1}] ${trigger.title}`);
      console.log(`  Type: ${trigger.type}`);
      console.log(`  Confidence: ${(trigger.confidence * 100).toFixed(0)}%`);
      console.log(`  Impact: ${trigger.impact}`);
      console.log(`  Reason: ${trigger.reason}`);
    });

    if (triggers.length === 0) {
      console.log('\n💡 No triggers detected at this time.');
      console.log('   Try running at different times of day:');
      console.log('   - 7:00-9:00 for daily planning');
      console.log('   - 19:00-21:00 for evening review');
      console.log('   - Sunday for weekly review');
    }
  } catch (error) {
    console.error('\n❌ Plugin test failed:', error);
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Test action ledger
 */
async function testActionLedger() {
  console.log('='.repeat(60));
  console.log('Action Ledger - Deduplication Test');
  console.log('='.repeat(60));

  const { ActionLedger } = await import('../utils/action-ledger');

  const ledger = new ActionLedger({ defaultTTL: 5000 }); // 5 second TTL for testing

  console.log('\n🧪 Testing deduplication...\n');

  // Test 1: Record action
  const key1 = ActionLedger.generateDedupeKey('test', 'action', 'task1');
  console.log(`1. Recording action: ${key1}`);
  await ledger.record(key1, { test: true });

  // Test 2: Check duplicate
  console.log(`2. Checking if duplicate: ${await ledger.isDuplicate(key1) ? '✅ Yes' : '❌ No'}`);

  // Test 3: Check non-duplicate
  const key2 = ActionLedger.generateDedupeKey('test', 'action', 'task2');
  console.log(`3. Checking new action: ${await ledger.isDuplicate(key2) ? '❌ Duplicate' : '✅ Not duplicate'}`);

  // Test 4: Time-window keys
  const dailyKey = ActionLedger.generateTimeWindowKey('autopilot', 'evening_review', 'daily');
  console.log(`4. Daily window key: ${dailyKey}`);
  await ledger.record(dailyKey, { window: 'daily' });

  // Test 5: Ledger size
  console.log(`5. Ledger size: ${ledger.size()} entries`);

  // Test 6: Get all entries
  const entries = await ledger.getAll();
  console.log(`6. All entries:`);
  entries.forEach((entry, i) => {
    console.log(`   [${i + 1}] ${entry.dedupe_key} (executed: ${entry.executed_at})`);
  });

  // Test 7: Wait for TTL expiration
  console.log(`\n7. Waiting 6 seconds for TTL expiration...`);
  await new Promise((resolve) => setTimeout(resolve, 6000));

  console.log(`8. Checking if expired: ${await ledger.isDuplicate(key1) ? '❌ Still duplicate' : '✅ Expired'}`);
  console.log(`9. Ledger size after cleanup: ${ledger.size()} entries`);

  console.log('\n✅ Action Ledger test completed');
  console.log('='.repeat(60));
}

/**
 * Run all tests
 */
async function runAllTests() {
  try {
    // Test 1: Action Ledger
    await testActionLedger();
    console.log('\n');

    // Test 2: Predictive Plugin
    await testPredictivePlugin();
    console.log('\n');

    // Test 3: Full Pipeline (mock)
    await testAutopilotBasic();
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().then(() => {
    console.log('\n✅ All tests completed\n');
    process.exit(0);
  });
}

export { testAutopilotBasic, testPredictivePlugin, testActionLedger };
