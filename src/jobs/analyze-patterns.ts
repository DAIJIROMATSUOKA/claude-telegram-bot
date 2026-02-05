#!/usr/bin/env bun
/**
 * Darwin Engine v1.3 - Pattern Analysis Job
 *
 * Analyzes workflow patterns, detects bottlenecks, makes predictions
 *
 * Usage:
 *   bun run src/jobs/analyze-patterns.ts --run-id <run_id>
 */

import { createWorkflowOptimizer } from '../darwin/workflow-optimizer';
import { ulid } from 'ulidx';

// ============================================================================
// Configuration
// ============================================================================

const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

const runIdArg = process.argv.find((arg) => arg.startsWith('--run-id='));
const RUN_ID = runIdArg ? runIdArg.split('=')[1] : ulid();

// ============================================================================
// Main Analysis
// ============================================================================

async function main() {
  console.log('🔍 Darwin Pattern Analysis v1.3');
  console.log(`📊 Run ID: ${RUN_ID}`);
  console.log('');

  const optimizer = createWorkflowOptimizer(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);

  try {
    // 1. Mine workflow patterns
    console.log('⏳ Mining workflow patterns...');
    const patterns = await optimizer.minePatterns();
    console.log(`✅ Patterns: ${patterns}`);

    // 2. Detect bottlenecks
    console.log('⏳ Detecting bottlenecks...');
    const bottlenecks = await optimizer.detectBottlenecks();
    console.log(`✅ Bottlenecks: ${bottlenecks}`);

    // 3. Generate time predictions
    console.log('⏳ Generating time predictions...');
    const predictions = await optimizer.generatePredictions(`analysis_${RUN_ID}`);
    console.log(`✅ Predictions: ${predictions}`);

    // 4. Find auto-skip candidates
    console.log('⏳ Finding auto-skip candidates...');
    const skipCandidates = await optimizer.findSkipCandidates();
    console.log(`✅ Skip Candidates: ${skipCandidates}`);

    console.log('');
    console.log('🎉 Analysis complete!');
    console.log('');
    console.log('Summary:');
    console.log(`  Patterns: ${patterns}`);
    console.log(`  Bottlenecks: ${bottlenecks}`);
    console.log(`  Predictions: ${predictions}`);
    console.log(`  Skip Candidates: ${skipCandidates}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

main();
