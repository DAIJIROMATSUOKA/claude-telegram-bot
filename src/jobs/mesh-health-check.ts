/**
 * JARVIS MESH Health Check Job
 *
 * Purpose: Periodic health check for M3 device (every 5 minutes)
 * - Checks M3 health endpoint
 * - Updates device status in Mesh Registry
 * - Logs status changes
 *
 * Cron schedule: every 5 minutes
 */

import { MeshRegistry } from '../mesh/mesh-registry';

async function main() {
  console.log(`[MESH Health Check] Starting health check at ${new Date().toISOString()}`);

  const registry = new MeshRegistry();

  try {
    // Check M3 health
    const m3Healthy = await registry.healthCheckM3();

    if (m3Healthy) {
      console.log('[MESH Health Check] ✅ M3 is online');
    } else {
      console.log('[MESH Health Check] ⚠️ M3 is offline');
    }

    // Get mesh summary
    const summary = await registry.getSummary();
    console.log(`[MESH Health Check] Mesh Status: ${summary.online}/${summary.total} devices online`);

    for (const device of summary.devices) {
      console.log(`  - ${device.id}: ${device.status} (${device.capabilities.join(', ')})`);
    }
  } catch (error) {
    console.error('[MESH Health Check] Error:', error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log('[MESH Health Check] Health check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[MESH Health Check] Fatal error:', error);
    process.exit(1);
  });
