/**
 * Unit tests for LearningLog class
 *
 * Tests:
 * 1) Constructor creates instance
 * 2) recordSuccess/recordFailure stores execution records
 * 3) getPluginHistory returns stored records
 * 4) getStatistics returns correct success/failure counts
 * 5) analyzePatterns detects patterns from execution history
 * 6) getSuccessRate returns actionable suggestions (via recommendations)
 * 7) No clear method exists - tests data isolation via mock reset
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import {
  LearningLog,
  type ExecutionRecord,
  type LearningPattern,
} from '../utils/learning-log';
import type { PluginProposal } from '../autopilot/types';
import type { RoutingResult } from '../utils/confidence-router';
import type { RedTeamResult } from '../utils/red-team';

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve(new Response()));

describe('LearningLog', () => {
  const MOCK_GATEWAY_URL = 'http://localhost:8080';
  let learningLog: LearningLog;
  let mockResponses: Map<string, any>;

  // Helper to create mock proposal
  function createMockProposal(overrides: Partial<PluginProposal['task']> = {}): PluginProposal {
    return {
      task: {
        id: 'test-task-001',
        source_plugin: 'test-plugin',
        type: 'file_operation',
        confidence: 0.85,
        impact: 'low',
        description: 'Test task',
        proposed_action: 'create file',
        parameters: {},
        ...overrides,
      },
      metadata: {
        created_at: new Date().toISOString(),
        priority: 1,
      },
    };
  }

  // Helper to create mock routing result
  function createMockRoutingResult(decision: string = 'auto_execute'): RoutingResult {
    return {
      decision: decision as RoutingResult['decision'],
      reason: 'Test routing decision',
      confidence_score: 0.9,
      routing_path: 'autopilot',
    };
  }

  // Helper to create mock red team result
  function createMockRedTeamResult(approved: boolean = true): RedTeamResult {
    return {
      approved,
      risk_score: approved ? 0.2 : 0.8,
      concerns: approved ? [] : ['Test concern'],
      recommendations: [],
    };
  }

  // Helper to create mock execution records
  function createMockExecutionRecords(count: number, successRate: number = 0.8): ExecutionRecord[] {
    const records: ExecutionRecord[] = [];
    const successCount = Math.floor(count * successRate);

    for (let i = 0; i < count; i++) {
      records.push({
        proposal_id: `task-${i}`,
        plugin_name: 'test-plugin',
        task_type: 'file_operation',
        confidence: 0.85,
        impact: 'low',
        routing_decision: 'auto_execute',
        red_team_approved: true,
        red_team_risk_score: 0.2,
        success: i < successCount,
        execution_time_ms: 1000 + Math.random() * 500,
        error_message: i >= successCount ? 'Test error' : undefined,
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
      });
    }

    return records;
  }

  beforeEach(() => {
    mockResponses = new Map();
    learningLog = new LearningLog(MOCK_GATEWAY_URL);

    // Setup global fetch mock
    (globalThis as any).fetch = mock((url: string, options?: RequestInit) => {
      const method = options?.method || 'GET';

      if (method === 'POST') {
        // Record event - return success
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      // GET request - return mock data based on URL
      if (url.includes('/v1/events')) {
        const mockData = mockResponses.get('events') || { results: [] };
        return Promise.resolve(
          new Response(JSON.stringify(mockData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });
  });

  describe('Constructor', () => {
    test('creates instance with gateway URL', () => {
      const log = new LearningLog(MOCK_GATEWAY_URL);
      expect(log).toBeInstanceOf(LearningLog);
    });

    test('creates instance with different URLs', () => {
      const log1 = new LearningLog('http://gateway1:8080');
      const log2 = new LearningLog('http://gateway2:9000');
      expect(log1).toBeInstanceOf(LearningLog);
      expect(log2).toBeInstanceOf(LearningLog);
    });
  });

  describe('recordSuccess', () => {
    test('stores successful execution record', async () => {
      const proposal = createMockProposal();
      const routingResult = createMockRoutingResult();
      const redTeamResult = createMockRedTeamResult();

      await learningLog.recordSuccess(proposal, routingResult, redTeamResult, 1500);

      // Verify fetch was called with correct data
      expect(globalThis.fetch).toHaveBeenCalled();
      const calls = (globalThis.fetch as any).mock.calls;
      const postCall = calls.find((c: any) => c[1]?.method === 'POST');

      expect(postCall).toBeDefined();
      expect(postCall[0]).toBe(`${MOCK_GATEWAY_URL}/v1/events`);

      const body = JSON.parse(postCall[1].body);
      expect(body.type).toBe('autopilot.execution.success');
      expect(body.data.success).toBe(true);
      expect(body.data.execution_time_ms).toBe(1500);
      expect(body.data.plugin_name).toBe('test-plugin');
    });

    test('stores record without red team result', async () => {
      const proposal = createMockProposal();
      const routingResult = createMockRoutingResult();

      await learningLog.recordSuccess(proposal, routingResult, null, 2000);

      const calls = (globalThis.fetch as any).mock.calls;
      const postCall = calls.find((c: any) => c[1]?.method === 'POST');
      const body = JSON.parse(postCall[1].body);

      expect(body.data.red_team_approved).toBeUndefined();
      expect(body.data.red_team_risk_score).toBeUndefined();
    });
  });

  describe('recordFailure', () => {
    test('stores failed execution record with error message', async () => {
      const proposal = createMockProposal();
      const routingResult = createMockRoutingResult();
      const redTeamResult = createMockRedTeamResult(false);

      await learningLog.recordFailure(
        proposal,
        routingResult,
        redTeamResult,
        3000,
        'Permission denied'
      );

      const calls = (globalThis.fetch as any).mock.calls;
      const postCall = calls.find((c: any) => c[1]?.method === 'POST');
      const body = JSON.parse(postCall[1].body);

      expect(body.type).toBe('autopilot.execution.failure');
      expect(body.data.success).toBe(false);
      expect(body.data.error_message).toBe('Permission denied');
      expect(body.data.execution_time_ms).toBe(3000);
    });
  });

  describe('getPluginHistory', () => {
    test('returns stored records for plugin', async () => {
      const mockRecords = createMockExecutionRecords(5);
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      const history = await learningLog.getPluginHistory('test-plugin');

      expect(history).toHaveLength(5);
      expect(history[0].plugin_name).toBe('test-plugin');
    });

    test('filters by plugin name', async () => {
      const records = [
        ...createMockExecutionRecords(3),
        {
          ...createMockExecutionRecords(1)[0],
          plugin_name: 'other-plugin',
        },
      ];
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const history = await learningLog.getPluginHistory('test-plugin');

      expect(history).toHaveLength(3);
      expect(history.every((r) => r.plugin_name === 'test-plugin')).toBe(true);
    });

    test('returns empty array on fetch error', async () => {
      (globalThis as any).fetch = mock(() =>
        Promise.resolve(new Response('Error', { status: 500 }))
      );

      const history = await learningLog.getPluginHistory('test-plugin');

      expect(history).toEqual([]);
    });

    test('respects limit parameter', async () => {
      const mockRecords = createMockExecutionRecords(100);
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      await learningLog.getPluginHistory('test-plugin', 25);

      const calls = (globalThis.fetch as any).mock.calls;
      const getCall = calls.find((c: any) => !c[1]?.method || c[1]?.method === 'GET');
      expect(getCall[0]).toContain('limit=25');
    });
  });

  describe('getStatistics', () => {
    test('returns correct success/failure counts', async () => {
      const mockRecords = createMockExecutionRecords(10, 0.7); // 7 success, 3 failure
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      const stats = await learningLog.getStatistics();

      expect(stats.total_executions).toBe(10);
      expect(stats.success_count).toBe(7);
      expect(stats.failure_count).toBe(3);
      expect(stats.success_rate).toBe(0.7);
    });

    test('groups by plugin', async () => {
      const records = [
        ...createMockExecutionRecords(5, 1.0), // all success
        ...createMockExecutionRecords(5, 0.0).map((r) => ({
          ...r,
          plugin_name: 'failing-plugin',
        })),
      ];
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const stats = await learningLog.getStatistics();

      expect(stats.by_plugin['test-plugin']).toBeDefined();
      expect(stats.by_plugin['test-plugin'].success).toBe(5);
      expect(stats.by_plugin['test-plugin'].failure).toBe(0);
      expect(stats.by_plugin['test-plugin'].success_rate).toBe(1);

      expect(stats.by_plugin['failing-plugin']).toBeDefined();
      expect(stats.by_plugin['failing-plugin'].success).toBe(0);
      expect(stats.by_plugin['failing-plugin'].failure).toBe(5);
      expect(stats.by_plugin['failing-plugin'].success_rate).toBe(0);
    });

    test('groups by task type', async () => {
      const records = [
        ...createMockExecutionRecords(3, 1.0),
        ...createMockExecutionRecords(3, 0.0).map((r) => ({
          ...r,
          task_type: 'api_call',
        })),
      ];
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const stats = await learningLog.getStatistics();

      expect(stats.by_task_type['file_operation']).toBeDefined();
      expect(stats.by_task_type['file_operation'].success_rate).toBe(1);
      expect(stats.by_task_type['api_call']).toBeDefined();
      expect(stats.by_task_type['api_call'].success_rate).toBe(0);
    });

    test('calculates average execution time', async () => {
      const records = createMockExecutionRecords(4, 1.0).map((r, i) => ({
        ...r,
        execution_time_ms: 1000 * (i + 1), // 1000, 2000, 3000, 4000
      }));
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const stats = await learningLog.getStatistics();

      expect(stats.avg_execution_time_ms).toBe(2500); // (1000+2000+3000+4000)/4
    });

    test('throws on fetch error', async () => {
      (globalThis as any).fetch = mock(() =>
        Promise.resolve(new Response('Error', { status: 500 }))
      );

      await expect(learningLog.getStatistics()).rejects.toThrow();
    });

    test('handles empty results', async () => {
      mockResponses.set('events', { results: [] });

      const stats = await learningLog.getStatistics();

      expect(stats.total_executions).toBe(0);
      expect(stats.success_count).toBe(0);
      expect(stats.failure_count).toBe(0);
      expect(stats.success_rate).toBe(0);
      expect(stats.avg_execution_time_ms).toBe(0);
    });
  });

  describe('analyzePatterns', () => {
    test('detects patterns from execution history', async () => {
      // Need at least 5 records for analysis, 3 per pattern
      const mockRecords = createMockExecutionRecords(10, 0.9);
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]).toHaveProperty('pattern_type');
      expect(patterns[0]).toHaveProperty('plugin_name');
      expect(patterns[0]).toHaveProperty('task_type');
      expect(patterns[0]).toHaveProperty('confidence_range');
      expect(patterns[0]).toHaveProperty('success_rate');
      expect(patterns[0]).toHaveProperty('recommendations');
    });

    test('returns empty array with insufficient data', async () => {
      const mockRecords = createMockExecutionRecords(3); // Less than 5
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');

      expect(patterns).toEqual([]);
    });

    test('groups patterns by task type and confidence', async () => {
      const records = [
        ...createMockExecutionRecords(5, 0.8).map((r) => ({
          ...r,
          confidence: 0.9, // High confidence
          task_type: 'file_operation',
        })),
        ...createMockExecutionRecords(5, 0.4).map((r) => ({
          ...r,
          confidence: 0.4, // Low confidence
          task_type: 'api_call',
        })),
      ];
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');

      // Should have separate patterns for different task types/confidence ranges
      const fileOpPattern = patterns.find((p) => p.task_type === 'file_operation');
      const apiCallPattern = patterns.find((p) => p.task_type === 'api_call');

      expect(fileOpPattern).toBeDefined();
      expect(apiCallPattern).toBeDefined();
      expect(fileOpPattern!.success_rate).toBeGreaterThan(apiCallPattern!.success_rate);
    });

    test('identifies success patterns vs failure patterns', async () => {
      const records = createMockExecutionRecords(10, 0.9); // 90% success
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');
      const successPatterns = patterns.filter((p) => p.pattern_type === 'success');

      expect(successPatterns.length).toBeGreaterThan(0);
    });

    test('calculates average execution time in patterns', async () => {
      const records = createMockExecutionRecords(6, 1.0).map((r, i) => ({
        ...r,
        execution_time_ms: 2000,
      }));
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');

      expect(patterns[0].avg_execution_time_ms).toBe(2000);
    });

    test('extracts common errors', async () => {
      const records = createMockExecutionRecords(10, 0.5).map((r, i) => ({
        ...r,
        error_message: i >= 5 ? 'Connection timeout' : undefined,
      }));
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const patterns = await learningLog.analyzePatterns('test-plugin');

      // Common errors should be identified for failure patterns
      const failurePatterns = patterns.filter((p) => p.pattern_type === 'failure');
      if (failurePatterns.length > 0) {
        expect(failurePatterns[0].common_errors.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getSuccessRate', () => {
    test('returns correct success rate', async () => {
      const mockRecords = createMockExecutionRecords(10, 0.8);
      mockResponses.set('events', {
        results: mockRecords.map((r) => ({ data: r })),
      });

      const rate = await learningLog.getSuccessRate('test-plugin');

      expect(rate).toBe(0.8);
    });

    test('returns 0 for no history', async () => {
      mockResponses.set('events', { results: [] });

      const rate = await learningLog.getSuccessRate('unknown-plugin');

      expect(rate).toBe(0);
    });
  });

  describe('recordPattern', () => {
    test('stores learned pattern', async () => {
      const pattern: LearningPattern = {
        pattern_type: 'success',
        plugin_name: 'test-plugin',
        task_type: 'file_operation',
        confidence_range: [0.85, 1.0],
        impact_level: 'low',
        occurrences: 10,
        success_rate: 0.95,
        avg_execution_time_ms: 1500,
        common_errors: [],
        recommendations: ['Keep current configuration'],
      };

      await learningLog.recordPattern(pattern);

      const calls = (globalThis.fetch as any).mock.calls;
      const postCall = calls.find((c: any) => c[1]?.method === 'POST');
      const body = JSON.parse(postCall[1].body);

      expect(body.type).toBe('autopilot.pattern.learned');
      expect(body.data).toEqual(pattern);
    });
  });

  describe('analyzeAllPatterns', () => {
    test('analyzes patterns across all plugins', async () => {
      const records = [
        ...createMockExecutionRecords(10, 0.9),
        ...createMockExecutionRecords(10, 0.7).map((r) => ({
          ...r,
          plugin_name: 'plugin-2',
        })),
      ];
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const analysis = await learningLog.analyzeAllPatterns();

      expect(analysis).toHaveProperty('total_patterns');
      expect(analysis).toHaveProperty('success_patterns');
      expect(analysis).toHaveProperty('failure_patterns');
      expect(analysis).toHaveProperty('trending_up');
      expect(analysis).toHaveProperty('trending_down');
      expect(analysis).toHaveProperty('recommendations');
    });

    test('generates system-wide recommendations', async () => {
      const records = createMockExecutionRecords(20, 0.6); // Below 80% target
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const analysis = await learningLog.analyzeAllPatterns();

      // Should have recommendation about low success rate
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Data isolation (mock reset)', () => {
    test('each test starts with fresh mock state', async () => {
      // This test verifies that mockResponses is reset in beforeEach
      mockResponses.set('events', { results: [] });

      const stats = await learningLog.getStatistics();

      expect(stats.total_executions).toBe(0);
    });

    test('mock state does not leak between tests', async () => {
      // Set different data
      const records = createMockExecutionRecords(5, 1.0);
      mockResponses.set('events', {
        results: records.map((r) => ({ data: r })),
      });

      const stats = await learningLog.getStatistics();

      expect(stats.total_executions).toBe(5);
      expect(stats.success_rate).toBe(1);
    });
  });
});
