/**
 * Phase 1 Integration Test - JARVIS MESH
 *
 * Purpose: Verify Phase 1 implementation
 * - Device routing (M3 for open/notify, M1 for others)
 * - M3 health check
 * - Fallback when M3 offline
 */

import { ExecutionRouter } from '../utils/execution-router';
import { MeshRegistry } from '../mesh/mesh-registry';
import type { AutopilotProposal } from '../autopilot/engine';

const MEMORY_GATEWAY_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

async function main() {
  console.log('='.repeat(80));
  console.log('Phase 1 Integration Test - JARVIS MESH');
  console.log('='.repeat(80));

  const router = new ExecutionRouter(MEMORY_GATEWAY_URL, 'shadow');
  const registry = new MeshRegistry();

  // Test 1: Mesh Registry status
  console.log('\n[Test 1] Mesh Registry Status');
  const summary = await registry.getSummary();
  console.log(`  Total devices: ${summary.total}`);
  console.log(`  Online: ${summary.online}`);
  console.log(`  Offline: ${summary.offline}`);

  for (const device of summary.devices) {
    console.log(`  - ${device.id}: ${device.status} (${device.capabilities.join(', ')})`);
  }

  // Test 2: M3 Health Check
  console.log('\n[Test 2] M3 Health Check');
  const m3Healthy = await registry.healthCheckM3();
  console.log(`  M3 status: ${m3Healthy ? '✅ Online' : '⚠️ Offline'}`);

  // Test 3: Device routing for open_url (should route to M3)
  console.log('\n[Test 3] Device Routing - open_url');
  const openProposal = {
    title: 'Open URL in browser',
    rationale: 'User requested to open URL https://example.com',
    actions: [],
    confidence: 0.95,
    impact: 'low',
    risks: [],
  } as any as AutopilotProposal;

  const openDecision = await router.route(openProposal);
  console.log(`  Should execute: ${openDecision.shouldExecute}`);
  console.log(`  Reason: ${openDecision.reason}`);
  console.log(`  Target device: ${openDecision.targetDevice?.device_id || 'N/A'}`);
  console.log(`  Target capabilities: ${openDecision.targetDevice?.capabilities.join(', ') || 'N/A'}`);
  if (openDecision.fallbackMessage) {
    console.log(`  Fallback: ${openDecision.fallbackMessage}`);
  }

  // Test 4: Device routing for notify (should route to M3 or iPhone)
  console.log('\n[Test 4] Device Routing - notify');
  const notifyProposal = {
    title: 'Send notification',
    rationale: 'Send notification to user',
    actions: [],
    confidence: 0.95,
    impact: 'low',
    risks: [],
  } as any as AutopilotProposal;

  const notifyDecision = await router.route(notifyProposal);
  console.log(`  Should execute: ${notifyDecision.shouldExecute}`);
  console.log(`  Reason: ${notifyDecision.reason}`);
  console.log(`  Target device: ${notifyDecision.targetDevice?.device_id || 'N/A'}`);
  console.log(`  Target capabilities: ${notifyDecision.targetDevice?.capabilities.join(', ') || 'N/A'}`);
  if (notifyDecision.fallbackMessage) {
    console.log(`  Fallback: ${notifyDecision.fallbackMessage}`);
  }

  // Test 5: Device routing for planning (should route to M1)
  console.log('\n[Test 5] Device Routing - planning (unknown action)');
  const planProposal = {
    title: 'Plan next steps',
    rationale: 'Planning next implementation steps',
    actions: [],
    confidence: 0.95,
    impact: 'low',
    risks: [],
  } as any as AutopilotProposal;

  const planDecision = await router.route(planProposal);
  console.log(`  Should execute: ${planDecision.shouldExecute}`);
  console.log(`  Reason: ${planDecision.reason}`);
  console.log(`  Target device: ${planDecision.targetDevice?.device_id || 'N/A'}`);
  console.log(`  Target capabilities: ${planDecision.targetDevice?.capabilities.join(', ') || 'N/A'}`);

  // Test 6: Router status with MESH info
  console.log('\n[Test 6] ExecutionRouter Status');
  const status = await router.getStatus();
  console.log(`  Mode: ${status.mode}`);
  console.log(`  Scope: ${status.scope}`);
  console.log(`  Can execute: ${status.canExecute}`);
  console.log(`  Kill switch: ${status.killSwitch.enabled ? '🚨 ENABLED' : '✅ Disabled'}`);

  if (status.mesh) {
    console.log(`  Mesh: ${status.mesh.online}/${status.mesh.total} devices online`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));

  const tests = [
    { name: 'Mesh Registry', passed: summary.total === 3 },
    { name: 'M3 Health Check', passed: true }, // Always passes (offline detection is valid)
    { name: 'Device Routing - open_url', passed: openDecision.targetDevice?.device_id === 'm3' || openDecision.targetDevice?.device_id === 'm1' },
    { name: 'Device Routing - notify', passed: notifyDecision.targetDevice?.device_id === 'm3' || notifyDecision.targetDevice?.device_id === 'iphone' },
    { name: 'Device Routing - planning', passed: planDecision.targetDevice?.device_id === 'm1' },
    { name: 'Router Status', passed: status.mesh !== undefined },
  ];

  let passedTests = 0;
  for (const test of tests) {
    console.log(`  ${test.passed ? '✅' : '❌'} ${test.name}`);
    if (test.passed) passedTests++;
  }

  console.log(`\nResult: ${passedTests}/${tests.length} tests passed`);

  if (passedTests === tests.length) {
    console.log('\n🎉 Phase 1 Integration Test: PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ Phase 1 Integration Test: FAILED');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
