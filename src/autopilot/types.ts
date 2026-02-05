/**
 * Autopilot Engine v1 - Type Definitions
 */

import type { AutopilotTask } from './engine';

export interface AutopilotPlugin {
  name: string;
  version: string;
  description: string;

  /**
   * Detect triggers for autopilot tasks
   * Called during Phase 1 (Trigger) of the pipeline
   */
  detectTriggers(): Promise<AutopilotTask[]>;

  /**
   * Execute a task
   * Called during Phase 6 (Execute) of the pipeline
   */
  executeTask?(task: AutopilotTask): Promise<void>;

  /**
   * Optional timeout in milliseconds for task execution
   * Default: 60000 (1 minute)
   */
  executionTimeout?: number;
}

export interface MemoryAppendRequest {
  scope: string;
  dedupe_key?: string;
  type?: string;
  title?: string;
  content: string;
  tags?: string[];
  importance?: number;
  pin?: boolean;
  source_agent?: 'jarvis' | 'gpt' | 'claude' | 'gemini' | 'openclaw';
}

export interface MemoryQueryParams {
  scope?: string;
  scope_prefix?: string;
  scopes?: string[];
  tags?: string[];
  type?: string;
  pinned?: boolean;
  since?: string;
  until?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

/**
 * ====================================================================================
 * PROOF-CARRYING AUTOPILOT (Phase 2) - Type Definitions
 * ====================================================================================
 *
 * Philosophy: "Never execute without complete proof"
 * - Evidence: Why this action is safe
 * - Risk: What could go wrong
 * - Rollback: How to recover
 * - Idempotency: Prevent duplicate execution
 */

/**
 * Plan Bundle - Complete evidence package required for execution
 */
export interface PlanBundle {
  plan_id: string; // Unique plan identifier
  title: string; // Human-readable title
  scope: 'test' | 'canary' | 'production'; // Execution scope
  confidence: number; // 0.0-1.0, agent's confidence in plan
  impact: 'low' | 'medium' | 'high' | 'critical'; // Impact level

  // Evidence: Proof that action is safe
  evidence: Evidence;

  // Actions: What will be executed
  actions: ActionItem[];

  // Risk: What could go wrong
  risk: RiskAssessment;

  // Decision: Approval/rejection with rationale
  decision?: Decision;

  // Metadata
  created_at: string; // ISO timestamp
  approved_at?: string; // ISO timestamp
  executed_at?: string; // ISO timestamp
}

/**
 * Evidence - Proof that action is safe and correct
 */
export interface Evidence {
  // Why this action is needed
  rationale: string;

  // Supporting data (logs, metrics, observations)
  supporting_data: string[];

  // Previous successful executions (learning from history)
  precedents?: string[];

  // User intent confirmation
  user_intent?: string;

  // AI Council approval (if consulted)
  council_approval?: {
    consulted: boolean;
    advisors: string[];
    consensus: 'approve' | 'reject' | 'conditional';
    conditions?: string[];
  };
}

/**
 * Action Item - Single executable action
 */
export interface ActionItem {
  action_id: string; // Unique action identifier
  type: 'open_url' | 'reveal_file' | 'notify' | 'send_message' | 'run_shortcut' | 'write_file' | 'run_command';
  description: string; // Human-readable description
  parameters: Record<string, unknown>; // Action-specific parameters

  // Idempotency
  idempotency_key: string; // Unique key to prevent duplicate execution

  // Rollback
  rollback_plan: RollbackPlan;

  // Device routing (JARVIS MESH)
  target_device?: 'm1' | 'm3' | 'iphone';
}

/**
 * Risk Assessment - What could go wrong
 */
export interface RiskAssessment {
  // Overall risk level
  level: 'low' | 'medium' | 'high' | 'critical';

  // Identified risks
  risks: RiskItem[];

  // Mitigation strategies
  mitigations: string[];

  // Worst-case scenario
  worst_case: string;

  // Blast radius (scope of potential damage)
  blast_radius: 'single_file' | 'single_directory' | 'project' | 'system';
}

/**
 * Risk Item - Single identified risk
 */
export interface RiskItem {
  description: string; // What could go wrong
  likelihood: 'low' | 'medium' | 'high'; // How likely is it
  impact: 'low' | 'medium' | 'high' | 'critical'; // How bad would it be
  mitigation?: string; // How to prevent or reduce risk
}

/**
 * Rollback Plan - How to recover if action fails
 */
export interface RollbackPlan {
  // Can this action be rolled back?
  can_rollback: boolean;

  // Automatic rollback steps
  automatic_steps: string[];

  // Manual rollback instructions (if automatic fails)
  manual_instructions: string[];

  // Backup created before action?
  backup_created?: boolean;
  backup_location?: string;
}

/**
 * Decision - Approval or rejection with rationale
 */
export interface Decision {
  approved: boolean; // Approved or rejected
  approver: 'user' | 'autopilot' | 'policy_engine'; // Who made the decision
  rationale: string; // Why approved/rejected
  conditions?: string[]; // Conditions for approval
  timestamp: string; // ISO timestamp
}

/**
 * Policy Validation Result
 */
export interface PolicyValidationResult {
  valid: boolean; // Passes all policy checks
  violations: PolicyViolation[]; // List of violations
  warnings: string[]; // Non-blocking warnings
  score: number; // 0.0-1.0, overall policy compliance score
}

/**
 * Policy Violation - Single policy violation
 */
export interface PolicyViolation {
  rule: string; // Which policy rule was violated
  severity: 'low' | 'medium' | 'high' | 'critical'; // How severe
  description: string; // What was violated
  required_fix: string; // How to fix it
}
