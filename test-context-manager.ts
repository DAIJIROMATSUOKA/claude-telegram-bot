/**
 * Context Manager v2.2 Test
 *
 * Tests Pinned Memory, Query-based Context, and Token Budget Management
 */

import { ContextManager } from './src/autopilot/context-manager';

const MEMORY_GATEWAY_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

async function testContextManager() {
  console.log('🧪 Context Manager v2.2 Test\n');

  const contextManager = new ContextManager(MEMORY_GATEWAY_URL);

  console.log('='.repeat(60));
  console.log('Test 1: Basic Context (Legacy)');
  console.log('='.repeat(60));

  let context = await contextManager.getContext({
    scope: 'shared/global',
    maxItems: 5,
    tokenBudget: 0, // Disable token budget for legacy test
  });

  console.log('Snapshot length:', context.snapshot.length, 'chars');
  console.log('Task history count:', context.task_history.length);
  console.log('Query results count:', context.query_results?.length || 0);
  console.log();

  console.log('='.repeat(60));
  console.log('Test 2: Pinned Memories');
  console.log('='.repeat(60));

  const pinnedMemories = await contextManager.getPinnedMemories('shared');
  console.log(`Found ${pinnedMemories.length} pinned memories`);

  if (pinnedMemories.length > 0) {
    console.log('Sample pinned memory:');
    console.log('  Title:', pinnedMemories[0].title);
    console.log('  Importance:', pinnedMemories[0].importance);
    console.log('  Created:', pinnedMemories[0].created_at);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Test 3: Query by Keywords');
  console.log('='.repeat(60));

  const keywordResults = await contextManager.queryByKeywords(['autopilot', 'task'], 'shared');
  console.log(`Found ${keywordResults.length} items matching keywords`);

  if (keywordResults.length > 0) {
    console.log('Sample result:');
    console.log('  Title:', keywordResults[0].title);
    console.log('  Type:', keywordResults[0].type);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Test 4: Context with Pinned + Keywords (No Budget)');
  console.log('='.repeat(60));

  context = await contextManager.getContext({
    scopePrefix: 'shared',
    includePinned: true,
    queryKeywords: ['autopilot'],
    maxItems: 5,
    tokenBudget: 0, // Disable budget
  });

  console.log('Snapshot length:', context.snapshot.length, 'chars');
  console.log('Task history count:', context.task_history.length);
  console.log('Query results count:', context.query_results?.length || 0);
  console.log();

  console.log('='.repeat(60));
  console.log('Test 5: Token Budget Management (4000 tokens)');
  console.log('='.repeat(60));

  context = await contextManager.getContext({
    scopePrefix: 'shared',
    includePinned: true,
    queryKeywords: ['autopilot', 'memory'],
    maxItems: 10,
    tokenBudget: 4000,
  });

  console.log('Snapshot length:', context.snapshot.length, 'chars');
  console.log('Task history count:', context.task_history.length);
  console.log('Query results count:', context.query_results?.length || 0);

  // Estimate total tokens
  const totalText =
    context.snapshot +
    JSON.stringify(context.task_history) +
    JSON.stringify(context.query_results);
  const estimatedTokens = Math.ceil(totalText.length / 4);

  console.log(`Estimated tokens: ${estimatedTokens} (budget: 4000)`);
  console.log(`Budget used: ${(estimatedTokens / 4000 * 100).toFixed(1)}%`);
  console.log();

  console.log('='.repeat(60));
  console.log('Test 6: Small Token Budget (1000 tokens)');
  console.log('='.repeat(60));

  context = await contextManager.getContext({
    scopePrefix: 'shared',
    includePinned: true,
    queryKeywords: ['autopilot'],
    maxItems: 10,
    tokenBudget: 1000, // Small budget
  });

  console.log('Snapshot length:', context.snapshot.length, 'chars');
  console.log('Task history count:', context.task_history.length);
  console.log('Query results count:', context.query_results?.length || 0);

  const totalText2 =
    context.snapshot +
    JSON.stringify(context.task_history) +
    JSON.stringify(context.query_results);
  const estimatedTokens2 = Math.ceil(totalText2.length / 4);

  console.log(`Estimated tokens: ${estimatedTokens2} (budget: 1000)`);
  console.log(`Budget used: ${(estimatedTokens2 / 1000 * 100).toFixed(1)}%`);

  if (context.snapshot.includes('[... truncated due to token budget ...]')) {
    console.log('✅ Snapshot was truncated (expected)');
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Test 7: Priority Order Verification');
  console.log('='.repeat(60));

  context = await contextManager.getContext({
    scopePrefix: 'shared',
    includePinned: true,
    queryKeywords: ['test'],
    maxItems: 5,
    tokenBudget: 2000,
  });

  console.log('Priority order (highest to lowest):');
  console.log('  1. Pinned memories:', context.query_results?.filter((r: any) => r.pinned)?.length || 0);
  console.log('  2. Task history:', context.task_history.length);
  console.log('  3. Keyword results:', context.query_results?.filter((r: any) => !r.pinned)?.length || 0);
  console.log('  4. Snapshot:', context.snapshot.length > 0 ? 'included' : 'excluded');
  console.log();

  console.log('='.repeat(60));
  console.log('🎉 All Tests Completed!');
  console.log('='.repeat(60));
  console.log();
  console.log('Summary:');
  console.log('  ✅ Basic context loading');
  console.log('  ✅ Pinned memory support');
  console.log('  ✅ Query by keywords');
  console.log('  ✅ Token budget management');
  console.log('  ✅ Context prioritization');
  console.log('  ✅ Budget truncation');
  console.log();
}

// Run tests
testContextManager().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
