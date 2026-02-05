/**
 * Control Tower Types
 * Purpose: Type definitions for Control Tower system
 */

// ============================================================================
// Database Types (from D1)
// ============================================================================

export interface ControlTowerRecord {
  tenant_id: string;
  user_id: string;
  chat_id: string;
  message_id: string | null;
  revision: number;
  tower_status: 'active' | 'suspended' | 'permission_error';
  consecutive_edit_failures: number;
  last_edit_error_code: string | null;
  last_edit_error_message: string | null;
  end_notice_sent_at_epoch_ms: number | null;
  created_at_epoch_ms: number;
  updated_at_epoch_ms: number;
}

export interface ActionTraceRecord {
  trace_id: string;
  action_ledger_id: string | null;
  task_id: string | null;
  status: 'pending' | 'success' | 'failure' | 'rolled_back';
  inputs_redacted: string | null;
  decisions: string | null;
  outputs_summary: string | null;
  error_summary: string | null;
  rollback_instruction: string | null;
  created_at_epoch_ms: number;
  completed_at_epoch_ms: number | null;
}

export interface SettingsRecord {
  setting_key: string;
  setting_value: string;
  description: string | null;
  created_at_epoch_ms: number;
  updated_at_epoch_ms: number;
}

// ============================================================================
// Tower Manager Types
// ============================================================================

export interface TowerIdentifier {
  tenantId: string;
  userId: string;
  chatId: string;
}

export interface TowerUpdateResult {
  success: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  action: 'created' | 'updated' | 'skipped' | 'recovered' | 'failed';
}

export interface TowerEditError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfter?: number; // seconds
}

// ============================================================================
// Telegram Edit Error Classification
// ============================================================================

export type EditErrorType =
  | 'not_modified' // Content unchanged
  | 'not_found' // Message deleted or not found
  | 'rate_limit' // 429 - Too many requests
  | 'forbidden' // 403 - No permission
  | 'unauthorized' // 401 - Invalid token
  | 'unknown'; // Other errors

// ============================================================================
// Single-Flight Lock
// ============================================================================

export interface LockInfo {
  lockId: string;
  acquiredAt: number;
  expiresAt: number;
}
