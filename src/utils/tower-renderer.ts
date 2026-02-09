/**
 * Tower Renderer v2.0 — TaskShoot Dashboard
 *
 * Control Towerのピン留めメッセージをタスクシュート風ダッシュボードとして描画。
 * task-tracker.jsonの進行中タスク + Croppyの作業状態を表示する。
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface TowerState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  taskTitle?: string;
  currentStep?: string;
  progress?: {
    current: number;
    total: number;
  };
  startedAt?: number;
  completedAt?: number;
  errors?: string[];
  metadata?: Record<string, any>;
}

export interface RenderOptions {
  maxLength?: number;
  includeTimestamp?: boolean;
  includeMetadata?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_TOWER_LENGTH = 800;
const TASK_TRACKER_PATH = `${homedir()}/.task-tracker.json`;

// Claude処理状態（グローバル、text.tsから更新される）
let _claudeStatus: { state: 'idle' | 'processing' | 'tool'; detail?: string; startedAt?: number } = { state: 'idle' };

export function setClaudeStatus(state: 'idle' | 'processing' | 'tool', detail?: string): void {
  _claudeStatus = { state, detail, startedAt: state !== 'idle' ? Date.now() : undefined };
}

export function getClaudeStatus(): typeof _claudeStatus {
  return _claudeStatus;
}

// ============================================================================
// Task Tracker Reader
// ============================================================================

interface ActiveTask {
  name: string;
  startedAt: Date;
  elapsed: string;
}

function readActiveTasks(): ActiveTask[] {
  try {
    if (!existsSync(TASK_TRACKER_PATH)) return [];
    const raw = readFileSync(TASK_TRACKER_PATH, 'utf-8');
    const data = JSON.parse(raw) as Record<string, string>;

    const tasks: ActiveTask[] = [];
    const now = new Date();

    for (const [name, startTimeStr] of Object.entries(data)) {
      const startTime = new Date(startTimeStr);
      const diffMs = now.getTime() - startTime.getTime();

      // 24時間以上前のは無視（task-tracker側でcleanupされるはず）
      if (diffMs > 86400000) continue;

      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const elapsed = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;

      tasks.push({ name, startedAt: startTime, elapsed });
    }

    return tasks;
  } catch {
    return [];
  }
}

// ============================================================================
// Croppy Status Formatter
// ============================================================================

function formatCroppyStatus(state: TowerState): string {
  if (state.status === 'idle') return '⏸ 待機中';
  if (state.status === 'completed') return '✅ 完了';
  if (state.status === 'failed') return '❌ エラー';

  // running — currentStep に詳細がある
  if (state.currentStep) {
    // 長すぎる場合は切り詰め
    const step = state.currentStep.length > 40
      ? state.currentStep.slice(0, 40) + '…'
      : state.currentStep;
    return `▶ ${step}`;
  }
  return '▶ 処理中';
}

// ============================================================================
// Main Render Function
// ============================================================================

export function renderTower(
  state: TowerState,
  options: RenderOptions = {}
): string {
  const { maxLength = MAX_TOWER_LENGTH } = options;

  const parts: string[] = [];

  // 1. Claude処理状態
  const claude = _claudeStatus;
  if (claude.state === 'processing') {
    const elapsed = claude.startedAt ? Math.floor((Date.now() - claude.startedAt) / 1000) : 0;
    parts.push(`▶ 処理中（${elapsed}s）`);
  } else if (claude.state === 'tool') {
    const detail = claude.detail ? claude.detail.slice(0, 30) : '実行中';
    parts.push(`🔧 ${detail}`);
  }

  // 2. 進行中タスク
  const activeTasks = readActiveTasks();
  if (activeTasks.length === 1) {
    const t = activeTasks[0]!;
    parts.push(`⏱ ${t.name}（${t.elapsed}）`);
  } else if (activeTasks.length > 1) {
    const taskSummary = activeTasks
      .map(t => `${t.name}(${t.elapsed})`)
      .join(' | ');
    parts.push(`⏱ ${taskSummary}`);
  }

  if (parts.length === 0) {
    return '📌 待機中';
  }

  const line = parts.join('\n');
  if (line.length > maxLength) {
    return line.slice(0, maxLength - 1) + '…';
  }

  return line;
}

// ============================================================================
// Render Hash (for diff detection)
// ============================================================================

export function computeRenderHash(state: TowerState): string {
  // タスクトラッカーの状態も含めてハッシュ化
  const activeTasks = readActiveTasks();
  const normalized = {
    status: state.status,
    currentStep: state.currentStep || '',
    taskCount: activeTasks.length,
    taskNames: activeTasks.map(t => t.name).join('|'),
    errors: (state.errors || []).join('|'),
  };

  const jsonString = JSON.stringify(normalized);
  return simpleHash(jsonString);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ============================================================================
// Helper: Diff Detection
// ============================================================================

export function hasChanged(prevState: TowerState, newState: TowerState): boolean {
  const prevHash = computeRenderHash(prevState);
  const newHash = computeRenderHash(newState);
  return prevHash !== newHash;
}
