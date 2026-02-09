/**
 * Golden Test Engine - Phase 3: Autopilot CI
 *
 * Purpose: Execute Golden Tests and prevent past accidents from recurring
 * Philosophy: "Ensure past accidents never happen again"
 *
 * AI Council Consensus Implementation:
 * - Test Selection: 3-axis scoring (Severity 50%, Blast Radius 30%, Frequency 20%)
 * - Flaky Detection: 3-stage retry + Quarantine (suspect after 3 failures)
 * - Kill Switch: Severity-based thresholds (Critical: immediate, High: 2x, Medium: 3x)
 */

import type {
  GoldenTest,
  TestExecutionResult,
  FlakyTestReport,
  KillSwitchDecision,
  TestCoverageMetrics,
  QuarantineTestResult,
} from './golden-test-types';
import type { PlanBundle } from './types';
import { PolicyEngine } from './policy-engine';

export class GoldenTestEngine {
  private policyEngine: PolicyEngine;
  private readonly MEMORY_GATEWAY_URL: string;

  // Cached tests for test simulation
  private cachedTests: GoldenTest[] | null = null;

  // Flaky detection thresholds (AI Council consensus)
  private readonly FLAKY_FAILURE_THRESHOLD = 3; // 3 consecutive failures → quarantine
  private readonly QUARANTINE_PASS_REQUIREMENT = 20; // 20 consecutive passes → restore
  private readonly RETRY_DELAYS_MS = [0, 5000]; // Immediate, then 5s delay

  // Kill Switch thresholds (AI Council consensus)
  private readonly KILL_SWITCH_THRESHOLDS = {
    critical: { failures: 1, window_minutes: 0 }, // Immediate
    high: { failures: 2, window_minutes: 5 }, // 2 failures in 5 minutes
    medium: { failures: 3, window_minutes: 5 }, // 3 failures in 5 minutes
    low: { failures: 0, window_minutes: 0 }, // Warning only
  };

  constructor(memoryGatewayUrlOrOptions: string | { memoryGatewayUrl: string }) {
    // Support both string and options object for backward compatibility
    if (typeof memoryGatewayUrlOrOptions === 'string') {
      this.MEMORY_GATEWAY_URL = memoryGatewayUrlOrOptions;
    } else {
      this.MEMORY_GATEWAY_URL = memoryGatewayUrlOrOptions.memoryGatewayUrl;
    }
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Cache Golden Tests for test simulation (Phase 4)
   */
  cacheTests(tests: GoldenTest[]): void {
    this.cachedTests = tests;
  }

  /**
   * Execute all Golden Tests before PlanBundle execution
   * Returns: true if all tests pass, false if any test fails (triggering Kill Switch)
   *
   * @param bundle - The PlanBundle to test
   * @param explicitTests - Optional: Explicit tests to run (for test simulation). If not provided, tests are selected automatically.
   */
  async executePreExecutionTests(
    bundle: PlanBundle,
    explicitTests?: GoldenTest[]
  ): Promise<{
    all_passed: boolean;
    results: TestExecutionResult[];
    total_tests: number;
    failed_tests: number;
    kill_switch_decision?: KillSwitchDecision;
  }> {
    console.log(`[GoldenTestEngine] Running pre-execution tests for PlanBundle ${bundle.plan_id}`);

    // Get relevant Golden Tests based on PlanBundle characteristics or use explicit tests
    const tests = explicitTests || this.cachedTests || await this.selectRelevantTests(bundle);
    console.log(`[GoldenTestEngine] Selected ${tests.length} relevant tests`);

    const results: TestExecutionResult[] = [];
    let failedTests: GoldenTest[] = [];

    // Execute each test with retry logic
    for (const test of tests) {
      const result = await this.executeTestWithRetry(test, bundle.plan_id);
      results.push(result);

      if (result.status === 'failed') {
        failedTests.push(test);
      }
    }

    // Determine Kill Switch action
    const killSwitchDecision = await this.evaluateKillSwitch(failedTests, bundle);

    const allPassed = failedTests.length === 0;

    return {
      all_passed: allPassed,
      results,
      total_tests: tests.length,
      failed_tests: failedTests.length,
      kill_switch_decision: killSwitchDecision,
    };
  }

  /**
   * Execute a single test with retry logic (AI Council consensus: 3-stage retry)
   */
  private async executeTestWithRetry(
    test: GoldenTest,
    planBundleId: string
  ): Promise<TestExecutionResult> {
    const maxRetries = this.RETRY_DELAYS_MS.length + 1; // 1 initial + 2 retries = 3 attempts

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Delay before retry (no delay on first attempt)
      if (attempt > 0) {
        const delay = this.RETRY_DELAYS_MS[attempt - 1];
        console.log(`[GoldenTestEngine] Retrying test ${test.test_id} after ${delay}ms delay`);
        await this.sleep(delay ?? 0);
      }

      const result = await this.executeSingleTest(test, planBundleId, attempt);

      // If passed, return immediately
      if (result.status === 'passed') {
        // Reset flaky tracking on success
        if (test.flaky_status !== 'stable') {
          await this.updateFlakyStatus(test, 'success');
        }
        return result;
      }

      // If final attempt, mark as failed
      if (attempt === maxRetries - 1) {
        // Update flaky tracking
        await this.updateFlakyStatus(test, 'failure');
        return result;
      }
    }

    // Should never reach here, but TypeScript needs this
    throw new Error(`Test ${test.test_id} exhausted retries without result`);
  }

  /**
   * Execute a single test (one attempt)
   */
  private async executeSingleTest(
    test: GoldenTest,
    planBundleId: string,
    retryAttempt: number
  ): Promise<TestExecutionResult> {
    const executionId = `exec_${test.test_id}_${Date.now()}_${retryAttempt}`;
    const startTime = Date.now();

    try {
      console.log(`[GoldenTestEngine] Executing test ${test.test_id} (attempt ${retryAttempt + 1})`);

      // Execute the test function
      // Note: In production, this would dynamically evaluate test.test_function
      // For now, we'll simulate test execution
      const passed = await this.runTestFunction(test);

      const duration = Date.now() - startTime;

      const result: TestExecutionResult = {
        test_id: test.test_id,
        execution_id: executionId,
        executed_at: new Date().toISOString(),
        duration_ms: duration,
        status: passed ? 'passed' : 'failed',
        retry_attempt: retryAttempt,
        is_final_attempt: retryAttempt === 2,
        execution_scope: 'pre_execution',
        plan_bundle_id: planBundleId,
      };

      // Store result in Memory Gateway
      await this.storeTestResult(result);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const result: TestExecutionResult = {
        test_id: test.test_id,
        execution_id: executionId,
        executed_at: new Date().toISOString(),
        duration_ms: duration,
        status: duration > test.timeout_ms ? 'timeout' : 'failed',
        error_message: errorMessage,
        stack_trace: error instanceof Error ? error.stack : undefined,
        retry_attempt: retryAttempt,
        is_final_attempt: retryAttempt === 2,
        execution_scope: 'pre_execution',
        plan_bundle_id: planBundleId,
      };

      await this.storeTestResult(result);
      return result;
    }
  }

  /**
   * Run the test function
   * Note: In production, this would use vm or isolated-vm for safe eval
   */
  private async runTestFunction(test: GoldenTest): Promise<boolean> {
    // TODO: Implement safe test function execution
    // For now, simulate success based on test characteristics

    // Simulate test execution time
    await this.sleep(Math.random() * 100);

    // Simulate 95% pass rate for stable tests, lower for flaky
    if (test.flaky_status === 'stable') {
      return Math.random() > 0.05;
    } else if (test.flaky_status === 'suspect') {
      return Math.random() > 0.3;
    } else {
      // Quarantined tests not executed in pre-execution
      return true;
    }
  }

  /**
   * Select relevant Golden Tests for a PlanBundle
   */
  private async selectRelevantTests(bundle: PlanBundle): Promise<GoldenTest[]> {
    // TODO: Implement intelligent test selection
    // For now, return all stable tests that match the bundle's risk profile

    const allTests = await this.loadGoldenTests();

    // Filter out quarantined tests (they run weekly, not pre-execution)
    const stableTests = allTests.filter(
      (test) => test.flaky_status === 'stable' || test.flaky_status === 'suspect'
    );

    // Match tests to bundle severity
    const impactLevels: { [key: string]: number } = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    const bundleImpact = impactLevels[bundle.impact] || 0;

    return stableTests.filter((test) => {
      const testImpact = impactLevels[test.severity] || 0;
      // Run tests at or below bundle impact level
      return testImpact <= bundleImpact;
    });
  }

  /**
   * Evaluate Kill Switch decision based on failed tests (AI Council consensus)
   */
  private async evaluateKillSwitch(
    failedTests: GoldenTest[],
    bundle: PlanBundle
  ): Promise<KillSwitchDecision | undefined> {
    if (failedTests.length === 0) {
      return undefined;
    }

    // Find highest severity among failed tests
    const severities: ('critical' | 'high' | 'medium' | 'low')[] = ['critical', 'high', 'medium', 'low'];
    let highestSeverity: 'critical' | 'high' | 'medium' | 'low' = 'low';

    for (const test of failedTests) {
      const testSeverityIndex = severities.indexOf(test.severity);
      const currentSeverityIndex = severities.indexOf(highestSeverity);
      if (testSeverityIndex < currentSeverityIndex) {
        highestSeverity = test.severity;
      }
    }

    const threshold = this.KILL_SWITCH_THRESHOLDS[highestSeverity];

    // Get recent failure count for this severity
    const recentFailures = await this.getRecentFailureCount(
      highestSeverity,
      threshold.window_minutes
    );

    // Determine action based on AI Council consensus
    let action: 'activate' | 'delay' | 'warning_only';
    let thresholdType: 'immediate' | 'delayed' | 'warning';

    if (highestSeverity === 'critical') {
      // Critical: Immediate Kill Switch
      action = 'activate';
      thresholdType = 'immediate';
    } else if (highestSeverity === 'high' && recentFailures >= threshold.failures) {
      // High: 2 failures in 5 minutes → activate
      action = 'activate';
      thresholdType = 'delayed';
    } else if (highestSeverity === 'medium' && recentFailures >= threshold.failures) {
      // Medium: 3 failures in 5 minutes → activate
      action = 'activate';
      thresholdType = 'delayed';
    } else if (highestSeverity === 'low') {
      // Low: Warning only
      action = 'warning_only';
      thresholdType = 'warning';
    } else {
      // Not enough failures yet, delay
      action = 'delay';
      thresholdType = 'delayed';
    }

    const decision: KillSwitchDecision = {
      decision_id: `kill_${bundle.plan_id}_${Date.now()}`,
      triggered_by: 'test_failure',
      test_id: failedTests[0]!.test_id,
      plan_bundle_id: bundle.plan_id,
      action,
      reason: `${failedTests.length} Golden Test(s) failed with severity ${highestSeverity}`,
      severity: highestSeverity,
      threshold_type: thresholdType,
      failure_count: recentFailures + 1,
      time_window_minutes: threshold.window_minutes,
      decided_at: new Date().toISOString(),
      activated_at: action === 'activate' ? new Date().toISOString() : undefined,
      scope_affected: bundle.scope,
      plans_blocked: action === 'activate' ? 1 : 0,
    };

    // Store decision in Memory Gateway
    await this.storeKillSwitchDecision(decision);

    return decision;
  }

  /**
   * Update flaky status tracking
   */
  private async updateFlakyStatus(test: GoldenTest, outcome: 'success' | 'failure'): Promise<void> {
    if (outcome === 'failure') {
      test.failure_count++;
      test.last_failure_at = new Date().toISOString();

      if (test.failure_count >= this.FLAKY_FAILURE_THRESHOLD) {
        test.flaky_status = 'quarantined';
        console.log(`[GoldenTestEngine] Test ${test.test_id} quarantined after ${test.failure_count} failures`);
        await this.createFlakyReport(test);
      } else if (test.failure_count >= 2) {
        test.flaky_status = 'suspect';
      }
    } else {
      // Success resets consecutive failure count
      test.failure_count = 0;
      if (test.flaky_status === 'suspect') {
        test.flaky_status = 'stable';
      }
    }

    await this.updateGoldenTest(test);
  }

  /**
   * Get recent failure count within time window
   */
  private async getRecentFailureCount(severity: string, windowMinutes: number): Promise<number> {
    if (windowMinutes === 0) {
      return 0;
    }

    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    try {
      const response = await fetch(
        `${this.MEMORY_GATEWAY_URL}/v1/memory/query?` +
          `scope_prefix=private/jarvis/golden_tests/failures&` +
          `since=${since}&` +
          `tags=${severity}`
      );

      if (!response.ok) {
        console.error('[GoldenTestEngine] Failed to query recent failures');
        return 0;
      }

      const data = await response.json() as any;
      return data.items?.length || 0;
    } catch (error) {
      console.error('[GoldenTestEngine] Error querying recent failures:', error);
      return 0;
    }
  }

  /**
   * Storage operations (Memory Gateway)
   */
  private async storeTestResult(result: TestExecutionResult): Promise<void> {
    try {
      await fetch(`${this.MEMORY_GATEWAY_URL}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: `private/jarvis/golden_tests/executions`,
          type: 'test_execution',
          title: `Test ${result.test_id}: ${result.status}`,
          content: JSON.stringify(result, null, 2),
          tags: [result.status, result.test_id],
          importance: result.status === 'failed' ? 7 : 3,
          source_agent: 'jarvis',
        }),
      });
    } catch (error) {
      console.error('[GoldenTestEngine] Failed to store test result:', error);
    }
  }

  private async storeKillSwitchDecision(decision: KillSwitchDecision): Promise<void> {
    try {
      await fetch(`${this.MEMORY_GATEWAY_URL}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: `private/jarvis/golden_tests/kill_switch`,
          type: 'kill_switch_decision',
          title: `Kill Switch: ${decision.action} (${decision.severity})`,
          content: JSON.stringify(decision, null, 2),
          tags: [decision.action, decision.severity, 'kill_switch'],
          importance: decision.action === 'activate' ? 9 : 5,
          pin: decision.action === 'activate',
          source_agent: 'jarvis',
        }),
      });
    } catch (error) {
      console.error('[GoldenTestEngine] Failed to store Kill Switch decision:', error);
    }
  }

  private async createFlakyReport(test: GoldenTest): Promise<void> {
    const report: FlakyTestReport = {
      test_id: test.test_id,
      test_title: test.title,
      detection_date: new Date().toISOString(),
      failure_pattern: `${test.failure_count} consecutive failures detected`,
      total_runs: test.times_prevented + test.failure_count,
      failures: test.failure_count,
      flaky_rate: test.failure_count / (test.times_prevented + test.failure_count),
      quarantined: true,
      quarantine_reason: `Exceeded failure threshold (${this.FLAKY_FAILURE_THRESHOLD} failures)`,
      quarantine_date: new Date().toISOString(),
      consecutive_passes_after_fix: 0,
    };

    try {
      await fetch(`${this.MEMORY_GATEWAY_URL}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: `private/jarvis/golden_tests/flaky_reports`,
          type: 'flaky_report',
          title: `Flaky Test Quarantined: ${test.title}`,
          content: JSON.stringify(report, null, 2),
          tags: ['flaky', 'quarantined', test.test_id],
          importance: 7,
          pin: true,
          source_agent: 'jarvis',
        }),
      });
    } catch (error) {
      console.error('[GoldenTestEngine] Failed to create flaky report:', error);
    }
  }

  /**
   * Placeholder methods (to be implemented with actual storage)
   */
  private async loadGoldenTests(): Promise<GoldenTest[]> {
    // TODO: Load from Memory Gateway
    return [];
  }

  private async updateGoldenTest(test: GoldenTest): Promise<void> {
    // TODO: Update in Memory Gateway
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
