// Meta-Agent Types

export interface SelfAuditResult {
  id?: number;
  date: string; // YYYY-MM-DD
  error_count: number;
  avg_response_ms: number | null;
  satisfaction_score: number;
  issues_found: string; // JSON
  recommendations: string; // JSON
  log_file_size: number;
  total_messages: number;
  total_sessions: number;
  created_at?: string;
  metadata?: string; // JSON
}

export interface CodeReviewSuggestion {
  id?: number;
  suggestion_id: string; // ULID
  file_path: string;
  line_number: number | null;
  issue_type: string; // 'duplicate_code', 'inefficiency', 'error_handling'
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggested_fix: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  reviewed_at?: string;
  resolved_at?: string | null;
  user_feedback?: string | null;
  metadata?: string; // JSON
}

export interface RefactorProposal {
  id?: number;
  proposal_id: string; // ULID
  proposal_title: string;
  proposal_description: string;
  affected_files: string; // JSON: Array of file paths
  estimated_impact: 'low' | 'medium' | 'high';
  estimated_time_minutes: number;
  benefits: string | null; // JSON
  risks: string | null; // JSON
  rollback_plan: string | null;
  status: 'proposed' | 'approved' | 'in_progress' | 'completed' | 'rejected';
  created_at?: string;
  approved_at?: string | null;
  completed_at?: string | null;
  user_feedback?: string | null;
  metadata?: string; // JSON
}

export interface CapabilityGap {
  id?: number;
  gap_id: string; // ULID
  operation_name: string;
  operation_description: string;
  manual_count: number;
  last_seen_at: string;
  automation_suggestion: string | null;
  estimated_time_saved_minutes: number | null;
  priority: 'low' | 'medium' | 'high';
  status: 'detected' | 'proposed' | 'approved' | 'implemented' | 'rejected';
  created_at?: string;
  resolved_at?: string | null;
  user_feedback?: string | null;
  metadata?: string; // JSON
}

export interface MetaAgentLog {
  id?: number;
  log_id: string; // ULID
  action_type: 'self_audit' | 'code_review' | 'refactor' | 'gap_analysis' | 'kill_switch';
  action_status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  started_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  result_summary?: string | null;
  error_message?: string | null;
  metadata?: string; // JSON
}

export interface MetaAgentState {
  id: 1; // Singleton
  enabled: 0 | 1;
  self_audit_enabled: 0 | 1;
  code_review_enabled: 0 | 1;
  refactor_enabled: 0 | 1;
  gap_analysis_enabled: 0 | 1;
  last_modified_at: string;
  last_modified_by: string;
}
