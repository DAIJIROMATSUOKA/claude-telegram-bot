import { consultAICouncil } from './src/utils/ai-council-helper';

const result = await consultAICouncil(
  null,
  7488699341,
  `この実装タスクを開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: Memory Gateway Janitorシステムを実装してください

3人とも、簡潔に（3-5行以内で）重要なポイントのみを指摘してください。`,
  { sendToUser: false, includePrefix: false }
);

console.log('🏛️ AI Councilからの助言:\n');
console.log(result.advisorResponses);
console.log('\n📊 Summary:');
console.log(result.summary);
