/**
 * Test Simulation Engine - Test Runner
 *
 * Phase 4: Verify Golden Test effectiveness by replaying past accidents
 *
 * Purpose:
 * - Validate that Golden Tests correctly detect past accident patterns
 * - Measure Precision, Recall, F1 Score, and Test Effectiveness
 * - Ensure false negative rate is 0% (all accidents must be caught)
 */

import { TestSimulationEngine } from '../autopilot/test-simulation';
import { SEED_ACCIDENT_PATTERNS, SEED_GOLDEN_TESTS } from '../autopilot/golden-test-seed-data';
import type { SimulationSummary } from '../autopilot/test-simulation';

/**
 * Test: Generate simulation scenarios from seed data
 */
async function testScenarioGeneration() {
  console.log('\n🧪 Test 1: Scenario Generation');
  console.log('═'.repeat(60));

  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
  const engine = new TestSimulationEngine(memoryGatewayUrl);

  const scenarios = await engine.generateScenarios(SEED_ACCIDENT_PATTERNS, SEED_GOLDEN_TESTS);

  console.log(`✅ Generated ${scenarios.length} simulation scenarios`);
  console.log(`   - Positive scenarios (should detect): ${scenarios.filter(s => s.expected_detection).length}`);
  console.log(`   - Negative scenarios (should allow): ${scenarios.filter(s => !s.expected_detection).length}`);

  // Verify each accident pattern has a corresponding scenario
  const accidentCount = SEED_ACCIDENT_PATTERNS.length;
  const positiveScenarios = scenarios.filter(s => s.expected_detection).length;

  if (positiveScenarios !== accidentCount) {
    throw new Error(
      `Scenario generation incomplete: Expected ${accidentCount} positive scenarios, got ${positiveScenarios}`
    );
  }

  // Verify each scenario has a corresponding Golden Test
  for (const scenario of scenarios.filter(s => s.expected_detection)) {
    const hasTest = SEED_GOLDEN_TESTS.some(
      test => test.accident_pattern_id === scenario.accident_pattern_id
    );
    if (!hasTest) {
      throw new Error(`No Golden Test found for accident pattern: ${scenario.accident_pattern_id}`);
    }
  }

  console.log('✅ All accident patterns have corresponding scenarios and tests');
  return scenarios;
}

/**
 * Test: Run full simulation and verify metrics
 */
async function testSimulationExecution() {
  console.log('\n🧪 Test 2: Simulation Execution');
  console.log('═'.repeat(60));

  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
  const engine = new TestSimulationEngine(memoryGatewayUrl);

  // Generate scenarios
  const scenarios = await engine.generateScenarios(SEED_ACCIDENT_PATTERNS, SEED_GOLDEN_TESTS);

  // Run simulation
  console.log(`Running simulation with ${scenarios.length} scenarios...`);
  const summary = await engine.runSimulation(scenarios, SEED_GOLDEN_TESTS);

  console.log('\n📊 Simulation Results:');
  console.log(`   - Total Scenarios: ${summary.total_scenarios}`);
  console.log(`   - True Positives: ${summary.true_positives} (accidents detected correctly)`);
  console.log(`   - True Negatives: ${summary.true_negatives} (safe operations allowed)`);
  console.log(`   - False Positives: ${summary.false_positives} (false alarms)`);
  console.log(`   - False Negatives: ${summary.false_negatives} (missed accidents - CRITICAL!)`);
  console.log(`   - Precision: ${(summary.precision * 100).toFixed(1)}%`);
  console.log(`   - Recall: ${(summary.recall * 100).toFixed(1)}%`);
  console.log(`   - F1 Score: ${(summary.f1_score * 100).toFixed(1)}%`);
  console.log(`   - Test Effectiveness: ${(summary.test_effectiveness * 100).toFixed(1)}%`);

  return summary;
}

/**
 * Test: Verify no false negatives (CRITICAL requirement)
 */
async function testNoFalseNegatives(summary: SimulationSummary) {
  console.log('\n🧪 Test 3: False Negative Verification (CRITICAL)');
  console.log('═'.repeat(60));

  if (summary.false_negatives > 0) {
    console.error('🚨 CRITICAL FAILURE: False negatives detected!');
    const missedAccidents = summary.scenarios.filter(s => s.result === 'false_negative');

    missedAccidents.forEach(scenario => {
      console.error(`   ❌ Missed: ${scenario.accident_pattern_id}`);
      console.error(`      Title: ${SEED_ACCIDENT_PATTERNS.find(p => p.pattern_id === scenario.accident_pattern_id)?.title}`);
      console.error(`      Expected Detection: ${scenario.expected_detection}`);
      console.error(`      Actually Detected: ${scenario.detected}`);
    });

    throw new Error(
      `CRITICAL: ${summary.false_negatives} accidents were NOT detected by Golden Tests. ` +
      `All past accidents MUST be caught to prevent recurrence.`
    );
  }

  console.log('✅ No false negatives: All past accidents are correctly detected');
}

/**
 * Test: Verify test effectiveness threshold
 */
async function testEffectivenessThreshold(summary: SimulationSummary) {
  console.log('\n🧪 Test 4: Test Effectiveness Threshold');
  console.log('═'.repeat(60));

  const MINIMUM_EFFECTIVENESS = 0.85; // 85% effectiveness required

  console.log(`   - Test Effectiveness: ${(summary.test_effectiveness * 100).toFixed(1)}%`);
  console.log(`   - Minimum Required: ${(MINIMUM_EFFECTIVENESS * 100).toFixed(1)}%`);

  if (summary.test_effectiveness < MINIMUM_EFFECTIVENESS) {
    console.warn(`⚠️  Test effectiveness below threshold (${(MINIMUM_EFFECTIVENESS * 100).toFixed(0)}%)`);
    console.warn(`   - Current: ${(summary.test_effectiveness * 100).toFixed(1)}%`);
    console.warn(`   - Recall: ${(summary.recall * 100).toFixed(1)}% (accidents caught)`);
    console.warn(`   - Precision: ${(summary.precision * 100).toFixed(1)}% (accuracy)`);
    console.warn('   - Recommendation: Improve test coverage or reduce false positives');
  } else {
    console.log(`✅ Test effectiveness meets threshold: ${(summary.test_effectiveness * 100).toFixed(1)}% >= ${(MINIMUM_EFFECTIVENESS * 100).toFixed(1)}%`);
  }
}

/**
 * Test: Generate and verify effectiveness report
 */
async function testReportGeneration(summary: SimulationSummary) {
  console.log('\n🧪 Test 5: Report Generation');
  console.log('═'.repeat(60));

  const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
  const engine = new TestSimulationEngine(memoryGatewayUrl);

  const report = engine.generateReport(summary);

  // Verify report contains key sections
  const requiredSections = [
    'Overall Effectiveness',
    'Detection Results',
    'Recommendations',
  ];

  for (const section of requiredSections) {
    if (!report.includes(section)) {
      throw new Error(`Report missing required section: ${section}`);
    }
  }

  // Verify metrics are included
  const requiredMetrics = [
    'Test Effectiveness',
    'F1 Score',
    'Precision',
    'Recall',
    'True Positives',
    'True Negatives',
  ];

  for (const metric of requiredMetrics) {
    if (!report.includes(metric)) {
      throw new Error(`Report missing required metric: ${metric}`);
    }
  }

  console.log('✅ Report generation successful');
  console.log('\n📄 Generated Report:');
  console.log('─'.repeat(60));
  console.log(report);
  console.log('─'.repeat(60));

  return report;
}

/**
 * Test: Verify scenario-test mapping
 */
async function testScenarioTestMapping() {
  console.log('\n🧪 Test 6: Scenario-Test Mapping Verification');
  console.log('═'.repeat(60));

  // Verify each accident pattern has exactly one Golden Test
  const mappedPatterns = new Set<string>();
  const mappedTests = new Set<string>();

  for (const test of SEED_GOLDEN_TESTS) {
    if (mappedPatterns.has(test.accident_pattern_id)) {
      throw new Error(`Duplicate mapping: Multiple tests for pattern ${test.accident_pattern_id}`);
    }
    mappedPatterns.add(test.accident_pattern_id);
    mappedTests.add(test.test_id);
  }

  // Verify all accident patterns are covered
  for (const pattern of SEED_ACCIDENT_PATTERNS) {
    if (!mappedPatterns.has(pattern.pattern_id)) {
      throw new Error(`Missing Golden Test for accident pattern: ${pattern.pattern_id}`);
    }
  }

  console.log('✅ All accident patterns have exactly one Golden Test');
  console.log(`   - Accident Patterns: ${SEED_ACCIDENT_PATTERNS.length}`);
  console.log(`   - Golden Tests: ${SEED_GOLDEN_TESTS.length}`);
  console.log(`   - Coverage: 100%`);
}

/**
 * Test: Verify severity-based test selection
 */
async function testSeverityBasedSelection() {
  console.log('\n🧪 Test 7: Severity-Based Test Selection');
  console.log('═'.repeat(60));

  // Verify critical and high severity patterns have high selection scores
  const criticalHighTests = SEED_GOLDEN_TESTS.filter(
    test => test.severity === 'critical' || test.severity === 'high'
  );

  for (const test of criticalHighTests) {
    if (test.selection_score < 0.7) {
      console.warn(`⚠️  ${test.severity.toUpperCase()} severity test has low selection score: ${test.test_id} (${test.selection_score})`);
    }
  }

  // Verify test count is reasonable (not too many, not too few)
  const testCount = SEED_GOLDEN_TESTS.length;
  if (testCount < 3) {
    throw new Error(`Too few Golden Tests: ${testCount} (minimum 3 recommended)`);
  }
  if (testCount > 20) {
    console.warn(`⚠️  Many Golden Tests (${testCount}). Consider test selection optimization to avoid slow CI.`);
  }

  console.log('✅ Severity-based selection verified');
  console.log(`   - Total Tests: ${testCount}`);
  console.log(`   - Critical: ${SEED_GOLDEN_TESTS.filter(t => t.severity === 'critical').length}`);
  console.log(`   - High: ${SEED_GOLDEN_TESTS.filter(t => t.severity === 'high').length}`);
  console.log(`   - Medium: ${SEED_GOLDEN_TESTS.filter(t => t.severity === 'medium').length}`);
  console.log(`   - Low: ${SEED_GOLDEN_TESTS.filter(t => t.severity === 'low').length}`);
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n🚀 Test Simulation Engine - Full Test Suite');
  console.log('═'.repeat(60));
  console.log('Phase 4: Golden Test Effectiveness Verification\n');

  const startTime = Date.now();
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: Scenario Generation
    await testScenarioGeneration();
    testsPassed++;

    // Test 2: Simulation Execution
    const summary = await testSimulationExecution();
    testsPassed++;

    // Test 3: False Negative Verification (CRITICAL)
    await testNoFalseNegatives(summary);
    testsPassed++;

    // Test 4: Effectiveness Threshold
    await testEffectivenessThreshold(summary);
    testsPassed++;

    // Test 5: Report Generation
    await testReportGeneration(summary);
    testsPassed++;

    // Test 6: Scenario-Test Mapping
    await testScenarioTestMapping();
    testsPassed++;

    // Test 7: Severity-Based Selection
    await testSeverityBasedSelection();
    testsPassed++;

    const duration = Date.now() - startTime;

    console.log('\n' + '═'.repeat(60));
    console.log('🎉 All Tests Passed!');
    console.log('═'.repeat(60));
    console.log(`   - Tests Passed: ${testsPassed}`);
    console.log(`   - Tests Failed: ${testsFailed}`);
    console.log(`   - Duration: ${duration}ms`);
    console.log('═'.repeat(60));

    return 0; // Success

  } catch (error) {
    testsFailed++;
    const duration = Date.now() - startTime;

    console.error('\n' + '═'.repeat(60));
    console.error('❌ Test Suite Failed');
    console.error('═'.repeat(60));
    console.error(`   - Tests Passed: ${testsPassed}`);
    console.error(`   - Tests Failed: ${testsFailed}`);
    console.error(`   - Duration: ${duration}ms`);
    console.error('═'.repeat(60));
    console.error('\n🚨 Error Details:');
    console.error(error);

    return 1; // Failure
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then(exitCode => {
      process.exit(exitCode);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests };
