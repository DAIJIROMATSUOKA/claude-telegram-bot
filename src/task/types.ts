/**
 * Jarvis Task Orchestrator - Type Definitions
 *
 * Debate Result: 6 rounds, all 4 judges GO
 * Planner: Croppy (claude.ai) generates TaskPlan JSON
 * Executor: Jarvis runs MicroTasks via Claude CLI
 * Validator: AST import analysis + dangerous symbol regex + tests
 */

// === MicroTask: 1つの自律実行単位 (15分上限) ===

export interface MicroTask {
  id: string;                        // "MT-001"
  goal: string;                      // 人間が読める目的
  prompt: string;                    // Claude CLIに渡す具体的指示
  context_files: string[];           // 読むべきファイルパス
  test_command: string;              // 成功判定コマンド (必須)
  depends_on: string | null;         // 前タスクID (null = 依存なし)
  max_time_seconds: number;          // デフォルト900 (15分)
  previous_changes_summary?: string; // 前タスクの変更サマリー (自動注入)
}

// === TaskPlan: クロッピーが生成するJSON ===

export interface TaskPlan {
  plan_id: string;                   // "TP-20260213-001"
  title: string;                     // タスク全体の説明
  created_by: string;                // "croppy"
  micro_tasks: MicroTask[];
  banned_patterns: string[];         // git diffに含まれてはいけないパターン
  allowed_imports: string[];         // 追加許可するimport (デフォルト + ユーザー指定)
  max_changed_files_per_task: number; // 1タスクの変更ファイル上限 (デフォルト5)
  on_failure: "stop" | "retry_then_stop"; // "stop": 即停止(Phase 1) / "retry_then_stop": 1回リトライ後停止(Phase 2a)
  resource_limits?: ResourceLimits;
}

// === Resource Limits ===

export interface ResourceLimits {
  maxFiles: number;          // 1タスクの変更ファイル上限 (default 10)
  maxLineChanges: number;    // 追加+削除行数上限 (default 500)
  maxSeconds: number;        // 実行時間上限秒 (default 900)
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxFiles: 10,
  maxLineChanges: 500,
  maxSeconds: 900,
};

// === Validation ===

export interface ValidationResult {
  passed: boolean;
  changed_files: string[];
  file_count_ok: boolean;
  banned_check_ok: boolean;
  import_check_ok: boolean;
  symbol_check_ok: boolean;
  test_line_check_ok: boolean;
  test_passed: boolean;
  test_output: string;
  violations: string[];
}

// === Task Result ===

export interface TaskResult {
  task_id: string;
  status: "success" | "failed" | "timeout" | "blocked";
  validation: ValidationResult | null;
  duration_seconds: number;
  exit_code: number;
  changes_summary: string;           // 次タスクへの引き継ぎ用
}

// === Execution Result (raw Claude CLI output) ===

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

// === Completion Report ===

export interface CompletionReport {
  plan_id: string;
  run_id?: string;
  title: string;
  results: TaskResult[];
  total_duration_seconds: number;
  final_status: "all_passed" | "partial" | "failed";
}

// === Default Config ===

export const DEFAULT_ALLOWED_IMPORTS: string[] = [
  "bun:test",
  "./",
  "../",
  "src/",
  "@/",
  // Safe Node.js built-ins (dangerous patterns caught by symbol check)
  "fs",
  "node:fs",
  "path",
  "node:path",
  "util",
  "node:util",
  "os",
  "node:os",
  "assert",
  "node:assert",
  "crypto",
  "node:crypto",
  "stream",
  "node:stream",
  "events",
  "node:events",
  "buffer",
  "node:buffer",
  "url",
  "node:url",
];

export const DANGEROUS_SYMBOL_PATTERNS: RegExp[] = [
  /fs\.rmSync/,
  /fs\.rm\s*\(/,
  /fs\.unlinkSync/,
  /fs\.writeFileSync\s*\(\s*['"]\/(?!tmp)/,
  /child_process/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /process\.exit/,
  /Bun\.spawn/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /require\s*\(\s*['"]child_process/,
  /require\s*\(\s*['"]node:child_process/,
  /from\s+['"]bun:ffi['"]/,
  /Bun\.\.?\$/,
  /Bun\.shell/,
];
