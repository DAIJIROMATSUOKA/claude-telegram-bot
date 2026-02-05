/**
 * Tower Renderer Test Suite
 * Phase B: S0-S1 - Safe Render + Plain Text
 */

import { describe, test, expect } from 'bun:test';
import {
  renderTower,
  computeRenderHash,
  hasChanged,
  type TowerState,
} from '../utils/tower-renderer.js';

describe('Tower Renderer', () => {
  // ==========================================================================
  // Basic Rendering
  // ==========================================================================

  test('should render idle state', () => {
    const state: TowerState = {
      status: 'idle',
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('⏸️ Control Tower');
    expect(rendered).toContain('Status: idle');
    expect(rendered).not.toContain('*'); // No Markdown
    expect(rendered).not.toContain('_'); // No italics
    expect(rendered).not.toContain('`'); // No code blocks
  });

  test('should render running state with task', () => {
    const state: TowerState = {
      status: 'running',
      taskTitle: 'Processing data',
      currentStep: 'Step 1: Loading',
      startedAt: Date.now() - 5000, // 5 seconds ago
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('▶️ Control Tower');
    expect(rendered).toContain('Task: Processing data');
    expect(rendered).toContain('Step: Step 1: Loading');
    expect(rendered).toContain('Elapsed: 5s');
  });

  test('should render completed state', () => {
    const state: TowerState = {
      status: 'completed',
      taskTitle: 'Data processing',
      startedAt: Date.now() - 10000,
      completedAt: Date.now(),
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('✅ Control Tower');
    expect(rendered).toContain('Status: completed');
    expect(rendered).toContain('Completed:');
    expect(rendered).toContain('(10s)');
  });

  test('should render failed state with errors', () => {
    const state: TowerState = {
      status: 'failed',
      taskTitle: 'Failed task',
      errors: ['Connection timeout', 'Invalid credentials'],
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('❌ Control Tower');
    expect(rendered).toContain('⚠️ Errors:');
    expect(rendered).toContain('Connection timeout');
    expect(rendered).toContain('Invalid credentials');
  });

  // ==========================================================================
  // Progress Rendering
  // ==========================================================================

  test('should render progress', () => {
    const state: TowerState = {
      status: 'running',
      progress: { current: 3, total: 10 },
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('Progress: 3/10 (30%)');
  });

  test('should handle zero total progress', () => {
    const state: TowerState = {
      status: 'running',
      progress: { current: 0, total: 0 },
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('Progress: 0/0 (0%)');
  });

  // ==========================================================================
  // Redaction
  // ==========================================================================

  test('should redact sensitive data in task title', () => {
    const state: TowerState = {
      status: 'running',
      taskTitle: 'Using API key sk-1234567890abcdefghijklmnopqr',
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('[OPENAI_KEY]');
    expect(rendered).not.toContain('sk-1234567890abcdefghijklmnopqr');
  });

  test('should redact email in current step', () => {
    const state: TowerState = {
      status: 'running',
      currentStep: 'Sending to john@example.com',
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('[EMAIL]');
    expect(rendered).not.toContain('john@example.com');
  });

  test('should redact Bearer token in errors', () => {
    const state: TowerState = {
      status: 'failed',
      errors: ['Auth failed with Bearer abc123def456ghi789jkl012mno345'],
    };
    const rendered = renderTower(state);

    expect(rendered).toContain('Bearer [REDACTED]');
    expect(rendered).not.toContain('abc123def456');
  });

  // ==========================================================================
  // Length Limiting
  // ==========================================================================

  test('should truncate long messages', () => {
    const longTitle = 'A'.repeat(500);
    const longStep = 'B'.repeat(500);
    const state: TowerState = {
      status: 'running',
      taskTitle: longTitle,
      currentStep: longStep,
    };
    const rendered = renderTower(state, { maxLength: 800 });

    expect(rendered.length).toBeLessThanOrEqual(800);
    expect(rendered).toContain('...and');
  });

  // ==========================================================================
  // Metadata
  // ==========================================================================

  test('should render metadata when enabled', () => {
    const state: TowerState = {
      status: 'running',
      metadata: {
        userId: '12345',
        source: 'telegram',
      },
    };
    const rendered = renderTower(state, { includeMetadata: true });

    expect(rendered).toContain('🔧 Metadata:');
    expect(rendered).toContain('userId: 12345');
    expect(rendered).toContain('source: telegram');
  });

  test('should not render metadata by default', () => {
    const state: TowerState = {
      status: 'running',
      metadata: {
        userId: '12345',
      },
    };
    const rendered = renderTower(state);

    expect(rendered).not.toContain('Metadata');
    expect(rendered).not.toContain('userId');
  });

  // ==========================================================================
  // Render Hash & Diff Detection
  // ==========================================================================

  test('should compute consistent hash for same state', () => {
    const state: TowerState = {
      status: 'running',
      taskTitle: 'Test task',
      progress: { current: 1, total: 5 },
    };

    const hash1 = computeRenderHash(state);
    const hash2 = computeRenderHash(state);

    expect(hash1).toBe(hash2);
  });

  test('should compute different hash for different states', () => {
    const state1: TowerState = {
      status: 'running',
      taskTitle: 'Task A',
    };
    const state2: TowerState = {
      status: 'running',
      taskTitle: 'Task B',
    };

    const hash1 = computeRenderHash(state1);
    const hash2 = computeRenderHash(state2);

    expect(hash1).not.toBe(hash2);
  });

  test('should detect changes', () => {
    const state1: TowerState = {
      status: 'running',
      taskTitle: 'Task',
      progress: { current: 1, total: 5 },
    };
    const state2: TowerState = {
      status: 'running',
      taskTitle: 'Task',
      progress: { current: 2, total: 5 },
    };

    expect(hasChanged(state1, state2)).toBe(true);
  });

  test('should not detect changes for identical states', () => {
    const state: TowerState = {
      status: 'running',
      taskTitle: 'Task',
    };

    expect(hasChanged(state, state)).toBe(false);
  });

  test('should ignore timestamp changes in hash', () => {
    const state1: TowerState = {
      status: 'running',
      taskTitle: 'Task',
      startedAt: Date.now() - 5000,
    };
    const state2: TowerState = {
      status: 'running',
      taskTitle: 'Task',
      startedAt: Date.now(), // Different timestamp
    };

    // Hash should be same (timestamps not included)
    const hash1 = computeRenderHash(state1);
    const hash2 = computeRenderHash(state2);

    expect(hash1).toBe(hash2);
  });
});

describe('Tower Renderer - Summary', () => {
  test('Phase B acceptance criteria', () => {
    // ✅ Plain text only (no Markdown)
    const state: TowerState = {
      status: 'running',
      taskTitle: 'Test **bold** and _italic_',
    };
    const rendered = renderTower(state);
    expect(rendered).toContain('**bold**'); // Not parsed as Markdown
    expect(rendered).toContain('_italic_'); // Not parsed as Markdown

    // ✅ Emoji decoration only
    expect(rendered).toContain('▶️');

    // ✅ Secrets redacted
    const secretState: TowerState = {
      status: 'running',
      taskTitle: 'Using sk-1234567890abcdefghijklmnopqr',
    };
    const secretRendered = renderTower(secretState);
    expect(secretRendered).toContain('[OPENAI_KEY]');

    // ✅ 800 char limit
    const longState: TowerState = {
      status: 'running',
      taskTitle: 'A'.repeat(1000),
    };
    const longRendered = renderTower(longState, { maxLength: 800 });
    expect(longRendered.length).toBeLessThanOrEqual(800);

    console.log('✅ Phase B: Tower Renderer - All tests passed');
  });
});
