/**
 * Test script for Proactive AI Council Consultation
 */

import { consultAICouncil } from './src/utils/ai-council-helper';

const TEST_CHAT_ID = parseInt(process.env.USER_CHAT_ID || '7488699341', 10);

console.log('🧪 Testing Proactive AI Council Consultation\n');

// Test 1: Pre-implementation consultation
console.log('='.repeat(60));
console.log('Test 1: Pre-implementation Consultation');
console.log('='.repeat(60));

const implementationTask = `Memory Gateway v2を実装してください。
以下の機能を追加します：
- リアルタイムWebSocket同期
- バージョン管理機能
- コンフリクト解決機能`;

console.log(`\n📝 Task: ${implementationTask}\n`);

try {
  const result = await consultAICouncil(
    null, // No bot instance (silent mode)
    TEST_CHAT_ID,
    `この実装タスクを開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: ${implementationTask}

3人とも、簡潔に（3-5行以内で）重要なポイントのみを指摘してください。`,
    {
      sendToUser: false, // Silent mode
      includePrefix: false,
    }
  );

  console.log('✅ AI Council Consultation Completed\n');
  console.log('📋 Full Advisor Responses:');
  console.log('─'.repeat(60));
  console.log(result.advisorResponses);
  console.log('─'.repeat(60));

  console.log('\n📊 Summary for Jarvis:');
  console.log('─'.repeat(60));
  console.log(result.summary);
  console.log('─'.repeat(60));

  console.log('\n✨ This advice would be prepended to the message sent to Claude');

} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}

console.log('\n🎉 All tests completed successfully!');
