/**
 * Golden Test Framework - Type Definitions (Phase 3: Autopilot CI)
 *
 * Purpose: Prevent past accident patterns from recurring
 * Philosophy: "Ensure past accidents never happen again"
 *
 * Based on AI Council consensus:
 * - Test Selection: 3-axis scoring (重要度50% > 影響範囲30% > 頻度20%)
 * - Flaky Detection: 3-stage retry + Quarantine
 * - Kill Switch: 重要度別閾値（Critical: 即時, High: 2連続, Medium: 3連続）
 */

/**
 * Golden Test - Regression test from past accident pattern
 */
export interface GoldenTest {
  test_id: string; // Unique test identifier
  title: string; // Test name (e.g., "Prevent file overwrite without backup")
  description: string; // What this test validates

  // Test selection criteria (AI Council consensus)
  severity: 'low' | 'medium' | 'high' | 'critical'; // 重要度 (50%)
  blast_radius: 'file' | 'directory' | 'project' | 'system'; // 影響範囲 (30%)
  frequency: number; // 発生回数 (20%)
  selection_score: number; // 0.0-1.0, calculated from 3 axes

  // Test structure (Given-When-Then)
  given: string; // Initial state
  when: string; // Action being tested
  then: string; // Expected safe outcome

  // Test execution
  test_function: string; // TypeScript function code
  timeout_ms: number; // Test timeout

  // Flaky detection
  flaky_status: 'stable' | 'suspect' | 'quarantined'; // Current status
  failure_count: number; // Consecutive failures
  retry_count: number; // Current retry attempt (0-2)
  last_failure_at?: string; // ISO timestamp

  // Kill Switch integration
  kill_switch_threshold: 'immediate' | 'delayed' | 'warning'; // Based on severity

  // Coverage tracking
  accident_pattern_id: string; // Link to original accident
  last_tested_at?: string; // ISO timestamp
  times_prevented: number; // How many times this test caught issues

  // Metadata
  created_at: string; // ISO timestamp
  source: 'conversation_log' | 'manual' | 'synthetic'; // Test origin
  tags: string[]; // Categorization
}

/**
 * Accident Pattern - Extracted from conversation logs
 */
export interface AccidentPattern {
  pattern_id: string; // Unique pattern identifier
  title: string; // Human-readable title
  description: string; // What went wrong

  // Severity assessment
  severity: 'low' | 'medium' | 'high' | 'critical';
  blast_radius: 'file' | 'directory' | 'project' | 'system';

  // Occurrence tracking
  first_occurred_at: string; // ISO timestamp
  last_occurred_at: string; // ISO timestamp
  occurrence_count: number; // How many times this happened

  // Root cause
  root_cause: string; // Technical explanation
  trigger_conditions: string[]; // What caused it

  // Prevention
  golden_test_id?: string; // Test that prevents this
  fixed_at?: string; // ISO timestamp when fixed

  // Source data
  conversation_ids: string[]; // Telegram conversation IDs
  extracted_from: 'telegram_log' | 'error_log' | 'manual_report';

  // Metadata
  created_at: string;
  updated_at: string;
}

/**
 * Test Execution Result
 */
export interface TestExecutionResult {
  test_id: string;
  execution_id: string; // Unique execution identifier

  // Execution
  executed_at: string; // ISO timestamp
  duration_ms: number;

  // Result
  status: 'passed' | 'failed' | 'flaky' | 'timeout';
  error_message?: string;
  stack_trace?: string;

  // Retry tracking
  retry_attempt: number; // 0 = first attempt, 1-2 = retries
  is_final_attempt: boolean;

  // Context
  execution_scope: 'pre_execution' | 'post_execution' | 'manual';
  plan_bundle_id?: string; // If triggered by PlanBundle
}

/**
 * Test Suite - Collection of Golden Tests
 */
export interface TestSuite {
  suite_id: string;
  name: string;
  description: string;

  // Tests
  test_ids: string[]; // Golden Test IDs
  total_tests: number;

  // Execution stats
  last_run_at?: string;
  pass_rate: number; // 0.0-1.0
  flaky_test_count: number;
  quarantined_test_count: number;

  // Coverage
  accident_patterns_covered: number;
  accident_patterns_total: number;
  coverage_percentage: number; // 0-100

  // Metadata
  created_at: string;
  updated_at: string;
}

/**
 * Flaky Test Report
 */
export interface FlakyTestReport {
  test_id: string;
  test_title: string;

  // Flaky detection
  detection_date: string; // ISO timestamp
  failure_pattern: string; // Description of inconsistency

  // Statistics
  total_runs: number;
  failures: number;
  flaky_rate: number; // 0.0-1.0

  // Quarantine decision
  quarantined: boolean;
  quarantine_reason?: string;
  quarantine_date?: string;

  // Resolution
  stabilization_pr?: string; // PR number that fixed the flakiness
  restored_at?: string; // ISO timestamp when restored to stable
  consecutive_passes_after_fix: number; // Must reach 20 to restore
}

/**
 * Kill Switch Decision
 */
export interface KillSwitchDecision {
  decision_id: string;

  // Trigger
  triggered_by: 'test_failure' | 'policy_violation' | 'manual';
  test_id?: string;
  plan_bundle_id?: string;

  // Decision
  action: 'activate' | 'delay' | 'warning_only';
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';

  // Threshold logic (AI Council consensus)
  threshold_type: 'immediate' | 'delayed' | 'warning';
  failure_count: number; // How many failures led to this decision
  time_window_minutes: number; // Time window for counting failures

  // Execution
  decided_at: string; // ISO timestamp
  activated_at?: string; // ISO timestamp (if action = 'activate')
  deactivated_at?: string; // ISO timestamp

  // Impact
  scope_affected: 'test' | 'canary' | 'production';
  plans_blocked: number; // How many PlanBundles were blocked
}

/**
 * Test Coverage Metrics
 */
export interface TestCoverageMetrics {
  // Overall coverage
  total_accident_patterns: number;
  covered_accident_patterns: number;
  coverage_percentage: number; // 0-100

  // By severity
  critical_covered: number;
  critical_total: number;
  high_covered: number;
  high_total: number;
  medium_covered: number;
  medium_total: number;
  low_covered: number;
  low_total: number;

  // Gaps
  uncovered_patterns: AccidentPattern[];

  // Recommendations
  recommended_new_tests: string[]; // Test titles that should be created

  // Metadata
  calculated_at: string; // ISO timestamp
}

/**
 * Test Selection Criteria (AI Council consensus)
 */
export interface TestSelectionCriteria {
  // 3-axis scoring
  severity_weight: number; // Default: 0.5 (50%)
  blast_radius_weight: number; // Default: 0.3 (30%)
  frequency_weight: number; // Default: 0.2 (20%)

  // Thresholds
  minimum_score: number; // Default: 0.6 (top 60% of accidents become tests)
  maximum_tests: number; // Default: 20 (to avoid slow CI)

  // Selection logic
  force_include_severity: ('critical' | 'high')[]; // Always include these
  exclude_low_frequency: boolean; // Exclude accidents that happened only once
}

/**
 * Quarantine Test Result
 */
export interface QuarantineTestResult {
  test_id: string;

  // Quarantine status
  status: 'active' | 'fixing' | 'restored';
  quarantined_at: string; // ISO timestamp
  restored_at?: string; // ISO timestamp

  // Stabilization tracking
  consecutive_passes: number; // Current streak (need 20 to restore)
  last_run_at: string;

  // Weekly execution
  next_scheduled_run: string; // ISO timestamp
}
