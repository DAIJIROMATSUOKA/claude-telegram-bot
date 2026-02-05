#!/usr/bin/env bun

/**
 * AI Council Helper Test
 * Jarvis内部からAI Councilを呼び出すテスト
 */

import { Bot } from 'grammy';
import { consultAICouncil, askCouncil } from './src/utils/ai-council-helper';

// Test chat ID (実際のTelegram chat IDを使用)
const TEST_CHAT_ID = parseInt(process.env.USER_CHAT_ID || '7488699341', 10); // DJ's chat ID
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Initialize bot
const bot = new Bot(BOT_TOKEN);

console.log('🧪 Testing AI Council Helper...\n');

async function main() {
  try {
    // Test 1: consultAICouncil (silent mode - no user notification)
    console.log('📋 Test 1: consultAICouncil() silent mode');
    console.log('─'.repeat(60));

    const question1 =
      'Memory Gateway v1のコアAPI実装が完了しました。次にJanitorシステムを実装するか、Acceptance Testsを先に実行するか、どちらが良いと思いますか？';

    const result1 = await consultAICouncil(null, TEST_CHAT_ID, question1, {
      sendToUser: false, // Silent mode
      includePrefix: true,
    });

    console.log('\n✅ Test 1 Completed');
    console.log('\n📊 Summary for Jarvis:');
    console.log(result1.summary);
    console.log('\n' + '─'.repeat(60) + '\n');

    // Wait 3 seconds before next test
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Test 2: askCouncil (silent mode - no user notification)
    console.log('📋 Test 2: askCouncil() silent mode');
    console.log('─'.repeat(60));

    const question2 =
      'クロッピー🦞、ジェミー💎、チャッピー🧠の中で、誰が一番優秀だと思う？';

    const result2 = await askCouncil(question2);

    console.log('\n✅ Test 2 Completed');
    console.log('\n📊 Summary:');
    console.log(result2);
    console.log('\n' + '─'.repeat(60) + '\n');

    console.log('🎉 All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
