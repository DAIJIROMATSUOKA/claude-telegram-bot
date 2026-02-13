/**
 * Unit tests for ExecutionRouter
 */

import { mock, describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Mock MeshRegistry
class MockMeshRegistry {
  getOnlineDevices() {
    return [{ id: 'm1', name: 'M1', role: 'brain', status: 'online', capabilities: ['planning', 'memory'] }];
  }
  getDeviceForCapability(cap: string) {
    return { id: 'm1', name: 'M1', role: 'brain', status: 'online', capabilities: ['planning', 'memory'] };
  }
  getAllDevices() {
    return [];
  }
  healthCheck() {
    return Promise.resolve();
  }
  getDeviceForAction(actionType: string) {
    return Promise.resolve({
      device: { device_id: 'm1', hostname: 'mothership', capabilities: ['planning', 'memory'], status: 'online', last_seen: new Date().toISOString() },
    });
  }
  getDevice(deviceId: string) {
    return Promise.resolve({
      device_id: 'm1',
      hostname: 'mothership',
      capabilities: ['planning', 'memory'],
      status: 'online',
      last_seen: new Date().toISOString(),
    });
  }
  getSummary() {
    return Promise.resolve({
      total: 3,
      online: 2,
      offline: 1,
      devices: [
        { id: 'm1', status: 'online', capabilities: ['planning', 'memory'] },
        { id: 'm3', status: 'online', capabilities: ['file_operations', 'open_url'] },
        { id: 'iphone', status: 'offline', capabilities: ['notify', 'shortcuts'] },
      ],
    });
  }
  healthCheckM3() {
    return Promise.resolve(true);
  }
}

mock.module('../mesh/mesh-registry', () => ({
  MeshRegistry: MockMeshRegistry,
}));

// Mock fetch for Memory Gateway
const originalFetch = globalThis.fetch;
let mockFetchFn = mock(() =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
  )
);

import { ExecutionRouter, type ExecutionMode, type ExecutionScope } from '../utils/execution-router';
import type { AutopilotProposal } from '../autopilot/engine';

// Helper to create a mock proposal
function createMockProposal(overrides: Partial<AutopilotProposal> = {}): AutopilotProposal {
  return {
    task: {
      id: 'task_test123',
      type: 'predictive',
      title: 'Test Task',
      description: 'Test description',
      reason: 'Test reason',
      confidence: 0.8,
      impact: 'low',
      created_at: new Date().toISOString(),
      status: 'proposed',
      source_plugin: 'test-plugin',
    },
    action_plan: ['Step 1', 'Step 2'],
    estimated_duration: '5 minutes',
    rationale: 'Test rationale',
    ...overrides,
  } as AutopilotProposal;
}

describe('ExecutionRouter', () => {
  const gatewayUrl = 'http://localhost:3500';

  beforeEach(() => {
    // Reset mock fetch
    mockFetchFn = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
      )
    );
    globalThis.fetch = mockFetchFn as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Constructor', () => {
    test('sets default mode to shadow', () => {
      const router = new ExecutionRouter(gatewayUrl);
      expect(router.getMode()).toBe('shadow');
    });

    test('accepts custom mode in constructor', () => {
      const router = new ExecutionRouter(gatewayUrl, 'production');
      expect(router.getMode()).toBe('production');
    });
  });

  describe('getMode/setMode', () => {
    test('getMode returns current mode', () => {
      const router = new ExecutionRouter(gatewayUrl, 'canary');
      expect(router.getMode()).toBe('canary');
    });

    test('setMode changes mode correctly', () => {
      const router = new ExecutionRouter(gatewayUrl);
      expect(router.getMode()).toBe('shadow');

      router.setMode('production');
      expect(router.getMode()).toBe('production');

      router.setMode('canary');
      expect(router.getMode()).toBe('canary');
    });
  });

  describe('getScope/setScope', () => {
    test('getScope returns default scope (test)', () => {
      const router = new ExecutionRouter(gatewayUrl);
      expect(router.getScope()).toBe('test');
    });

    test('setScope changes scope correctly', () => {
      const router = new ExecutionRouter(gatewayUrl);
      expect(router.getScope()).toBe('test');

      router.setScope('canary');
      expect(router.getScope()).toBe('canary');

      router.setScope('production');
      expect(router.getScope()).toBe('production');
    });
  });

  describe('checkKillSwitch', () => {
    test('returns disabled when Memory Gateway says false', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      const result = await router.checkKillSwitch();

      expect(result.enabled).toBe(false);
      expect(mockFetchFn).toHaveBeenCalled();
    });

    test('returns enabled when Memory Gateway says true', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              items: [
                {
                  content: JSON.stringify({
                    enabled: true,
                    reason: 'Emergency stop',
                    disabled_by: 'admin',
                  }),
                  timestamp: '2026-02-13T10:00:00Z',
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      const result = await router.checkKillSwitch();

      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('Emergency stop');
      expect(result.disabledBy).toBe('admin');
    });

    test('handles fetch errors gracefully (returns disabled)', async () => {
      mockFetchFn = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      const result = await router.checkKillSwitch();

      expect(result.enabled).toBe(false);
    });

    test('handles non-ok response gracefully', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(new Response('Server error', { status: 500 }))
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      const result = await router.checkKillSwitch();

      expect(result.enabled).toBe(false);
    });
  });

  describe('enableKillSwitch', () => {
    test('calls Memory Gateway with correct params', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      await router.enableKillSwitch('Test emergency', 'test-user');

      expect(mockFetchFn).toHaveBeenCalled();
      const callArgs = mockFetchFn.mock.calls[0];
      expect(callArgs[0]).toBe(`${gatewayUrl}/v1/memory/append`);

      const body = JSON.parse(callArgs[1].body);
      expect(body.scope).toBe('shared/autopilot/kill_switch');
      expect(body.type).toBe('kill_switch');

      const content = JSON.parse(body.content);
      expect(content.enabled).toBe(true);
      expect(content.reason).toBe('Test emergency');
      expect(content.disabled_by).toBe('test-user');
    });

    test('throws error on failed request', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(new Response('Server error', { status: 500 }))
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);

      await expect(router.enableKillSwitch('Test', 'user')).rejects.toThrow();
    });
  });

  describe('disableKillSwitch', () => {
    test('calls Memory Gateway with correct params', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);
      await router.disableKillSwitch('admin-user');

      expect(mockFetchFn).toHaveBeenCalled();
      const callArgs = mockFetchFn.mock.calls[0];
      expect(callArgs[0]).toBe(`${gatewayUrl}/v1/memory/append`);

      const body = JSON.parse(callArgs[1].body);
      expect(body.scope).toBe('shared/autopilot/kill_switch');
      expect(body.type).toBe('kill_switch');

      const content = JSON.parse(body.content);
      expect(content.enabled).toBe(false);
      expect(content.enabled_by).toBe('admin-user');
    });

    test('throws error on failed request', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(new Response('Server error', { status: 500 }))
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl);

      await expect(router.disableKillSwitch('user')).rejects.toThrow();
    });
  });

  describe('route()', () => {
    test('in shadow mode returns execute=false with logged proposal', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'shadow');
      const proposal = createMockProposal();

      const result = await router.route(proposal);

      expect(result.shouldExecute).toBe(false);
      expect(result.mode).toBe('shadow');
      expect(result.reason).toContain('Shadow Mode');
      expect(result.reason).toContain('proposal only');
    });

    test('in production mode returns execute=true', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'production');
      const proposal = createMockProposal();

      const result = await router.route(proposal);

      expect(result.shouldExecute).toBe(true);
      expect(result.mode).toBe('production');
      expect(result.reason).toContain('Production Mode');
    });

    test('respects kill switch (returns execute=false when kill switch enabled)', async () => {
      // Mock kill switch as enabled
      mockFetchFn = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              items: [
                {
                  content: JSON.stringify({
                    enabled: true,
                    reason: 'Emergency stop',
                  }),
                  timestamp: '2026-02-13T10:00:00Z',
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl, 'production');
      const proposal = createMockProposal();

      const result = await router.route(proposal);

      expect(result.shouldExecute).toBe(false);
      expect(result.reason).toContain('Kill Switch enabled');
    });

    test('in canary mode with test scope returns execute=true', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'canary');
      router.setScope('test');
      const proposal = createMockProposal();

      const result = await router.route(proposal);

      expect(result.shouldExecute).toBe(true);
      expect(result.mode).toBe('canary');
      expect(result.scope).toBe('test');
    });

    test('includes target device in routing decision', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'shadow');
      const proposal = createMockProposal();

      const result = await router.route(proposal);

      expect(result.targetDevice).toBeDefined();
      expect(result.targetDevice!.device_id).toBe('m1');
    });
  });

  describe('getStatus', () => {
    test('returns current config and kill switch status', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'canary');
      router.setScope('canary');

      const status = await router.getStatus();

      expect(status.mode).toBe('canary');
      expect(status.scope).toBe('canary');
      expect(status.killSwitch).toBeDefined();
      expect(status.killSwitch.enabled).toBe(false);
      expect(status.canExecute).toBe(true);
    });

    test('returns canExecute=false when in shadow mode', async () => {
      const router = new ExecutionRouter(gatewayUrl, 'shadow');

      const status = await router.getStatus();

      expect(status.mode).toBe('shadow');
      expect(status.canExecute).toBe(false);
    });

    test('returns canExecute=false when kill switch enabled', async () => {
      mockFetchFn = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              items: [
                {
                  content: JSON.stringify({ enabled: true, reason: 'Test' }),
                  timestamp: '2026-02-13T10:00:00Z',
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetchFn as any;

      const router = new ExecutionRouter(gatewayUrl, 'production');

      const status = await router.getStatus();

      expect(status.mode).toBe('production');
      expect(status.killSwitch.enabled).toBe(true);
      expect(status.canExecute).toBe(false);
    });

    test('includes mesh summary', async () => {
      const router = new ExecutionRouter(gatewayUrl);

      const status = await router.getStatus();

      expect(status.mesh).toBeDefined();
      expect(status.mesh!.total).toBe(3);
      expect(status.mesh!.online).toBe(2);
      expect(status.mesh!.offline).toBe(1);
    });
  });

  describe('promoteScope', () => {
    test('promotes test to canary', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('test');

      const result = router.promoteScope();

      expect(result.success).toBe(true);
      expect(result.from).toBe('test');
      expect(result.to).toBe('canary');
      expect(router.getScope()).toBe('canary');
    });

    test('promotes canary to production', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('canary');

      const result = router.promoteScope();

      expect(result.success).toBe(true);
      expect(result.from).toBe('canary');
      expect(result.to).toBe('production');
      expect(router.getScope()).toBe('production');
    });

    test('cannot promote production further', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('production');

      const result = router.promoteScope();

      expect(result.success).toBe(false);
      expect(result.from).toBe('production');
      expect(result.to).toBe('production');
    });
  });

  describe('rollbackScope', () => {
    test('rolls back production to canary', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('production');

      const result = router.rollbackScope();

      expect(result.success).toBe(true);
      expect(result.from).toBe('production');
      expect(result.to).toBe('canary');
      expect(router.getScope()).toBe('canary');
    });

    test('rolls back canary to test', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('canary');

      const result = router.rollbackScope();

      expect(result.success).toBe(true);
      expect(result.from).toBe('canary');
      expect(result.to).toBe('test');
      expect(router.getScope()).toBe('test');
    });

    test('cannot rollback test further', () => {
      const router = new ExecutionRouter(gatewayUrl);
      router.setScope('test');

      const result = router.rollbackScope();

      expect(result.success).toBe(false);
      expect(result.from).toBe('test');
      expect(result.to).toBe('test');
    });
  });

  describe('getConfig', () => {
    test('returns copy of current config', () => {
      const router = new ExecutionRouter(gatewayUrl, 'canary');
      router.setScope('canary');

      const config = router.getConfig();

      expect(config.mode).toBe('canary');
      expect(config.scope).toBe('canary');
      expect(config.killSwitchEnabled).toBe(false);

      // Verify it's a copy, not the original
      config.mode = 'shadow';
      expect(router.getMode()).toBe('canary');
    });
  });
});
