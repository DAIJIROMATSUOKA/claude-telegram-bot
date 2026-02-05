/**
 * Tower Renderer v1.0
 * Purpose: Safe plain-text rendering for Control Tower
 * Philosophy: "Plain text only, emoji decoration only"
 */

import { redactSensitiveData } from './redaction-filter.js';

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

const MAX_TOWER_LENGTH = 800; // Telegram message limit consideration
const TRUNCATION_SUFFIX = '...and N more';

// Status emoji (safe decoration)
const STATUS_EMOJI = {
  idle: '⏸️',
  running: '▶️',
  completed: '✅',
  failed: '❌',
};

// ============================================================================
// Main Render Function
// ============================================================================

export function renderTower(
  state: TowerState,
  options: RenderOptions = {}
): string {
  const {
    maxLength = MAX_TOWER_LENGTH,
    includeTimestamp = true,
    includeMetadata = false,
  } = options;

  const lines: string[] = [];

  // Header
  const statusEmoji = STATUS_EMOJI[state.status] || '📌';
  lines.push(`${statusEmoji} Control Tower`);
  lines.push('');

  // Task title
  if (state.taskTitle) {
    const sanitizedTitle = redactSensitiveData(state.taskTitle).sanitized;
    lines.push(`Task: ${sanitizedTitle}`);
  }

  // Status
  lines.push(`Status: ${state.status}`);

  // Current step
  if (state.currentStep) {
    const sanitizedStep = redactSensitiveData(state.currentStep).sanitized;
    lines.push(`Step: ${sanitizedStep}`);
  }

  // Progress
  if (state.progress) {
    const { current, total } = state.progress;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    lines.push(`Progress: ${current}/${total} (${percentage}%)`);
  }

  // Timing
  if (includeTimestamp) {
    if (state.startedAt) {
      const startTime = new Date(state.startedAt).toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(`Started: ${startTime}`);
    }

    if (state.completedAt) {
      const endTime = new Date(state.completedAt).toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
      });
      const duration = state.startedAt
        ? Math.round((state.completedAt - state.startedAt) / 1000)
        : 0;
      lines.push(`Completed: ${endTime} (${duration}s)`);
    } else if (state.startedAt && state.status === 'running') {
      const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
      lines.push(`Elapsed: ${elapsed}s`);
    }
  }

  // Errors
  if (state.errors && state.errors.length > 0) {
    lines.push('');
    lines.push('⚠️ Errors:');
    state.errors.forEach((error, idx) => {
      const sanitizedError = redactSensitiveData(error).sanitized;
      lines.push(`  ${idx + 1}. ${sanitizedError}`);
    });
  }

  // Metadata (optional)
  if (includeMetadata && state.metadata) {
    lines.push('');
    lines.push('🔧 Metadata:');
    for (const [key, value] of Object.entries(state.metadata)) {
      const sanitizedValue = redactSensitiveData(String(value)).sanitized;
      lines.push(`  ${key}: ${sanitizedValue}`);
    }
  }

  // Join and truncate
  let rendered = lines.join('\n');

  if (rendered.length > maxLength) {
    const excess = rendered.length - maxLength;
    const suffixLength = TRUNCATION_SUFFIX.replace('N', String(excess)).length;
    const truncated = rendered.substring(0, maxLength - suffixLength);
    rendered = truncated + TRUNCATION_SUFFIX.replace('N', String(excess));
  }

  return rendered;
}

// ============================================================================
// Render Hash (for diff detection)
// ============================================================================

export function computeRenderHash(state: TowerState): string {
  const normalized = {
    status: state.status,
    taskTitle: state.taskTitle || '',
    currentStep: state.currentStep || '',
    progress: state.progress || { current: 0, total: 0 },
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
    hash = hash & hash; // Convert to 32bit integer
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
