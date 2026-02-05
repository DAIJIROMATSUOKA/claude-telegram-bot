/**
 * CI/CD Notification Module
 *
 * Sends notifications to Telegram when CI/CD events occur:
 * - Golden Test failures
 * - Coverage drops
 * - Kill Switch activations
 * - Flaky test detections
 */

import type {
  TestExecutionResult,
  KillSwitchDecision,
  TestCoverageMetrics,
  FlakyTestReport,
} from '../autopilot/golden-test-types';

export interface NotificationConfig {
  telegramBotToken: string;
  telegramChatId: string;
  enabled: boolean;
}

export class CINotifications {
  private config: NotificationConfig;

  constructor(config: NotificationConfig) {
    this.config = config;
  }

  /**
   * Send notification when Golden Tests fail in CI
   */
  async notifyTestFailure(
    results: TestExecutionResult[],
    context: {
      repository: string;
      branch: string;
      commit: string;
      author: string;
      runUrl: string;
    }
  ): Promise<void> {
    if (!this.config.enabled) {
      console.log('[CINotifications] Notifications disabled, skipping');
      return;
    }

    const failedTests = results.filter((r) => r.status === 'failed');

    if (failedTests.length === 0) {
      return; // No failures, don't notify
    }

    const message = `
🚨 **Golden Tests Failed in CI**

**Repository:** ${context.repository}
**Branch:** ${context.branch}
**Commit:** ${context.commit.substring(0, 7)}
**Author:** ${context.author}

**Failed Tests:** ${failedTests.length}/${results.length}

${failedTests.slice(0, 3).map((test) => `• ${test.test_id}: ${test.error_message || 'Test failed'}`).join('\n')}
${failedTests.length > 3 ? `\n...and ${failedTests.length - 3} more` : ''}

🔗 [View CI Run](${context.runUrl})
    `.trim();

    await this.sendTelegramMessage(message);
  }

  /**
   * Send notification when Kill Switch is activated
   */
  async notifyKillSwitchActivation(
    decision: KillSwitchDecision,
    context: {
      environment: 'test' | 'canary' | 'production';
      triggeredBy: string;
    }
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const emoji = decision.severity === 'critical' ? '🚨' : decision.severity === 'high' ? '⚠️' : '⚡';

    const message = `
${emoji} **Kill Switch Activated!**

**Severity:** ${decision.severity.toUpperCase()}
**Environment:** ${context.environment}
**Reason:** ${decision.reason}

**Trigger:** ${decision.triggered_by}
**Test ID:** ${decision.test_id || 'N/A'}
**Plan Bundle:** ${decision.plan_bundle_id || 'N/A'}

**Threshold:** ${decision.threshold_type} (${decision.failure_count} failures in ${decision.time_window_minutes} minutes)

**Action Required:**
1. Review the failed test logs
2. Fix the issue that triggered the failure
3. Manually deactivate Kill Switch when safe

**Activated At:** ${new Date(decision.activated_at || decision.decided_at).toLocaleString()}
    `.trim();

    await this.sendTelegramMessage(message);
  }

  /**
   * Send notification when coverage drops below threshold
   */
  async notifyCoverageDrop(
    metrics: TestCoverageMetrics,
    previousCoverage: number,
    threshold: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const drop = previousCoverage - metrics.coverage_percentage;

    if (drop <= 0) {
      return; // Coverage didn't drop
    }

    const message = `
📉 **Test Coverage Dropped**

**Previous Coverage:** ${previousCoverage.toFixed(1)}%
**Current Coverage:** ${metrics.coverage_percentage.toFixed(1)}%
**Drop:** -${drop.toFixed(1)}%

**Threshold:** ${threshold}%

**Coverage by Severity:**
• Critical: ${metrics.critical_covered}/${metrics.critical_total} (${metrics.critical_total > 0 ? Math.round((metrics.critical_covered / metrics.critical_total) * 100) : 0}%)
• High: ${metrics.high_covered}/${metrics.high_total} (${metrics.high_total > 0 ? Math.round((metrics.high_covered / metrics.high_total) * 100) : 0}%)
• Medium: ${metrics.medium_covered}/${metrics.medium_total}
• Low: ${metrics.low_covered}/${metrics.low_total}

**Action Required:**
Review recent changes and ensure Golden Tests are created for new accident patterns.
    `.trim();

    await this.sendTelegramMessage(message);
  }

  /**
   * Send notification when flaky tests are detected
   */
  async notifyFlakyTests(reports: FlakyTestReport[]): Promise<void> {
    if (!this.config.enabled || reports.length === 0) {
      return;
    }

    const message = `
⚠️ **Flaky Tests Detected**

**Quarantined Tests:** ${reports.length}

${reports.slice(0, 3).map((report) => `
• **${report.test_title}**
  - Flaky Rate: ${(report.flaky_rate * 100).toFixed(1)}%
  - Total Runs: ${report.total_runs}
  - Failures: ${report.failures}
  - Status: ${report.quarantined ? 'QUARANTINED' : 'Active'}
`).join('\n')}
${reports.length > 3 ? `\n...and ${reports.length - 3} more` : ''}

**Action Required:**
1. Review flaky test logs
2. Stabilize tests (fix timing issues, remove non-deterministic behavior)
3. Tests will be restored after 20 consecutive passes
    `.trim();

    await this.sendTelegramMessage(message);
  }

  /**
   * Send notification when coverage threshold is met
   */
  async notifyCoverageSuccess(metrics: TestCoverageMetrics): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Only notify if coverage is excellent (>= 90%)
    if (metrics.coverage_percentage < 90) {
      return;
    }

    const message = `
✅ **Excellent Test Coverage!**

**Coverage:** ${metrics.coverage_percentage.toFixed(1)}%
**Covered Patterns:** ${metrics.covered_accident_patterns}/${metrics.total_accident_patterns}

**By Severity:**
• Critical: ${metrics.critical_covered}/${metrics.critical_total} ✅
• High: ${metrics.high_covered}/${metrics.high_total} ✅
• Medium: ${metrics.medium_covered}/${metrics.medium_total}
• Low: ${metrics.low_covered}/${metrics.low_total}

Great work maintaining comprehensive Golden Test coverage! 🎉
    `.trim();

    await this.sendTelegramMessage(message);
  }

  /**
   * Send Telegram message via API
   */
  private async sendTelegramMessage(message: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.telegramChatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        console.error('[CINotifications] Failed to send Telegram notification:', response.statusText);
      } else {
        console.log('[CINotifications] Telegram notification sent successfully');
      }
    } catch (error) {
      console.error('[CINotifications] Error sending Telegram notification:', error);
    }
  }
}
