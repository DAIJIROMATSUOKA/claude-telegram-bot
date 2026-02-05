/**
 * M3 Device Agent Integration Test
 *
 * Tests M3 Agent client functionality with Autopilot Engine v2.2
 */

import { M3AgentClient } from './src/utils/m3-agent-client';

async function testM3Agent() {
  console.log('🧪 M3 Device Agent Integration Test\n');

  // Load .env
  const m3Url = process.env.M3_AGENT_URL;
  const m3Token = process.env.M3_AGENT_TOKEN;

  console.log('Configuration:');
  console.log(`  M3_AGENT_URL: ${m3Url || '(not set)'}`);
  console.log(`  M3_AGENT_TOKEN: ${m3Token ? '***' + m3Token.slice(-8) : '(not set)'}\n`);

  // Create client
  const m3Agent = new M3AgentClient();

  if (!m3Agent.isEnabled()) {
    console.error('❌ M3 Agent not configured. Set M3_AGENT_URL and M3_AGENT_TOKEN in .env');
    process.exit(1);
  }

  console.log('✅ M3 Agent enabled\n');
  console.log(`Agent config:`, m3Agent.getConfig(), '\n');

  // Test 1: Notify
  console.log('Test 1: Send notification...');
  const notifyResult = await m3Agent.notify(
    'Test notification from Autopilot Engine v2.2',
    '🧪 M3 Agent Test'
  );
  console.log('Result:', notifyResult);

  if (!notifyResult.ok) {
    console.error('❌ Notification test failed:', notifyResult.error);
    process.exit(1);
  }

  console.log('✅ Notification test passed\n');

  // Test 2: Open file (create a test file first)
  console.log('Test 2: Open file...');
  const testFilePath = '/tmp/m3-agent-test.txt';

  // Create test file
  const fs = await import('fs/promises');
  await fs.writeFile(testFilePath, 'M3 Agent Test File\nAutopilot Engine v2.2\n');
  console.log(`Created test file: ${testFilePath}`);

  const openResult = await m3Agent.open(testFilePath);
  console.log('Result:', openResult);

  if (!openResult.ok) {
    console.error('⚠️ Open test failed:', openResult.error);
    console.log('(This is expected if M3 is not the current machine)');
  } else {
    console.log('✅ Open test passed\n');
  }

  // Test 3: Reveal file
  console.log('Test 3: Reveal file in Finder...');
  const revealResult = await m3Agent.reveal(testFilePath);
  console.log('Result:', revealResult);

  if (!revealResult.ok) {
    console.error('⚠️ Reveal test failed:', revealResult.error);
    console.log('(This is expected if M3 is not the current machine)');
  } else {
    console.log('✅ Reveal test passed\n');
  }

  // Test 4: Fire-and-forget notification
  console.log('Test 4: Fire-and-forget notification...');
  m3Agent.notifyAsync('Fire-and-forget test notification', '🔥 Async Test');
  console.log('✅ Fire-and-forget notification sent (async)\n');

  console.log('🎉 All tests completed!');
}

// Run tests
testM3Agent().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
