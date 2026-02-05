#!/usr/bin/env tsx
/**
 * CLI Runner for Test Simulation Engine
 *
 * Phase 4: Run Golden Test effectiveness simulations on-demand
 *
 * Usage:
 *   npm run test:simulation
 *   tsx src/scripts/run-test-simulation.ts
 *
 * Environment Variables:
 *   MEMORY_GATEWAY_URL - Memory Gateway endpoint (default: http://localhost:8787)
 */

import { TestSimulationEngine } from '../autopilot/test-simulation';
import { SEED_ACCIDENT_PATTERNS, SEED_GOLDEN_TESTS } from '../autopilot/golden-test-seed-data';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🧪 Golden Test Simulation - Phase 4');
  console.log('═'.repeat(80));
  console.log('Purpose: Verify Golden Tests correctly detect past accident patterns\n');

  // Configuration
  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
  console.log(`Memory Gateway: ${memoryGatewayUrl}`);
  console.log(`Accident Patterns: ${SEED_ACCIDENT_PATTERNS.length}`);
  console.log(`Golden Tests: ${SEED_GOLDEN_TESTS.length}`);
  console.log('');

  // Initialize Test Simulation Engine
  const engine = new TestSimulationEngine(memoryGatewayUrl);

  // Step 1: Generate scenarios
  console.log('📋 Step 1: Generating simulation scenarios...');
  const scenarios = await engine.generateScenarios(SEED_ACCIDENT_PATTERNS, SEED_GOLDEN_TESTS);
  console.log(`✅ Generated ${scenarios.length} scenarios`);
  console.log(`   - Positive (should detect): ${scenarios.filter(s => s.expected_detection).length}`);
  console.log(`   - Negative (should allow): ${scenarios.filter(s => !s.expected_detection).length}`);
  console.log('');

  // Step 2: Run simulation
  console.log('🚀 Step 2: Running simulation...');
  const startTime = Date.now();
  const summary = await engine.runSimulation(scenarios, SEED_GOLDEN_TESTS);
  const duration = Date.now() - startTime;
  console.log(`✅ Simulation complete in ${duration}ms`);
  console.log('');

  // Step 3: Display results
  console.log('📊 Step 3: Simulation Results');
  console.log('─'.repeat(80));
  console.log(`Total Scenarios:     ${summary.total_scenarios}`);
  console.log(`True Positives:      ${summary.true_positives} ✅ (accidents detected correctly)`);
  console.log(`True Negatives:      ${summary.true_negatives} ✅ (safe operations allowed)`);
  console.log(`False Positives:     ${summary.false_positives} ⚠️  (false alarms)`);
  console.log(`False Negatives:     ${summary.false_negatives} 🚨 (missed accidents - CRITICAL!)`);
  console.log('');
  console.log(`Precision:           ${(summary.precision * 100).toFixed(1)}% (accuracy of detections)`);
  console.log(`Recall:              ${(summary.recall * 100).toFixed(1)}% (% of accidents caught)`);
  console.log(`F1 Score:            ${(summary.f1_score * 100).toFixed(1)}% (harmonic mean)`);
  console.log(`Test Effectiveness:  ${(summary.test_effectiveness * 100).toFixed(1)}% ${getEffectivenessEmoji(summary.test_effectiveness)}`);
  console.log('');

  // Step 4: Generate and display report
  console.log('📄 Step 4: Effectiveness Report');
  console.log('─'.repeat(80));
  const report = engine.generateReport(summary);
  console.log(report);

  // Step 5: Validation
  console.log('');
  console.log('🔍 Step 5: Validation');
  console.log('─'.repeat(80));

  let validationPassed = true;

  // Critical check: No false negatives allowed
  if (summary.false_negatives > 0) {
    console.error('❌ CRITICAL FAILURE: False negatives detected!');
    const missedAccidents = summary.scenarios.filter(s => s.result === 'false_negative');
    missedAccidents.forEach(scenario => {
      console.error(`   🚨 Missed: ${scenario.accident_pattern_id}`);
    });
    validationPassed = false;
  } else {
    console.log('✅ No false negatives: All past accidents are correctly detected');
  }

  // Effectiveness threshold check
  const MINIMUM_EFFECTIVENESS = 0.85; // 85%
  if (summary.test_effectiveness < MINIMUM_EFFECTIVENESS) {
    console.warn(`⚠️  Test effectiveness below threshold: ${(summary.test_effectiveness * 100).toFixed(1)}% < ${(MINIMUM_EFFECTIVENESS * 100).toFixed(0)}%`);
    validationPassed = false;
  } else {
    console.log(`✅ Test effectiveness meets threshold: ${(summary.test_effectiveness * 100).toFixed(1)}% >= ${(MINIMUM_EFFECTIVENESS * 100).toFixed(0)}%`);
  }

  // False positive rate check
  const falsePositiveRate = summary.total_scenarios > 0 ? summary.false_positives / summary.total_scenarios : 0;
  if (falsePositiveRate > 0.1) {
    console.warn(`⚠️  High false positive rate: ${(falsePositiveRate * 100).toFixed(1)}% > 10%`);
  } else {
    console.log(`✅ False positive rate acceptable: ${(falsePositiveRate * 100).toFixed(1)}% <= 10%`);
  }

  console.log('');
  console.log('═'.repeat(80));

  if (validationPassed) {
    console.log('🎉 Simulation PASSED: Golden Tests are working correctly!');
    console.log('═'.repeat(80));
    process.exit(0);
  } else {
    console.error('🚨 Simulation FAILED: Golden Tests need improvement!');
    console.log('═'.repeat(80));
    process.exit(1);
  }
}

function getEffectivenessEmoji(effectiveness: number): string {
  if (effectiveness >= 0.95) return '🌟';
  if (effectiveness >= 0.85) return '✅';
  if (effectiveness >= 0.75) return '⚠️';
  return '🚨';
}

// Handle errors
main().catch((error) => {
  console.error('');
  console.error('═'.repeat(80));
  console.error('💥 Fatal Error:');
  console.error(error);
  console.error('═'.repeat(80));
  process.exit(1);
});
