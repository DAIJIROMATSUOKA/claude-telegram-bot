/**
 * Phase 2 Policy Engine Test - JARVIS MESH
 *
 * Purpose: Verify Policy Engine validates PlanBundles correctly
 */

import { PolicyEngine } from '../autopilot/policy-engine';
import type { PlanBundle } from '../autopilot/types';

async function main() {
  console.log('='.repeat(80));
  console.log('Phase 2 Policy Engine Test - JARVIS MESH');
  console.log('='.repeat(80));

  const policyEngine = new PolicyEngine();

  // Test 1: Complete valid bundle
  console.log('\n[Test 1] Complete Valid Bundle');
  const validBundle: PlanBundle = {
    plan_id: 'test-001',
    title: 'Open project file',
    scope: 'test',
    confidence: 0.95,
    impact: 'low',
    evidence: {
      rationale: 'User requested to open the project file',
      supporting_data: ['User message: "open project file"', 'File exists at /path/to/project'],
      precedents: ['Previously opened files successfully 10 times'],
    },
    actions: [
      {
        action_id: 'action-001',
        type: 'open_url',
        description: 'Open file in VSCode',
        parameters: { path: '/path/to/project' },
        idempotency_key: 'open-project-2026-02-04-001',
        rollback_plan: {
          can_rollback: false,
          automatic_steps: [],
          manual_instructions: ['Close the file manually if needed'],
        },
        target_device: 'm3',
      },
    ],
    risk: {
      level: 'low',
      risks: [
        {
          description: 'File might not exist',
          likelihood: 'low',
          impact: 'low',
          mitigation: 'Check file existence before opening',
        },
      ],
      mitigations: ['Verify file exists', 'Handle file not found error gracefully'],
      worst_case: 'File not found error displayed to user',
      blast_radius: 'single_file',
    },
    created_at: new Date().toISOString(),
  };

  const validResult = await policyEngine.validate(validBundle);
  console.log(`  Valid: ${validResult.valid}`);
  console.log(`  Score: ${(validResult.score * 100).toFixed(0)}%`);
  console.log(`  Violations: ${validResult.violations.length}`);
  console.log(`  Warnings: ${validResult.warnings.length}`);
  if (validResult.warnings.length > 0) {
    console.log(`  Warnings: ${validResult.warnings.join(', ')}`);
  }

  // Test 2: Missing evidence
  console.log('\n[Test 2] Missing Evidence');
  const missingEvidenceBundle: PlanBundle = {
    ...validBundle,
    plan_id: 'test-002',
    evidence: {
      rationale: '', // EMPTY
      supporting_data: [], // EMPTY
    },
  };

  const missingEvidenceResult = await policyEngine.validate(missingEvidenceBundle);
  console.log(`  Valid: ${missingEvidenceResult.valid}`);
  console.log(`  Score: ${(missingEvidenceResult.score * 100).toFixed(0)}%`);
  console.log(`  Violations: ${missingEvidenceResult.violations.length}`);
  for (const violation of missingEvidenceResult.violations) {
    console.log(`    - [${violation.severity}] ${violation.description}`);
  }

  // Test 3: Missing idempotency key
  console.log('\n[Test 3] Missing Idempotency Key');
  const missingIdempotencyBundle: PlanBundle = {
    ...validBundle,
    plan_id: 'test-003',
    actions: [
      {
        ...validBundle.actions[0]!,
        idempotency_key: '', // EMPTY
      } as any,
    ],
  };

  const missingIdempotencyResult = await policyEngine.validate(missingIdempotencyBundle);
  console.log(`  Valid: ${missingIdempotencyResult.valid}`);
  console.log(`  Score: ${(missingIdempotencyResult.score * 100).toFixed(0)}%`);
  console.log(`  Violations: ${missingIdempotencyResult.violations.length}`);
  for (const violation of missingIdempotencyResult.violations) {
    console.log(`    - [${violation.severity}] ${violation.description}`);
  }

  // Test 4: Critical impact without approval
  console.log('\n[Test 4] Critical Impact Without Approval');
  const criticalImpactBundle: PlanBundle = {
    ...validBundle,
    plan_id: 'test-004',
    impact: 'critical', // CRITICAL
    decision: undefined, // NO APPROVAL
  };

  const criticalImpactResult = await policyEngine.validate(criticalImpactBundle);
  console.log(`  Valid: ${criticalImpactResult.valid}`);
  console.log(`  Score: ${(criticalImpactResult.score * 100).toFixed(0)}%`);
  console.log(`  Violations: ${criticalImpactResult.violations.length}`);
  for (const violation of criticalImpactResult.violations) {
    console.log(`    - [${violation.severity}] ${violation.description}`);
  }

  // Test 5: High risk without mitigations
  console.log('\n[Test 5] High Risk Without Mitigations');
  const highRiskBundle: PlanBundle = {
    ...validBundle,
    plan_id: 'test-005',
    risk: {
      level: 'critical', // CRITICAL
      risks: [
        {
          description: 'Could delete all files',
          likelihood: 'high',
          impact: 'critical',
        },
      ],
      mitigations: [], // NO MITIGATIONS
      worst_case: 'All files deleted',
      blast_radius: 'system',
    },
  };

  const highRiskResult = await policyEngine.validate(highRiskBundle);
  console.log(`  Valid: ${highRiskResult.valid}`);
  console.log(`  Score: ${(highRiskResult.score * 100).toFixed(0)}%`);
  console.log(`  Violations: ${highRiskResult.violations.length}`);
  for (const violation of highRiskResult.violations) {
    console.log(`    - [${violation.severity}] ${violation.description}`);
  }

  // Test 6: Requires user approval check
  console.log('\n[Test 6] Requires User Approval Check');
  console.log(`  Valid bundle requires approval: ${policyEngine.requiresUserApproval(validBundle)}`);
  console.log(`  Critical impact requires approval: ${policyEngine.requiresUserApproval(criticalImpactBundle)}`);
  console.log(`  High risk requires approval: ${policyEngine.requiresUserApproval(highRiskBundle)}`);

  // Test 7: Approval request generation
  console.log('\n[Test 7] Approval Request Generation');
  const approvalRequest = policyEngine.generateApprovalRequest(criticalImpactBundle, criticalImpactResult);
  console.log(approvalRequest);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));

  const tests = [
    { name: 'Complete Valid Bundle', passed: validResult.valid && validResult.score === 1.0 },
    { name: 'Missing Evidence Detection', passed: !missingEvidenceResult.valid && missingEvidenceResult.violations.length > 0 },
    { name: 'Missing Idempotency Detection', passed: !missingIdempotencyResult.valid },
    { name: 'Critical Impact Detection', passed: !criticalImpactResult.valid },
    { name: 'High Risk Detection', passed: !highRiskResult.valid },
    { name: 'User Approval Logic', passed: !policyEngine.requiresUserApproval(validBundle) && policyEngine.requiresUserApproval(criticalImpactBundle) },
    { name: 'Approval Request Generation', passed: approvalRequest.includes('Approval Required') },
  ];

  let passedTests = 0;
  for (const test of tests) {
    console.log(`  ${test.passed ? '✅' : '❌'} ${test.name}`);
    if (test.passed) passedTests++;
  }

  console.log(`\nResult: ${passedTests}/${tests.length} tests passed`);

  if (passedTests === tests.length) {
    console.log('\n🎉 Phase 2 Policy Engine Test: PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ Phase 2 Policy Engine Test: FAILED');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
