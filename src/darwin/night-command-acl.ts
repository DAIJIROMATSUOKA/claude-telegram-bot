/**
 * Darwin Engine v1.2.2 - Night Command ACL
 * Access Control List for night-time commands (23:00-02:45)
 */

import type { NightCommandType } from './schema-validator';

// ==================== Time Window Check ====================

/**
 * Check if current time is within Darwin execution window
 * Darwin runs: 23:00 - 02:45 JST
 */
export function isNightExecutionWindow(): boolean {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24; // Convert UTC to JST

  // Night window: 23:00-23:59 OR 00:00-02:45
  return jstHour === 23 || (jstHour >= 0 && jstHour < 3) || (jstHour === 2 && now.getUTCMinutes() <= 45);
}

/**
 * Get next Darwin execution time
 */
export function getNextExecutionTime(): Date {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;

  // If before 23:00 JST today, next run is today at 23:00
  // If after 23:00 JST, next run is tomorrow at 23:00
  const nextRun = new Date(now);

  if (jstHour < 23) {
    // Set to today 23:00 JST (14:00 UTC)
    nextRun.setUTCHours(14, 0, 0, 0);
  } else {
    // Set to tomorrow 23:00 JST
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setUTCHours(14, 0, 0, 0);
  }

  return nextRun;
}

/**
 * Get time remaining until next execution
 */
export function getTimeUntilNextExecution(): string {
  const now = new Date();
  const next = getNextExecutionTime();
  const diffMs = next.getTime() - now.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
}

// ==================== Command ACL ====================

/**
 * Night-time commands that can be issued during execution
 */
const NIGHT_COMMANDS_ARRAY: NightCommandType[] = [
  'KILL',      // Immediately stop current run
  'PAUSE',     // Pause after current task
  'RESUME',    // Resume paused run
  'STATUS',    // Get current execution status
  'PRIORITY',  // Adjust priority themes mid-run
];

/**
 * Check if command is allowed during night execution
 */
export function isNightCommandAllowed(command: string): boolean {
  return NIGHT_COMMANDS_ARRAY.includes(command as NightCommandType);
}

/**
 * Check if command requires confirmation
 */
export function requiresConfirmation(command: NightCommandType): boolean {
  // Destructive commands require confirmation
  return command === 'KILL';
}

/**
 * Get command description
 */
export function getCommandDescription(command: NightCommandType): string {
  const descriptions: Record<NightCommandType, string> = {
    KILL: '🛑 Immediately stop current Darwin run (cannot be undone)',
    PAUSE: '⏸️ Pause execution after current task completes',
    RESUME: '▶️ Resume paused execution',
    STATUS: '📊 Show current execution status and progress',
    PRIORITY: '🎯 Adjust theme priorities for remaining ideas',
  };

  return descriptions[command];
}

// ==================== Command Validation ====================

export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

/**
 * Validate if command can be executed
 */
export function validateNightCommand(
  command: NightCommandType,
  currentRunStatus: 'running' | 'paused' | 'completed' | 'failed' | 'killed' | null
): CommandValidationResult {
  // STATUS command always allowed
  if (command === 'STATUS') {
    return { allowed: true, requiresConfirmation: false };
  }

  // Check if we're in execution window
  const isNightTime = isNightExecutionWindow();

  // Commands that require active run
  const requiresActiveRun = ['KILL', 'PAUSE', 'PRIORITY'];
  const requiresPausedRun = ['RESUME'];

  if (requiresActiveRun.includes(command)) {
    if (!isNightTime) {
      return {
        allowed: false,
        reason: `Command only available during Darwin execution (23:00-02:45 JST). Next run in ${getTimeUntilNextExecution()}`,
        requiresConfirmation: false,
      };
    }

    if (currentRunStatus !== 'running') {
      return {
        allowed: false,
        reason: `No active Darwin run. Current status: ${currentRunStatus || 'idle'}`,
        requiresConfirmation: false,
      };
    }
  }

  if (requiresPausedRun.includes(command)) {
    if (currentRunStatus !== 'paused') {
      return {
        allowed: false,
        reason: `No paused run to resume. Current status: ${currentRunStatus || 'idle'}`,
        requiresConfirmation: false,
      };
    }
  }

  // All checks passed
  return {
    allowed: true,
    requiresConfirmation: requiresConfirmation(command),
  };
}

// ==================== Command Execution ====================

export interface NightCommandContext {
  command: NightCommandType;
  args?: Record<string, any>;
  issued_by: string;
  issued_at: Date;
  run_id?: string;
}

/**
 * Format command for logging
 */
export function formatCommandLog(ctx: NightCommandContext): string {
  const timestamp = ctx.issued_at.toISOString();
  const args = ctx.args ? ` (${JSON.stringify(ctx.args)})` : '';
  return `[${timestamp}] ${ctx.command}${args} by ${ctx.issued_by}`;
}

/**
 * Create confirmation message for destructive commands
 */
export function createConfirmationMessage(command: NightCommandType): string {
  switch (command) {
    case 'KILL':
      return '⚠️ **Warning**: This will immediately stop the current Darwin run and discard all progress.\n\nType "CONFIRM KILL" to proceed.';
    default:
      return 'Type "CONFIRM" to proceed.';
  }
}

// ==================== Exports ====================

export const NIGHT_COMMANDS = NIGHT_COMMANDS_ARRAY;

export type { NightCommandType };
