/**
 * All AIs 統合テスト
 */

import { callAllAIs } from './src/handlers/ai-router';

console.log('🧪 Testing All AIs integration...\n');

const testPrompt = 'あなたの名前を教えてください。';
const testMemory = `# AI共有メモリ（テスト用）

## 基本情報
- これはテストです
`;

async function test() {
  console.log('🌟 Calling all AIs in parallel...\n');

  const response = await callAllAIs(testPrompt, testMemory);

  console.log('Provider:', response.provider);
  console.log('Error:', response.error || 'なし');
  console.log('\n--- Combined Response ---');
  console.log(response.content);
  console.log('--- End ---\n');

  if (response.error) {
    console.log('❌ Test failed');
    process.exit(1);
  } else {
    console.log('✅ Test passed!');
  }
}

test();
