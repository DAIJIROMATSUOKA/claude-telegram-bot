/**
 * AI Router テスト
 */

import { parseRoutePrefix } from './src/handlers/ai-router';

console.log('🧪 Testing AI Router...\n');

const tests = [
  { input: 'gpt: テストメッセージ', expected: 'gpt' },
  { input: 'gemini: Google関連の質問', expected: 'gemini' },
  { input: 'croppy: 文章を整理して', expected: 'croppy' },
  { input: 'all: この3つの選択肢どれがいい？', expected: 'all' },
  { input: 'GPT: 大文字もOK', expected: 'gpt' },
  { input: '普通のメッセージ', expected: 'jarvis' },
];

for (const test of tests) {
  const result = parseRoutePrefix(test.input);
  const pass = result.provider === test.expected;
  console.log(
    `${pass ? '✅' : '❌'} "${test.input}" → ${result.provider} (prompt: "${result.prompt}")`
  );
}

console.log('\n🎉 Test complete!');
