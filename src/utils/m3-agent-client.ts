/**
 * M3 Device Agent Client - Autopilot Engine v2.2
 *
 * Purpose: Send commands to M3 MacBook Pro for:
 * - Opening files in default apps
 * - Revealing files/folders in Finder
 * - Showing notifications
 *
 * Configuration: M3_AGENT_URL and M3_AGENT_TOKEN from .env
 */

export interface M3AgentConfig {
  url: string;
  token: string;
  enabled: boolean;
}

export interface M3AgentResponse {
  ok: boolean;
  error?: string;
  opened?: boolean;
  revealed?: boolean;
  notified?: boolean;
}

export class M3AgentClient {
  private config: M3AgentConfig;

  constructor(url?: string, token?: string) {
    this.config = {
      url: url || process.env.M3_AGENT_URL || '',
      token: token || process.env.M3_AGENT_TOKEN || '',
      enabled: !!(url || process.env.M3_AGENT_URL) && !!(token || process.env.M3_AGENT_TOKEN),
    };
  }

  /**
   * Check if M3 Agent is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Open a file on M3 (using default app)
   * @param path - Absolute path to file
   * @param timeout - Request timeout in ms (default: 5000)
   */
  async open(path: string, timeout: number = 5000): Promise<M3AgentResponse> {
    if (!this.config.enabled) {
      return { ok: false, error: 'M3 Agent not configured' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.config.url}/open`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { ok: false, error: 'Request timeout' };
      }
      return { ok: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Reveal a file/folder in Finder on M3
   * @param path - Absolute path to file or folder
   * @param timeout - Request timeout in ms (default: 5000)
   */
  async reveal(path: string, timeout: number = 5000): Promise<M3AgentResponse> {
    if (!this.config.enabled) {
      return { ok: false, error: 'M3 Agent not configured' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.config.url}/reveal`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { ok: false, error: 'Request timeout' };
      }
      return { ok: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Show a notification on M3
   * @param message - Notification message
   * @param title - Optional notification title
   * @param timeout - Request timeout in ms (default: 5000)
   */
  async notify(message: string, title?: string, timeout: number = 5000): Promise<M3AgentResponse> {
    if (!this.config.enabled) {
      return { ok: false, error: 'M3 Agent not configured' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.config.url}/notify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, title }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { ok: false, error: 'Request timeout' };
      }
      return { ok: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Send notification with error handling (fire-and-forget)
   * @param message - Notification message
   * @param title - Optional notification title
   */
  notifyAsync(message: string, title?: string): void {
    if (!this.config.enabled) {
      console.log('[M3 Agent] Notification skipped (not configured):', message);
      return;
    }

    this.notify(message, title)
      .then((result) => {
        if (!result.ok) {
          console.error('[M3 Agent] Notification failed:', result.error);
        }
      })
      .catch((error) => {
        console.error('[M3 Agent] Notification error:', error);
      });
  }

  /**
   * Get agent configuration (for debugging)
   */
  getConfig(): { url: string; enabled: boolean } {
    return {
      url: this.config.url,
      enabled: this.config.enabled,
    };
  }
}
