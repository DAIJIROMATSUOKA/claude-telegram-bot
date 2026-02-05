/**
 * Darwin Engine v1.3 - Workflow Optimizer
 *
 * Self-learning workflow optimization system
 *
 * Features:
 * 1. Pattern Mining - Extract recurring workflow patterns from history
 * 2. Bottleneck Detection - Identify slow actions (2x+ slower than baseline)
 * 3. Time Prediction - Predict action duration based on historical data
 * 4. Auto-Skip Suggestions - Detect steps that are consistently skipped
 * 5. Scheduled Analysis - Daily pattern analysis via cron
 *
 * @module darwin/workflow-optimizer
 */

import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowPattern {
  pattern_hash: string;
  pattern_type: 'sequence' | 'parallel' | 'conditional';
  pattern_name: string;
  pattern_description: string;
  action_sequence: string; // JSON array
  frequency_count: number;
  avg_duration_ms: number;
  success_rate: number;
  last_seen_at: string;
  metadata?: string;
}

export interface BottleneckDetection {
  action_name: string;
  action_type: string;
  expected_duration_ms: number;
  actual_duration_ms: number;
  slowdown_factor: number;
  session_id: string;
  suggested_optimization?: string;
}

export interface TimePrediction {
  action_name: string;
  action_type: string;
  predicted_duration_ms: number;
  prediction_confidence: number;
  based_on_samples: number;
  session_id: string;
}

export interface AutoSkipCandidate {
  step_name: string;
  step_description?: string;
  skip_count: number;
  total_appearances: number;
  skip_rate: number;
  auto_skip_enabled: boolean;
  user_approved: boolean;
}

export interface AnalysisRun {
  run_id: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  patterns_discovered: number;
  bottlenecks_detected: number;
  predictions_made: number;
  skip_candidates_found: number;
  analysis_summary?: string;
  error_message?: string;
}

// ============================================================================
// Database Client
// ============================================================================

export class WorkflowDB {
  private gatewayUrl: string;
  private apiKey: string;

  constructor(gatewayUrl: string, apiKey: string) {
    this.gatewayUrl = gatewayUrl;
    this.apiKey = apiKey;
  }

  async query(sql: string, params?: any[]): Promise<any> {
    const response = await fetch(`${this.gatewayUrl}/v1/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      throw new Error(`DB query failed: ${response.statusText}`);
    }

    return response.json();
  }

  // === Pattern Mining ===

  async getActionHistory(limit: number = 1000): Promise<any[]> {
    const result = await this.query(
      `SELECT action_name, action_type, status, duration_ms, started_at, session_id
       FROM jarvis_action_trace
       WHERE status = 'completed'
       ORDER BY started_at DESC
       LIMIT ?`,
      [limit]
    );
    return result.results || [];
  }

  async savePattern(pattern: WorkflowPattern): Promise<void> {
    await this.query(
      `INSERT INTO workflow_patterns
       (pattern_hash, pattern_type, pattern_name, pattern_description, action_sequence,
        frequency_count, avg_duration_ms, success_rate, last_seen_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pattern_hash) DO UPDATE SET
         frequency_count = frequency_count + 1,
         avg_duration_ms = (avg_duration_ms + excluded.avg_duration_ms) / 2,
         last_seen_at = excluded.last_seen_at`,
      [
        pattern.pattern_hash,
        pattern.pattern_type,
        pattern.pattern_name,
        pattern.pattern_description,
        pattern.action_sequence,
        pattern.frequency_count,
        pattern.avg_duration_ms,
        pattern.success_rate,
        pattern.last_seen_at,
        pattern.metadata,
      ]
    );
  }

  async getTopPatterns(limit: number = 10): Promise<WorkflowPattern[]> {
    const result = await this.query(
      `SELECT * FROM workflow_patterns
       ORDER BY frequency_count DESC
       LIMIT ?`,
      [limit]
    );
    return result.results || [];
  }

  // === Bottleneck Detection ===

  async saveBottleneck(bottleneck: BottleneckDetection): Promise<void> {
    await this.query(
      `INSERT INTO bottleneck_detections
       (action_name, action_type, expected_duration_ms, actual_duration_ms,
        slowdown_factor, session_id, suggested_optimization)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        bottleneck.action_name,
        bottleneck.action_type,
        bottleneck.expected_duration_ms,
        bottleneck.actual_duration_ms,
        bottleneck.slowdown_factor,
        bottleneck.session_id,
        bottleneck.suggested_optimization,
      ]
    );
  }

  async getBottlenecks(limit: number = 20): Promise<BottleneckDetection[]> {
    const result = await this.query(
      `SELECT * FROM bottleneck_detections
       WHERE resolved = 0
       ORDER BY detected_at DESC
       LIMIT ?`,
      [limit]
    );
    return result.results || [];
  }

  async getAverageDuration(actionName: string): Promise<number | null> {
    const result = await this.query(
      `SELECT AVG(duration_ms) as avg_duration
       FROM jarvis_action_trace
       WHERE action_name = ? AND status = 'completed' AND duration_ms IS NOT NULL`,
      [actionName]
    );

    const avgDuration = result.results?.[0]?.avg_duration;
    return avgDuration !== null && avgDuration !== undefined ? Math.round(avgDuration) : null;
  }

  // === Time Prediction ===

  async savePrediction(prediction: TimePrediction): Promise<void> {
    await this.query(
      `INSERT INTO time_predictions
       (action_name, action_type, predicted_duration_ms, prediction_confidence,
        based_on_samples, session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        prediction.action_name,
        prediction.action_type,
        prediction.predicted_duration_ms,
        prediction.prediction_confidence,
        prediction.based_on_samples,
        prediction.session_id,
      ]
    );
  }

  async getHistoricalDurations(actionName: string, limit: number = 50): Promise<number[]> {
    const result = await this.query(
      `SELECT duration_ms
       FROM jarvis_action_trace
       WHERE action_name = ? AND status = 'completed' AND duration_ms IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ?`,
      [actionName, limit]
    );

    return (result.results || []).map((r: any) => r.duration_ms);
  }

  // === Auto-Skip Suggestions ===

  async updateSkipCandidate(stepName: string, skipped: boolean): Promise<void> {
    await this.query(
      `INSERT INTO auto_skip_candidates (step_name, skip_count, total_appearances, skip_rate, last_skipped_at)
       VALUES (?, ?, 1, ?, datetime('now'))
       ON CONFLICT(step_name) DO UPDATE SET
         skip_count = skip_count + ?,
         total_appearances = total_appearances + 1,
         skip_rate = CAST(skip_count + ? AS REAL) / (total_appearances + 1),
         last_skipped_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_skipped_at END`,
      [
        stepName,
        skipped ? 1 : 0,
        skipped ? 1.0 : 0.0,
        skipped ? 1 : 0,
        skipped ? 1 : 0,
        skipped ? 1 : 0,
      ]
    );
  }

  async getSkipCandidates(threshold: number = 0.9): Promise<AutoSkipCandidate[]> {
    const result = await this.query(
      `SELECT * FROM auto_skip_candidates
       WHERE skip_rate >= ? AND total_appearances >= 10
       ORDER BY skip_rate DESC`,
      [threshold]
    );
    return result.results || [];
  }

  // === Analysis Runs ===

  async createAnalysisRun(runId: string): Promise<void> {
    await this.query(
      `INSERT INTO pattern_analysis_runs (run_id, status)
       VALUES (?, 'running')`,
      [runId]
    );
  }

  async completeAnalysisRun(
    runId: string,
    stats: {
      patterns_discovered: number;
      bottlenecks_detected: number;
      predictions_made: number;
      skip_candidates_found: number;
      analysis_summary?: string;
    }
  ): Promise<void> {
    await this.query(
      `UPDATE pattern_analysis_runs
       SET status = 'completed',
           completed_at = datetime('now'),
           patterns_discovered = ?,
           bottlenecks_detected = ?,
           predictions_made = ?,
           skip_candidates_found = ?,
           analysis_summary = ?
       WHERE run_id = ?`,
      [
        stats.patterns_discovered,
        stats.bottlenecks_detected,
        stats.predictions_made,
        stats.skip_candidates_found,
        stats.analysis_summary,
        runId,
      ]
    );
  }

  async failAnalysisRun(runId: string, errorMessage: string): Promise<void> {
    await this.query(
      `UPDATE pattern_analysis_runs
       SET status = 'failed',
           completed_at = datetime('now'),
           error_message = ?
       WHERE run_id = ?`,
      [errorMessage, runId]
    );
  }
}

// ============================================================================
// Workflow Analyzer
// ============================================================================

export class WorkflowAnalyzer {
  private db: WorkflowDB;

  constructor(db: WorkflowDB) {
    this.db = db;
  }

  /**
   * Mine workflow patterns from action history
   */
  async minePatterns(): Promise<number> {
    const history = await this.db.getActionHistory(1000);
    let patternsFound = 0;

    // Group actions by session
    const sessions = new Map<string, any[]>();
    for (const action of history) {
      const sessionActions = sessions.get(action.session_id) || [];
      sessionActions.push(action);
      sessions.set(action.session_id, sessionActions);
    }

    // Extract sequences (3+ consecutive actions)
    for (const [sessionId, actions] of sessions.entries()) {
      if (actions.length < 3) continue;

      // Sort by started_at
      actions.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

      // Find sequences of 3-5 actions
      for (let seqLength = 3; seqLength <= Math.min(5, actions.length); seqLength++) {
        for (let i = 0; i <= actions.length - seqLength; i++) {
          const sequence = actions.slice(i, i + seqLength);
          const actionNames = sequence.map((a) => a.action_name);
          const actionSequenceJson = JSON.stringify(actionNames);
          const patternHash = createHash('md5').update(actionSequenceJson).digest('hex');

          const totalDuration = sequence.reduce((sum, a) => sum + (a.duration_ms || 0), 0);
          const avgDuration = Math.round(totalDuration / sequence.length);

          const pattern: WorkflowPattern = {
            pattern_hash: patternHash,
            pattern_type: 'sequence',
            pattern_name: `${actionNames[0]} → ... → ${actionNames[actionNames.length - 1]}`,
            pattern_description: `Sequence of ${seqLength} actions`,
            action_sequence: actionSequenceJson,
            frequency_count: 1,
            avg_duration_ms: avgDuration,
            success_rate: 1.0,
            last_seen_at: new Date().toISOString(),
          };

          await this.db.savePattern(pattern);
          patternsFound++;
        }
      }
    }

    return patternsFound;
  }

  /**
   * Detect bottlenecks (actions taking 2x+ expected time)
   */
  async detectBottlenecks(): Promise<number> {
    const history = await this.db.getActionHistory(500);
    let bottlenecksFound = 0;

    for (const action of history) {
      if (!action.duration_ms || action.duration_ms < 1000) continue;

      const avgDuration = await this.db.getAverageDuration(action.action_name);
      if (!avgDuration || avgDuration === 0) continue;

      const slowdownFactor = action.duration_ms / avgDuration;

      if (slowdownFactor >= 2.0) {
        const bottleneck: BottleneckDetection = {
          action_name: action.action_name,
          action_type: action.action_type,
          expected_duration_ms: avgDuration,
          actual_duration_ms: action.duration_ms,
          slowdown_factor: Math.round(slowdownFactor * 10) / 10,
          session_id: action.session_id,
          suggested_optimization: `This action took ${slowdownFactor.toFixed(1)}x longer than usual. Consider optimization.`,
        };

        await this.db.saveBottleneck(bottleneck);
        bottlenecksFound++;
      }
    }

    return bottlenecksFound;
  }

  /**
   * Generate time predictions for common actions
   */
  async generatePredictions(sessionId: string): Promise<number> {
    const commonActions = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'];
    let predictionsMade = 0;

    for (const actionName of commonActions) {
      const durations = await this.db.getHistoricalDurations(actionName, 50);
      if (durations.length < 5) continue;

      // Calculate median and confidence
      const sorted = durations.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const confidence = Math.min(durations.length / 50, 1.0);

      const prediction: TimePrediction = {
        action_name: actionName,
        action_type: 'tool',
        predicted_duration_ms: median,
        prediction_confidence: Math.round(confidence * 100) / 100,
        based_on_samples: durations.length,
        session_id: sessionId,
      };

      await this.db.savePrediction(prediction);
      predictionsMade++;
    }

    return predictionsMade;
  }

  /**
   * Find auto-skip candidates (90%+ skip rate, 10+ appearances)
   */
  async findSkipCandidates(): Promise<number> {
    const candidates = await this.db.getSkipCandidates(0.9);
    return candidates.length;
  }
}

// ============================================================================
// Exports
// ============================================================================

export function createWorkflowOptimizer(gatewayUrl: string, apiKey: string): WorkflowAnalyzer {
  const db = new WorkflowDB(gatewayUrl, apiKey);
  return new WorkflowAnalyzer(db);
}
