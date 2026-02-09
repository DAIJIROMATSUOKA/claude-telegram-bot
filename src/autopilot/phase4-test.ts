/**
 * Phase 4 Integration Test
 *
 * Tests Confidence Router, Red Team, and Learning Log integration.
 *
 * Usage:
 *   bun run src/autopilot/phase4-test.ts
 */

import { ConfidenceRouter } from '../utils/confidence-router';
import { RedTeamValidator } from '../utils/red-team';
import { LearningLog } from '../utils/learning-log';
import type { PluginProposal } from './types';

const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';

console.log('='.repeat(60));
console.log('Phase 4 Integration Test');
console.log('='.repeat(60));
console.log('');

// ==================== Test Data ====================

const testProposals: PluginProposal[] = [
  // Test 1: High confidence maintenance task (should auto-approve)
  {
    task: {
      id: 'test_task_1',
      type: 'maintenance',
      title: 'Daily health check',
      description: 'Run system health check',
      reason: 'Scheduled maintenance',
      confidence: 0.95,
      impact: 'low',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Check system status', 'Verify all services', 'Report results'],
    estimated_duration: '30 seconds',
    risks: [],
    approval_required: false,
  },

  // Test 2: Low confidence predictive task (should trigger Red Team)
  {
    task: {
      id: 'test_task_2',
      type: 'predictive',
      title: 'Predict task completion',
      description: 'Predict when user will complete tasks',
      reason: 'Pattern detected in task completion times',
      confidence: 0.65,
      impact: 'medium',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Analyze historical data'],
    estimated_duration: '1 minute',
    risks: ['Prediction may be inaccurate'],
    approval_required: false,
  },

  // Test 3: High impact task (should trigger Red Team)
  {
    task: {
      id: 'test_task_3',
      type: 'optimization',
      title: 'Optimize database queries',
      description: 'Refactor slow database queries',
      reason: 'Performance issues detected',
      confidence: 0.85,
      impact: 'high',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Analyze query performance', 'Apply optimizations', 'Test changes'],
    estimated_duration: '5 minutes',
    risks: ['May affect application stability'],
    approval_required: true,
  },

  // Test 4: Recovery task with medium confidence (should pass)
  {
    task: {
      id: 'test_task_4',
      type: 'recovery',
      title: 'Restart failed service',
      description: 'Restart service that crashed',
      reason: 'Service failure detected',
      confidence: 0.75,
      impact: 'medium',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Stop service', 'Clear cache', 'Restart service', 'Verify status'],
    estimated_duration: '2 minutes',
    risks: ['Service may fail to restart'],
    approval_required: false,
  },

  // Test 5: Critical task with low confidence (should be rejected by Red Team)
  {
    task: {
      id: 'test_task_5',
      type: 'feature',
      title: 'Deploy new feature',
      description: 'Deploy untested feature to production',
      reason: 'User requested',
      confidence: 0.60,
      impact: 'critical',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Deploy feature'],
    estimated_duration: '10 minutes',
    risks: [],
    approval_required: false,
  },
];

// ==================== Test Confidence Router ====================

console.log('## Test 1: Confidence Router\n');

const router = new ConfidenceRouter();

for (const proposal of testProposals) {
  const result = router.route(proposal);
  const { task } = proposal;

  console.log(`Task: ${task.title}`);
  console.log(`  Type: ${task.type} | Confidence: ${task.confidence} | Impact: ${task.impact}`);
  console.log(`  Decision: ${result.decision}`);
  console.log(`  Threshold: ${result.threshold.toFixed(2)}`);
  console.log(`  Red Team: ${result.requiresRedTeam ? 'YES' : 'NO'}`);
  console.log(`  Reason: ${result.reason}`);
  console.log('');
}

// ==================== Test Red Team Validator ====================

console.log('## Test 2: Red Team Validator\n');

const redTeam = new RedTeamValidator();

for (const proposal of testProposals) {
  const routingResult = router.route(proposal);

  if (routingResult.requiresRedTeam) {
    const result = redTeam.validate(proposal);
    const { task } = proposal;

    console.log(`Task: ${task.title}`);
    console.log(`  Approved: ${result.approved ? '✅ YES' : '❌ NO'}`);
    console.log(`  Risk Score: ${result.risk_score.toFixed(2)}`);
    console.log(`  Confidence Adjustment: ${result.confidence_adjustment >= 0 ? '+' : ''}${result.confidence_adjustment.toFixed(2)}`);
    console.log(`  Issues: ${result.issues.length}`);

    if (result.issues.length > 0) {
      console.log('  Top Issues:');
      result.issues.slice(0, 3).forEach((issue) => {
        console.log(`    - [${issue.severity.toUpperCase()}] ${issue.message}`);
      });
    }

    if (result.recommendations.length > 0) {
      console.log('  Recommendations:');
      result.recommendations.slice(0, 2).forEach((rec) => {
        console.log(`    • ${rec}`);
      });
    }

    console.log('');
  }
}

// ==================== Test Learning Log ====================

console.log('## Test 3: Learning Log\n');

const learningLog = new LearningLog(MEMORY_GATEWAY_URL);

// Simulate recording success/failure
async function testLearningLog() {
  console.log('Recording test executions to Learning Log...\n');

  for (let i = 0; i < 3; i++) {
    const proposal = testProposals[i % testProposals.length]!;
    const routingResult = router.route(proposal!);
    const redTeamResult = routingResult.requiresRedTeam ? redTeam.validate(proposal!) : null;
    const executionTime = Math.random() * 5000 + 500; // 500-5500ms

    // Simulate 80% success rate
    const success = Math.random() < 0.8;

    if (success) {
      await learningLog.recordSuccess(
        proposal,
        routingResult,
        redTeamResult,
        executionTime
      );
      console.log(`✅ Recorded success: ${proposal!.task.title} (${executionTime.toFixed(0)}ms)`);
    } else {
      await learningLog.recordFailure(
        proposal!,
        routingResult,
        redTeamResult,
        executionTime,
        'Test error: Simulated failure'
      );
      console.log(`❌ Recorded failure: ${proposal!.task.title} (${executionTime.toFixed(0)}ms)`);
    }
  }

  console.log('');

  // Fetch statistics
  try {
    console.log('Fetching Learning Log statistics...\n');
    const stats = await learningLog.getStatistics();

    console.log('Statistics:');
    console.log(`  Total Executions: ${stats.total_executions}`);
    console.log(`  Success Count: ${stats.success_count}`);
    console.log(`  Failure Count: ${stats.failure_count}`);
    console.log(`  Success Rate: ${(stats.success_rate * 100).toFixed(1)}%`);
    console.log(`  Avg Execution Time: ${stats.avg_execution_time_ms.toFixed(0)}ms`);
    console.log('');

    if (Object.keys(stats.by_plugin).length > 0) {
      console.log('By Plugin:');
      for (const [plugin, data] of Object.entries(stats.by_plugin)) {
        console.log(`  ${plugin}: ${data.success}/${data.success + data.failure} (${(data.success_rate * 100).toFixed(1)}%)`);
      }
      console.log('');
    }

    if (Object.keys(stats.by_task_type).length > 0) {
      console.log('By Task Type:');
      for (const [type, data] of Object.entries(stats.by_task_type)) {
        console.log(`  ${type}: ${data.success}/${data.success + data.failure} (${(data.success_rate * 100).toFixed(1)}%)`);
      }
      console.log('');
    }
  } catch (error) {
    console.error('❌ Failed to fetch statistics:', error);
  }
}

// ==================== Test Analytics ====================

console.log('## Test 4: Analytics\n');

// Analyze proposals
const analytics = router.analyzeProposals(testProposals);

console.log('Proposal Analytics:');
console.log(`  Total: ${analytics.total}`);
console.log(`  Auto Approved: ${analytics.autoApproved} (${((analytics.autoApproved / analytics.total) * 100).toFixed(1)}%)`);
console.log(`  Review Required: ${analytics.reviewRequired} (${((analytics.reviewRequired / analytics.total) * 100).toFixed(1)}%)`);
console.log(`  Red Team Required: ${analytics.redTeamRequired} (${((analytics.redTeamRequired / analytics.total) * 100).toFixed(1)}%)`);
console.log(`  Average Confidence: ${analytics.averageConfidence.toFixed(2)}`);
console.log('');

console.log('By Task Type:');
for (const [type, count] of Object.entries(analytics.byTaskType)) {
  console.log(`  ${type}: ${count}`);
}
console.log('');

// ==================== Run Learning Log Test ====================

testLearningLog()
  .then(() => {
    console.log('='.repeat(60));
    console.log('✅ Phase 4 Integration Test Complete');
    console.log('='.repeat(60));
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
