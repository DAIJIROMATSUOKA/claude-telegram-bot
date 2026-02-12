/**
 * Jarvis Task Orchestrator - Validator
 *
 * "Trust nothing, verify everything"
 *
 * Validation order (runs BEFORE git commit):
 * 1. git diff → changed files list + file count check
 * 2. banned_patterns (API keys etc)
 * 3. AST Import analysis (full file, diff vs original)
 * 4. Dangerous symbol regex (fs.rmSync etc)
 * 5. bun test execution
 * 6. All PASS → OK / Any FAIL → rollback
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ALLOWED_IMPORTS,
  DANGEROUS_SYMBOL_PATTERNS,
  type MicroTask,
  type TaskPlan,
  type ValidationResult,
} from "./types";

/**
 * Get list of ALL changed files (modified + new untracked)
 *
 * CRITICAL: git diff --name-only only shows TRACKED file changes.
 * New files created by Claude CLI are UNTRACKED and invisible to git diff.
 * Must also run git ls-files --others to catch new files.
 */
function getChangedFiles(worktreePath: string): string[] {
  const files = new Set<string>();

  // 1. Modified tracked files
  try {
    const out = execSync("git diff --name-only HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    if (out) {
      for (const f of out.split("\n")) if (f) files.add(f);
    }
  } catch {}

  // 2. New untracked files (CRITICAL: Claude CLI often creates new files)
  try {
    const out = execSync("git ls-files --others --exclude-standard", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    if (out) {
      for (const f of out.split("\n")) if (f) files.add(f);
    }
  } catch {}

  return [...files];
}

/**
 * Get added lines from git diff AND new untracked files
 *
 * CRITICAL: git diff only shows changes to TRACKED files.
 * New files must be read in full — every line is "added".
 */
function getAddedLines(worktreePath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // 1. Modified tracked files: parse git diff +lines
  try {
    const diff = execSync("git diff -U0 HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    let currentFile = "";
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6);
        result.set(currentFile, []);
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        result.get(currentFile)?.push(line.slice(1));
      }
    }
  } catch {}

  // 2. New untracked files: ALL lines are "added"
  try {
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    if (untracked) {
      for (const file of untracked.split("\n")) {
        if (!file) continue;
        try {
          const content = readFileSync(join(worktreePath, file), "utf-8");
          result.set(file, content.split("\n"));
        } catch {}
      }
    }
  } catch {}

  return result;
}

/**
 * Scan imports using Bun.Transpiler (AST-level analysis)
 */
function scanImports(filePath: string): string[] {
  try {
    const code = readFileSync(filePath, "utf-8");
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const result = transpiler.scanImports(code);
    return result.map((i: { path: string }) => i.path);
  } catch {
    return [];
  }
}

/**
 * Check 1: File count limit
 */
function checkFileCount(
  changedFiles: string[],
  maxFiles: number,
): { ok: boolean; violations: string[] } {
  if (changedFiles.length > maxFiles) {
    return {
      ok: false,
      violations: [
        `変更ファイル数 ${changedFiles.length} > 上限 ${maxFiles}`,
      ],
    };
  }
  return { ok: true, violations: [] };
}

/**
 * Check 2: Banned patterns (API keys etc)
 */
function checkBannedPatterns(
  worktreePath: string,
  addedLines: Map<string, string[]>,
  bannedPatterns: string[],
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [file, lines] of addedLines) {
    for (const line of lines) {
      for (const pattern of bannedPatterns) {
        if (line.includes(pattern)) {
          violations.push(`${file}: 禁止パターン検出 "${pattern}"`);
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Check 3: AST Import analysis
 * Compare imports before/after, flag new disallowed imports
 */
function checkImports(
  changedFiles: string[],
  worktreePath: string,
  mainRepoPath: string,
  allowedImports: string[],
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const allAllowed = [...DEFAULT_ALLOWED_IMPORTS, ...allowedImports];

  for (const file of changedFiles) {
    // Only check .ts/.js files
    if (!/\.[tj]sx?$/.test(file)) continue;

    const worktreeFile = join(worktreePath, file);
    if (!existsSync(worktreeFile)) continue;

    const afterImports = scanImports(worktreeFile);

    // Get imports from original file (main repo)
    let beforeImports: string[] = [];
    const mainFile = join(mainRepoPath, file);
    if (existsSync(mainFile)) {
      beforeImports = scanImports(mainFile);
    }

    // Find newly added imports
    const newImports = afterImports.filter((i) => !beforeImports.includes(i));

    for (const imp of newImports) {
      // Check against allowed list
      const isAllowed = allAllowed.some((allowed) => {
        if (allowed.endsWith("/")) return imp.startsWith(allowed);
        return imp === allowed || imp.startsWith(allowed + "/");
      });

      // Also allow relative imports
      const isRelative = imp.startsWith("./") || imp.startsWith("../");

      if (!isAllowed && !isRelative) {
        violations.push(`${file}: 未許可Import追加 "${imp}"`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Check 4: Dangerous symbol patterns in added lines
 */
function checkDangerousSymbols(
  addedLines: Map<string, string[]>,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [file, lines] of addedLines) {
    // Skip non-code files
    if (!/\.[tj]sx?$/.test(file)) continue;

    for (const line of lines) {
      // Skip comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      for (const pattern of DANGEROUS_SYMBOL_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${file}: 危険シンボル検出 ${pattern.source}`);
          break; // 1行に複数パターン検出しても1つだけ報告
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Check 5: Run test command
 */
function runTestCommand(
  testCommand: string,
  worktreePath: string,
): { passed: boolean; output: string } {
  // Prevent bun test substring matching (e.g. runner.test.ts also matching golden-test-runner.test.ts)
  // Prefix relative file paths with ./ for exact match
  const safeCommand = testCommand.replace(
    /(bun\s+test\s+)(\S+\.test\.\S+)/g,
    (_, prefix, file) => file.startsWith("./") || file.startsWith("/") ? prefix + file : prefix + "./" + file
  );
  try {
    const output = execSync(safeCommand, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 60_000, // テスト60秒上限
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    });
    return { passed: true, output: output.slice(0, 10_000) };
  } catch (err: any) {
    const output = (err.stdout || "") + "\n" + (err.stderr || err.message || "");
    return { passed: false, output: output.slice(0, 10_000) };
  }
}

/**
 * Rollback all uncommitted changes in worktree
 */
export function rollback(worktreePath: string): void {
  try {
    execSync("git checkout -- .", { cwd: worktreePath, timeout: 10_000 });
    execSync("git clean -fd", { cwd: worktreePath, timeout: 10_000 });
  } catch {}
}

/**
 * Main validation function
 *
 * Runs all 5 checks in order. Stops at first failure category
 * (but reports all violations within that category).
 * If any check fails → automatic rollback.
 */
export function validate(
  task: MicroTask,
  plan: TaskPlan,
  worktreePath: string,
  mainRepoPath: string,
): ValidationResult {
  const result: ValidationResult = {
    passed: false,
    changed_files: [],
    file_count_ok: false,
    banned_check_ok: false,
    import_check_ok: false,
    symbol_check_ok: false,
    test_passed: false,
    test_output: "",
    violations: [],
  };

  // 1. Changed files
  result.changed_files = getChangedFiles(worktreePath);
  const fileCheck = checkFileCount(
    result.changed_files,
    plan.max_changed_files_per_task,
  );
  result.file_count_ok = fileCheck.ok;
  if (!fileCheck.ok) {
    result.violations.push(...fileCheck.violations);
    rollback(worktreePath);
    return result;
  }

  // No changes = suspicious but not necessarily failure
  if (result.changed_files.length === 0) {
    result.violations.push("変更なし: Claude CLIが何も変更しなかった");
    return result;
  }

  // Get added lines for checks 2 and 4
  const addedLines = getAddedLines(worktreePath);

  // 2. Banned patterns
  const bannedCheck = checkBannedPatterns(
    worktreePath,
    addedLines,
    plan.banned_patterns,
  );
  result.banned_check_ok = bannedCheck.ok;
  if (!bannedCheck.ok) {
    result.violations.push(...bannedCheck.violations);
    rollback(worktreePath);
    return result;
  }

  // 3. AST Import analysis
  const importCheck = checkImports(
    result.changed_files,
    worktreePath,
    mainRepoPath,
    plan.allowed_imports,
  );
  result.import_check_ok = importCheck.ok;
  if (!importCheck.ok) {
    result.violations.push(...importCheck.violations);
    rollback(worktreePath);
    return result;
  }

  // 4. Dangerous symbols
  const symbolCheck = checkDangerousSymbols(addedLines);
  result.symbol_check_ok = symbolCheck.ok;
  if (!symbolCheck.ok) {
    result.violations.push(...symbolCheck.violations);
    rollback(worktreePath);
    return result;
  }

  // 5. Run tests (only if all static checks passed)
  const testResult = runTestCommand(task.test_command, worktreePath);
  result.test_passed = testResult.passed;
  result.test_output = testResult.output;
  if (!testResult.passed) {
    result.violations.push(`テスト失敗: ${task.test_command}`);
    rollback(worktreePath);
    return result;
  }

  // All checks passed
  result.passed = true;
  result.file_count_ok = true;
  result.banned_check_ok = true;
  result.import_check_ok = true;
  result.symbol_check_ok = true;
  return result;
}
