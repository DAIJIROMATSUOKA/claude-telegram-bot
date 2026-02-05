/**
 * Gemini API 統合テスト
 */

import { callGeminiAPI } from './src/handlers/ai-router';

console.log('🧪 Testing Gemini API integration...\n');

const testPrompt = '「こんにちは」と日本語で返信してください。';
const testMemory = `# AI共有メモリ（テスト用）

## 基本情報
- これはテストです
`;

async function test() {
  const response = await callGeminiAPI(testPrompt, testMemory);

  console.log('Provider:', response.provider);
  console.log('Error:', response.error || 'なし');
  console.log('Content:', response.content ? response.content.slice(0, 200) : '(empty)');

  if (response.error) {
    console.log('\n❌ Test failed');
    process.exit(1);
  } else {
    console.log('\n✅ Test passed!');
  }
}

test();
