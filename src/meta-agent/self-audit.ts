// Self-Audit Engine
// Analyzes logs/bot.log to detect errors, measure performance, estimate satisfaction

import { readFileSync, statSync } from 'fs';
import { ulid } from 'ulid';
import { getDb } from './db.js';
import type { SelfAuditResult, MetaAgentLog } from './types.js';

export interface AuditIssue {
  type: 'error' | 'warning' | 'performance' | 'satisfaction';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  count?: number;
}

export interface AuditRecommendation {
  priority: 'low' | 'medium' | 'high';
  action: string;
  reason: string;
}

/**
 * Perform self-audit by analyzing bot.log
 */
export async function performSelfAudit(logPath: string = './logs/bot.log'): Promise<SelfAuditResult> {
  const db = getDb();
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const startTime = Date.now();

  // Log start
  const logId = ulid();
  db.prepare(`
    INSERT INTO meta_agent_log (log_id, action_type, action_status, started_at)
    VALUES (?, 'self_audit', 'started', datetime('now'))
  `).run(logId);

  try {
    // Read log file
    let logContent: string;
    let logFileSize: number;
    try {
      logContent = readFileSync(logPath, 'utf-8');
      logFileSize = statSync(logPath).size;
    } catch (error) {
      console.warn(`⚠️  Log file not found: ${logPath}`);
      logContent = '';
      logFileSize = 0;
    }

    const lines = logContent.split('\n').filter((line) => line.trim().length > 0);

    // Count errors
    const errorCount = lines.filter((line) =>
      line.toLowerCase().includes('error') ||
      line.includes('❌') ||
      line.toLowerCase().includes('failed')
    ).length;

    // Extract response times (if logged)
    const responseTimes: number[] = [];
    lines.forEach((line) => {
      const match = line.match(/response[_\s]time[:\s]*(\d+)\s*ms/i);
      if (match) {
        responseTimes.push(parseInt(match[1], 10));
      }
    });
    const avgResponseMs = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

    // Estimate satisfaction (simple heuristic)
    // Low error count + fast response = high satisfaction
    const satisfactionScore = estimateSatisfaction(errorCount, avgResponseMs);

    // Detect issues
    const issues = detectIssues(lines, errorCount, avgResponseMs);

    // Generate recommendations
    const recommendations = generateRecommendations(issues);

    // Count messages and sessions
    const totalMessages = lines.filter((line) => line.includes('Received message')).length;

    // Get total sessions (use focus_sessions if control_tower doesn't exist)
    let totalSessions = 0;
    try {
      const sessionResult = db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM focus_sessions').get() as { count: number } | undefined;
      totalSessions = sessionResult?.count || 0;
    } catch (error) {
      // Table doesn't exist, default to 0
      totalSessions = 0;
    }

    const auditResult: SelfAuditResult = {
      date,
      error_count: errorCount,
      avg_response_ms: avgResponseMs,
      satisfaction_score: satisfactionScore,
      issues_found: JSON.stringify(issues),
      recommendations: JSON.stringify(recommendations),
      log_file_size: logFileSize,
      total_messages: totalMessages,
      total_sessions: totalSessions,
      metadata: JSON.stringify({
        log_path: logPath,
        lines_analyzed: lines.length,
        response_times_sampled: responseTimes.length,
      }),
    };

    // Save to DB
    db.prepare(`
      INSERT OR REPLACE INTO self_audit_results
      (date, error_count, avg_response_ms, satisfaction_score, issues_found, recommendations, log_file_size, total_messages, total_sessions, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditResult.date,
      auditResult.error_count,
      auditResult.avg_response_ms,
      auditResult.satisfaction_score,
      auditResult.issues_found,
      auditResult.recommendations,
      auditResult.log_file_size,
      auditResult.total_messages,
      auditResult.total_sessions,
      auditResult.metadata
    );

    // Update log
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'completed', completed_at = datetime('now'), duration_ms = ?, result_summary = ?
      WHERE log_id = ?
    `).run(duration, `Audit complete: ${errorCount} errors, satisfaction ${satisfactionScore.toFixed(2)}`, logId);

    return auditResult;
  } catch (error) {
    // Log failure
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'failed', completed_at = datetime('now'), error_message = ?
      WHERE log_id = ?
    `).run(error instanceof Error ? error.message : String(error), logId);

    throw error;
  }
}

function estimateSatisfaction(errorCount: number, avgResponseMs: number | null): number {
  // Simple heuristic
  let score = 1.0;

  // Penalty for errors (0.1 per error, max -0.5)
  score -= Math.min(errorCount * 0.1, 0.5);

  // Penalty for slow response (>5s = -0.2, >10s = -0.4)
  if (avgResponseMs) {
    if (avgResponseMs > 10000) score -= 0.4;
    else if (avgResponseMs > 5000) score -= 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

function detectIssues(lines: string[], errorCount: number, avgResponseMs: number | null): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // High error count
  if (errorCount > 10) {
    issues.push({
      type: 'error',
      severity: 'high',
      description: `High error count detected: ${errorCount} errors`,
      count: errorCount,
    });
  }

  // Slow response time
  if (avgResponseMs && avgResponseMs > 5000) {
    issues.push({
      type: 'performance',
      severity: avgResponseMs > 10000 ? 'high' : 'medium',
      description: `Slow average response time: ${avgResponseMs}ms`,
    });
  }

  // Repeated errors
  const errorMessages = new Map<string, number>();
  lines.filter((line) => line.toLowerCase().includes('error')).forEach((line) => {
    const count = errorMessages.get(line) || 0;
    errorMessages.set(line, count + 1);
  });
  errorMessages.forEach((count, msg) => {
    if (count > 3) {
      issues.push({
        type: 'error',
        severity: 'medium',
        description: `Repeated error detected ${count} times`,
        count,
      });
    }
  });

  return issues;
}

function generateRecommendations(issues: AuditIssue[]): AuditRecommendation[] {
  const recommendations: AuditRecommendation[] = [];

  issues.forEach((issue) => {
    if (issue.type === 'error' && issue.severity === 'high') {
      recommendations.push({
        priority: 'high',
        action: 'Review error logs and add error handling',
        reason: `High error count (${issue.count}) detected`,
      });
    }
    if (issue.type === 'performance' && issue.severity === 'high') {
      recommendations.push({
        priority: 'high',
        action: 'Optimize slow operations (caching, async processing)',
        reason: 'Response time exceeds 10 seconds',
      });
    }
  });

  return recommendations;
}

/**
 * Get latest audit result
 */
export function getLatestAudit(): SelfAuditResult | null {
  const db = getDb();
  const result = db.prepare('SELECT * FROM self_audit_results ORDER BY date DESC LIMIT 1').get() as SelfAuditResult | undefined;
  return result || null;
}

/**
 * Get audit history (last N days)
 */
export function getAuditHistory(days: number = 7): SelfAuditResult[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM self_audit_results
    ORDER BY date DESC
    LIMIT ?
  `).all(days) as SelfAuditResult[];
}
