/**
 * Mesh Registry - JARVIS MESH v1
 *
 * Purpose: Device registry for distributed execution mesh
 * - M1 (Mothership): Brain (decisions, memory, planning)
 * - M3 (MacBook Pro): Hands (file operations, URL opening, notifications)
 * - iPhone: Mobile hands (notifications, shortcuts)
 *
 * Features:
 * - Device registration and health tracking
 * - Capability-based routing
 * - Automatic fallback when devices offline
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export type DeviceId = 'm1' | 'm3' | 'iphone';
export type DeviceCapability = 'planning' | 'memory' | 'file_operations' | 'open_url' | 'notify' | 'shortcuts';
export type DeviceStatus = 'online' | 'offline' | 'degraded';

export interface DeviceInfo {
  device_id: DeviceId;
  hostname: string;
  ip_address?: string;
  capabilities: DeviceCapability[];
  status: DeviceStatus;
  last_seen: string; // ISO timestamp
  health_check_url?: string; // For M3, the health check endpoint
  fallback_instructions?: string; // Instructions when device offline
}

export interface MeshRegistryData {
  devices: Record<DeviceId, DeviceInfo>;
  last_updated: string;
}

export class MeshRegistry {
  private registryPath: string;
  private data: MeshRegistryData | null = null;

  constructor(registryPath?: string) {
    this.registryPath = registryPath || path.join(homedir(), '.claude', 'jarvis_mesh.json');
  }

  /**
   * Initialize registry with default devices
   */
  async initialize(): Promise<void> {
    const defaultData: MeshRegistryData = {
      devices: {
        m1: {
          device_id: 'm1',
          hostname: 'mothership',
          ip_address: '192.168.1.20',
          capabilities: ['planning', 'memory'],
          status: 'online',
          last_seen: new Date().toISOString(),
        },
        m3: {
          device_id: 'm3',
          hostname: 'DJs-MacBook-Pro-2171.local',
          ip_address: '192.168.1.3',
          capabilities: ['file_operations', 'open_url', 'notify'],
          status: 'online',
          last_seen: new Date().toISOString(),
          health_check_url: 'http://192.168.1.3:3500/health',
          fallback_instructions: 'M3がオフラインです。ファイルは ~/Library/Mobile Documents/com~apple~CloudDocs/ (iCloud) に保存しました。M3起動後に確認してください。',
        },
        iphone: {
          device_id: 'iphone',
          hostname: 'iPhone',
          capabilities: ['notify', 'shortcuts'],
          status: 'online',
          last_seen: new Date().toISOString(),
        },
      },
      last_updated: new Date().toISOString(),
    };

    await this.save(defaultData);
    this.data = defaultData;
    console.log('[MeshRegistry] Initialized with default devices');
  }

  /**
   * Load registry from disk
   */
  async load(): Promise<MeshRegistryData> {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      this.data = JSON.parse(content);
      return this.data!;
    } catch (error) {
      console.log('[MeshRegistry] Registry not found, initializing...');
      await this.initialize();
      return this.data!;
    }
  }

  /**
   * Save registry to disk
   */
  private async save(data: MeshRegistryData): Promise<void> {
    const dir = path.dirname(this.registryPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Get device info
   */
  async getDevice(deviceId: DeviceId): Promise<DeviceInfo | null> {
    if (!this.data) {
      await this.load();
    }
    return this.data!.devices[deviceId] || null;
  }

  /**
   * Update device status
   */
  async updateDeviceStatus(deviceId: DeviceId, status: DeviceStatus): Promise<void> {
    if (!this.data) {
      await this.load();
    }

    if (this.data!.devices[deviceId]) {
      this.data!.devices[deviceId].status = status;
      this.data!.devices[deviceId].last_seen = new Date().toISOString();
      this.data!.last_updated = new Date().toISOString();
      await this.save(this.data!);
      console.log(`[MeshRegistry] Device ${deviceId} status updated: ${status}`);
    }
  }

  /**
   * Find devices by capability
   */
  async findDevicesByCapability(capability: DeviceCapability): Promise<DeviceInfo[]> {
    if (!this.data) {
      await this.load();
    }

    return Object.values(this.data!.devices).filter(
      (device) => device.capabilities.includes(capability) && device.status === 'online'
    );
  }

  /**
   * Get device for specific action type
   */
  async getDeviceForAction(actionType: string): Promise<{ device: DeviceInfo; fallback?: string } | null> {
    if (!this.data) {
      await this.load();
    }

    // Action type → Capability mapping
    const capabilityMap: Record<string, DeviceCapability> = {
      open_url: 'open_url',
      reveal_file: 'file_operations',
      notify: 'notify',
      send_message: 'notify',
      run_shortcut: 'shortcuts',
    };

    const capability = capabilityMap[actionType];
    if (!capability) {
      console.log(`[MeshRegistry] Unknown action type: ${actionType}, defaulting to M1`);
      return { device: this.data!.devices.m1 };
    }

    // Find online devices with capability
    const devices = await this.findDevicesByCapability(capability);

    if (devices.length > 0) {
      // Prefer M3 for file operations and open_url
      const m3Device = devices.find((d) => d.device_id === 'm3');
      if (m3Device && (capability === 'file_operations' || capability === 'open_url')) {
        return { device: m3Device };
      }

      // Otherwise return first available
      return { device: devices[0]! };
    }

    // No online device found - check for fallback instructions
    const preferredDevice = capability === 'file_operations' || capability === 'open_url' ? 'm3' : 'iphone';
    const deviceInfo = this.data!.devices[preferredDevice];

    if (deviceInfo?.fallback_instructions) {
      return {
        device: this.data!.devices.m1, // Fallback to M1
        fallback: deviceInfo.fallback_instructions,
      };
    }

    // No fallback - return M1 as last resort
    return { device: this.data!.devices.m1 };
  }

  /**
   * Health check for M3 device
   */
  async healthCheckM3(): Promise<boolean> {
    if (!this.data) {
      await this.load();
    }

    const m3 = this.data!.devices.m3;
    if (!m3.health_check_url) {
      console.log('[MeshRegistry] M3 health check URL not configured');
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

      const response = await fetch(m3.health_check_url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        await this.updateDeviceStatus('m3', 'online');
        return true;
      }

      await this.updateDeviceStatus('m3', 'offline');
      return false;
    } catch (error) {
      console.log('[MeshRegistry] M3 health check failed:', error);
      await this.updateDeviceStatus('m3', 'offline');
      return false;
    }
  }

  /**
   * Get registry summary
   */
  async getSummary(): Promise<{
    total: number;
    online: number;
    offline: number;
    devices: Array<{ id: DeviceId; status: DeviceStatus; capabilities: DeviceCapability[] }>;
  }> {
    if (!this.data) {
      await this.load();
    }

    const devices = Object.values(this.data!.devices);
    const online = devices.filter((d) => d.status === 'online').length;
    const offline = devices.filter((d) => d.status === 'offline').length;

    return {
      total: devices.length,
      online,
      offline,
      devices: devices.map((d) => ({
        id: d.device_id,
        status: d.status,
        capabilities: d.capabilities,
      })),
    };
  }
}
