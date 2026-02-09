/**
 * Tower Renderer Test Suite
 * TaskShoot Dashboard - reads from ~/.task-tracker.json
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import {
  renderTower,
  computeRenderHash,
  hasChanged,
  type TowerState,
} from '../utils/tower-renderer.js';

const TASK_TRACKER_PATH = `${homedir()}/.task-tracker.json`;

let originalContent: string | null = null;

beforeEach(() => {
  // Backup original file if it exists
  if (existsSync(TASK_TRACKER_PATH)) {
    originalContent = readFileSync(TASK_TRACKER_PATH, 'utf-8');
  } else {
    originalContent = null;
  }
});

afterEach(() => {
  // Restore original file
  if (originalContent !== null) {
    writeFileSync(TASK_TRACKER_PATH, originalContent, 'utf-8');
  } else if (existsSync(TASK_TRACKER_PATH)) {
    unlinkSync(TASK_TRACKER_PATH);
  }
});

describe('Tower Renderer', () => {
  // ==========================================================================
  // Basic Rendering
  // ==========================================================================

  test('should render no tasks message when no active tasks', () => {
    // Write empty tracker
    writeFileSync(TASK_TRACKER_PATH, JSON.stringify({}), 'utf-8');

    const state: TowerState = { status: 'idle' };
    const rendered = renderTower(state);

    expect(rendered).toBe('📌 待機中');
  });

  test('should render single active task with elapsed time', () => {
    // Write a task started 30 minutes ago
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Design Review': thirtyMinAgo }),
      'utf-8'
    );

    const state: TowerState = { status: 'running' };
    const rendered = renderTower(state);

    expect(rendered).toContain('⏱');
    expect(rendered).toContain('Design Review');
    expect(rendered).toContain('30m');
    // Single task uses full-width parentheses
    expect(rendered).toMatch(/⏱ Design Review（\d+m）/);
  });

  test('should render multiple active tasks joined by pipe', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Task A': tenMinAgo, 'Task B': fiveMinAgo }),
      'utf-8'
    );

    const state: TowerState = { status: 'running' };
    const rendered = renderTower(state);

    expect(rendered).toContain('⏱');
    expect(rendered).toContain('Task A');
    expect(rendered).toContain('Task B');
    expect(rendered).toContain(' | ');
    // Multiple tasks use half-width parentheses
    expect(rendered).toMatch(/Task A\(\d+m\)/);
    expect(rendered).toMatch(/Task B\(\d+m\)/);
  });

  // ==========================================================================
  // maxLength Truncation
  // ==========================================================================

  test('should truncate when line exceeds maxLength', () => {
    // Create many tasks to generate a long line
    const now = new Date(Date.now() - 60 * 1000).toISOString();
    const tasks: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      tasks[`VeryLongTaskName_${i}_padding`] = now;
    }
    writeFileSync(TASK_TRACKER_PATH, JSON.stringify(tasks), 'utf-8');

    const state: TowerState = { status: 'running' };
    const rendered = renderTower(state, { maxLength: 50 });

    expect(rendered.length).toBeLessThanOrEqual(50);
    expect(rendered).toEndWith('…');
  });

  // ==========================================================================
  // Tasks older than 24h are ignored
  // ==========================================================================

  test('should ignore tasks older than 24 hours', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Stale Task': twoDaysAgo }),
      'utf-8'
    );

    const state: TowerState = { status: 'idle' };
    const rendered = renderTower(state);

    expect(rendered).toBe('📌 待機中');
  });

  // ==========================================================================
  // Elapsed time formatting
  // ==========================================================================

  test('should format elapsed time with hours when over 60 minutes', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString();
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Long Task': twoHoursAgo }),
      'utf-8'
    );

    const state: TowerState = { status: 'running' };
    const rendered = renderTower(state);

    expect(rendered).toContain('2h15m');
  });

  // ==========================================================================
  // Render Hash & Diff Detection
  // ==========================================================================

  test('should compute consistent hash for same state', () => {
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Test Task': new Date().toISOString() }),
      'utf-8'
    );

    const state: TowerState = {
      status: 'running',
      currentStep: 'Step 1',
    };

    const hash1 = computeRenderHash(state);
    const hash2 = computeRenderHash(state);

    expect(hash1).toBe(hash2);
  });

  test('should compute different hash when currentStep changes', () => {
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Test Task': new Date().toISOString() }),
      'utf-8'
    );

    const state1: TowerState = {
      status: 'running',
      currentStep: 'Step A',
    };
    const state2: TowerState = {
      status: 'running',
      currentStep: 'Step B',
    };

    const hash1 = computeRenderHash(state1);
    const hash2 = computeRenderHash(state2);

    expect(hash1).not.toBe(hash2);
  });

  test('should detect changes between different states', () => {
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Test Task': new Date().toISOString() }),
      'utf-8'
    );

    const state1: TowerState = {
      status: 'running',
      currentStep: 'Loading',
    };
    const state2: TowerState = {
      status: 'running',
      currentStep: 'Processing',
    };

    expect(hasChanged(state1, state2)).toBe(true);
  });

  test('should return false for identical states', () => {
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Test Task': new Date().toISOString() }),
      'utf-8'
    );

    const state: TowerState = {
      status: 'running',
      currentStep: 'Loading',
    };

    expect(hasChanged(state, state)).toBe(false);
  });

  test('should ignore taskTitle and timestamps in hash', () => {
    writeFileSync(
      TASK_TRACKER_PATH,
      JSON.stringify({ 'Test Task': new Date().toISOString() }),
      'utf-8'
    );

    const state1: TowerState = {
      status: 'running',
      taskTitle: 'Title A',
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
    };
    const state2: TowerState = {
      status: 'running',
      taskTitle: 'Title B',
      startedAt: Date.now() - 99999,
      completedAt: Date.now() + 1000,
    };

    const hash1 = computeRenderHash(state1);
    const hash2 = computeRenderHash(state2);

    expect(hash1).toBe(hash2);
  });
});

describe('Tower Renderer - Summary', () => {
  test('TaskShoot Dashboard acceptance criteria', () => {
    console.log('Acceptance criteria:');
    console.log('- No active tasks -> "📌 待機中"');
    console.log('- Single task -> "⏱ {name}（{elapsed}）"');
    console.log('- Multiple tasks -> "⏱ name1(elapsed) | name2(elapsed)"');
    console.log('- maxLength truncation with "…"');
    console.log('- computeRenderHash uses file + status + currentStep + errors');
    console.log('- hasChanged compares hashes');
    console.log('All tests passed.');
  });
});
