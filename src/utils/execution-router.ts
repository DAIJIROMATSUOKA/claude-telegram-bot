/**
 * Execution Router - Autopilot Engine v2.3 (JARVIS MESH Integration)
 *
 * Purpose: Control Autopilot execution with 3 modes:
 * 1. Shadow Mode (default) - Proposals only, no execution
 * 2. Canary Mode - Gradual rollout (test → canary → production)
 * 3. Production Mode - Full execution
 *
 * Kill Switch: Emergency disable via Memory Gateway
 *
 * JARVIS MESH Integration (Phase 1):
 * - Device routing: M1 (brain), M3 (hands), iPhone (mobile)
 * - Capability-based action routing
 * - Automatic fallback when devices offline
 */

import type { AutopilotProposal } from '../autopilot/engine';
import { MeshRegistry, type DeviceInfo } from '../mesh/mesh-registry';

export type ExecutionMode = 'shadow' | 'canary' | 'production';
export type ExecutionScope = 'test' | 'canary' | 'production';

export interface ExecutionConfig {
  mode: ExecutionMode;
  scope: ExecutionScope;
  killSwitchEnabled: boolean;
}

export interface RoutingDecision {
  shouldExecute: boolean;
  reason: string;
  mode: ExecutionMode;
  scope: ExecutionScope;
  targetDevice?: DeviceInfo; // JARVIS MESH: Target device for execution
  fallbackMessage?: string; // JARVIS MESH: Fallback instructions if device offline
  canaryRollout?: {
    testPassed: boolean;
    canaryScope: ExecutionScope;
    productionScope: ExecutionScope;
  };
}

export interface KillSwitchStatus {
  enabled: boolean;
  reason?: string;
  disabledAt?: string;
  disabledBy?: string;
}

export class ExecutionRouter {
  private memoryGatewayUrl: string;
  private config: ExecutionConfig;
  private meshRegistry: MeshRegistry; // JARVIS MESH

  constructor(memoryGatewayUrl: string, mode: ExecutionMode = 'shadow') {
    this.memoryGatewayUrl = memoryGatewayUrl;
    this.config = {
      mode,
      scope: 'test',
      killSwitchEnabled: false,
    };
    this.meshRegistry = new MeshRegistry(); // JARVIS MESH
  }

  /**
   * Get current execution mode
   */
  getMode(): ExecutionMode {
    return this.config.mode;
  }

  /**
   * Set execution mode
   */
  setMode(mode: ExecutionMode): void {
    this.config.mode = mode;
    console.log(`[ExecutionRouter] Mode changed to: ${mode}`);
  }

  /**
   * Get current execution scope
   */
  getScope(): ExecutionScope {
    return this.config.scope;
  }

  /**
   * Set execution scope
   */
  setScope(scope: ExecutionScope): void {
    this.config.scope = scope;
    console.log(`[ExecutionRouter] Scope changed to: ${scope}`);
  }

  /**
   * Check Kill Switch status from Memory Gateway
   */
  async checkKillSwitch(): Promise<KillSwitchStatus> {
    try {
      const response = await fetch(
        `${this.memoryGatewayUrl}/v1/memory/query?` +
        new URLSearchParams({
          scope_prefix: 'shared/autopilot',
          type: 'kill_switch',
          limit: '1',
        }),
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(`[ExecutionRouter] Kill switch check failed: ${response.status}`);
        return { enabled: false };
      }

      const data = await response.json() as any;

      if (data.items && data.items.length > 0) {
        const killSwitch = data.items[0];
        const content = JSON.parse(killSwitch.content);

        return {
          enabled: content.enabled === true,
          reason: content.reason,
          disabledAt: killSwitch.timestamp,
          disabledBy: content.disabled_by,
        };
      }

      return { enabled: false };
    } catch (error) {
      console.error('[ExecutionRouter] Kill switch check error:', error);
      return { enabled: false };
    }
  }

  /**
   * Enable Kill Switch (emergency stop)
   */
  async enableKillSwitch(reason: string, disabledBy: string = 'system'): Promise<void> {
    try {
      const response = await fetch(`${this.memoryGatewayUrl}/v1/memory/append`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'shared/autopilot/kill_switch',
          type: 'kill_switch',
          title: '🚨 Autopilot Kill Switch ENABLED',
          content: JSON.stringify({
            enabled: true,
            reason,
            disabled_by: disabledBy,
            timestamp: new Date().toISOString(),
          }),
          importance: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to enable kill switch: ${response.status}`);
      }

      this.config.killSwitchEnabled = true;
      console.log(`[ExecutionRouter] ⚠️ KILL SWITCH ENABLED: ${reason}`);
    } catch (error) {
      console.error('[ExecutionRouter] Failed to enable kill switch:', error);
      throw error;
    }
  }

  /**
   * Disable Kill Switch (resume execution)
   */
  async disableKillSwitch(enabledBy: string = 'system'): Promise<void> {
    try {
      const response = await fetch(`${this.memoryGatewayUrl}/v1/memory/append`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'shared/autopilot/kill_switch',
          type: 'kill_switch',
          title: '✅ Autopilot Kill Switch DISABLED',
          content: JSON.stringify({
            enabled: false,
            enabled_by: enabledBy,
            timestamp: new Date().toISOString(),
          }),
          importance: 8,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to disable kill switch: ${response.status}`);
      }

      this.config.killSwitchEnabled = false;
      console.log(`[ExecutionRouter] ✅ KILL SWITCH DISABLED`);
    } catch (error) {
      console.error('[ExecutionRouter] Failed to disable kill switch:', error);
      throw error;
    }
  }

  /**
   * Route execution decision (with JARVIS MESH device routing)
   */
  async route(proposal: AutopilotProposal): Promise<RoutingDecision> {
    // Check Kill Switch first
    const killSwitch = await this.checkKillSwitch();
    if (killSwitch.enabled) {
      return {
        shouldExecute: false,
        reason: `Kill Switch enabled: ${killSwitch.reason || 'Emergency stop'}`,
        mode: this.config.mode,
        scope: this.config.scope,
      };
    }

    // JARVIS MESH: Determine target device for action
    const deviceRouting = await this.routeToDevice(proposal);

    // Shadow Mode - never execute
    if (this.config.mode === 'shadow') {
      return {
        shouldExecute: false,
        reason: 'Shadow Mode: proposal only, no execution',
        mode: 'shadow',
        scope: this.config.scope,
        targetDevice: deviceRouting.device,
        fallbackMessage: deviceRouting.fallback,
      };
    }

    // Canary Mode - gradual rollout
    if (this.config.mode === 'canary') {
      const decision = this.routeCanary(proposal);
      decision.targetDevice = deviceRouting.device;
      decision.fallbackMessage = deviceRouting.fallback;
      return decision;
    }

    // Production Mode - full execution
    return {
      shouldExecute: true,
      reason: 'Production Mode: full execution enabled',
      mode: 'production',
      scope: this.config.scope,
      targetDevice: deviceRouting.device,
      fallbackMessage: deviceRouting.fallback,
    };
  }

  /**
   * JARVIS MESH: Route action to appropriate device
   */
  private async routeToDevice(
    proposal: AutopilotProposal
  ): Promise<{ device: DeviceInfo; fallback?: string }> {
    // Extract action type from proposal
    const actionType = this.extractActionType(proposal);

    // Get device for action type
    const routing = await this.meshRegistry.getDeviceForAction(actionType);

    if (routing) {
      console.log(`[ExecutionRouter] MESH: Routing ${actionType} → ${routing.device.device_id}`);
      if (routing.fallback) {
        console.log(`[ExecutionRouter] MESH: Fallback available: ${routing.fallback}`);
      }
      return routing;
    }

    // Default to M1 if no routing found
    const m1 = await this.meshRegistry.getDevice('m1');
    return { device: m1! };
  }

  /**
   * JARVIS MESH: Extract action type from proposal
   */
  private extractActionType(proposal: AutopilotProposal): string {
    // Extract from proposal title or content
    const title = ((proposal as any).title ?? '').toLowerCase();
    const content = ((proposal as any).rationale ?? '').toLowerCase();

    if (title.includes('open') || content.includes('open url') || content.includes('open file')) {
      return 'open_url';
    }

    if (title.includes('reveal') || content.includes('reveal file')) {
      return 'reveal_file';
    }

    if (title.includes('notify') || content.includes('notification')) {
      return 'notify';
    }

    if (title.includes('message') || content.includes('send message')) {
      return 'send_message';
    }

    if (title.includes('shortcut') || content.includes('run shortcut')) {
      return 'run_shortcut';
    }

    // Default: unknown action (will route to M1)
    return 'unknown';
  }

  /**
   * Canary routing logic
   */
  private routeCanary(proposal: AutopilotProposal): RoutingDecision {
    const currentScope = this.config.scope;

    // Test scope - always execute
    if (currentScope === 'test') {
      return {
        shouldExecute: true,
        reason: 'Canary Mode: executing in test scope',
        mode: 'canary',
        scope: 'test',
        canaryRollout: {
          testPassed: false,
          canaryScope: 'test',
          productionScope: 'production',
        },
      };
    }

    // Canary scope - execute with monitoring
    if (currentScope === 'canary') {
      return {
        shouldExecute: true,
        reason: 'Canary Mode: executing in canary scope (10% rollout)',
        mode: 'canary',
        scope: 'canary',
        canaryRollout: {
          testPassed: true,
          canaryScope: 'canary',
          productionScope: 'production',
        },
      };
    }

    // Production scope - full execution
    return {
      shouldExecute: true,
      reason: 'Canary Mode: executing in production scope (100% rollout)',
      mode: 'canary',
      scope: 'production',
      canaryRollout: {
        testPassed: true,
        canaryScope: 'canary',
        productionScope: 'production',
      },
    };
  }

  /**
   * Promote to next scope (test → canary → production)
   */
  promoteScope(): { success: boolean; from: ExecutionScope; to: ExecutionScope } {
    const from = this.config.scope;
    let to: ExecutionScope = from;

    if (from === 'test') {
      to = 'canary';
    } else if (from === 'canary') {
      to = 'production';
    } else {
      console.log(`[ExecutionRouter] Already at production scope, cannot promote`);
      return { success: false, from, to: from };
    }

    this.config.scope = to;
    console.log(`[ExecutionRouter] 🚀 Promoted scope: ${from} → ${to}`);
    return { success: true, from, to };
  }

  /**
   * Rollback to previous scope (production → canary → test)
   */
  rollbackScope(): { success: boolean; from: ExecutionScope; to: ExecutionScope } {
    const from = this.config.scope;
    let to: ExecutionScope = from;

    if (from === 'production') {
      to = 'canary';
    } else if (from === 'canary') {
      to = 'test';
    } else {
      console.log(`[ExecutionRouter] Already at test scope, cannot rollback`);
      return { success: false, from, to: from };
    }

    this.config.scope = to;
    console.log(`[ExecutionRouter] ⏪ Rolled back scope: ${from} → ${to}`);
    return { success: true, from, to };
  }

  /**
   * Get current configuration
   */
  getConfig(): ExecutionConfig {
    return { ...this.config };
  }

  /**
   * Get router status summary (with JARVIS MESH info)
   */
  async getStatus(): Promise<{
    mode: ExecutionMode;
    scope: ExecutionScope;
    killSwitch: KillSwitchStatus;
    canExecute: boolean;
    mesh?: {
      total: number;
      online: number;
      offline: number;
      devices: Array<{ id: string; status: string; capabilities: string[] }>;
    };
  }> {
    const killSwitch = await this.checkKillSwitch();
    const canExecute = this.config.mode !== 'shadow' && !killSwitch.enabled;

    // JARVIS MESH: Get mesh summary
    const meshSummary = await this.meshRegistry.getSummary();

    return {
      mode: this.config.mode,
      scope: this.config.scope,
      killSwitch,
      canExecute,
      mesh: meshSummary,
    };
  }

  /**
   * JARVIS MESH: Run health check for all devices
   */
  async healthCheck(): Promise<void> {
    console.log('[ExecutionRouter] MESH: Running health check...');
    await this.meshRegistry.healthCheckM3();
  }
}
