/**
 * Tests for src/task/validator.ts
 *
 * Uses real temp git repos. All dangerous/banned strings
 * constructed via concatenation to avoid self-detection.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validate, rollback } from "../task/validator";
import type { MicroTask, TaskPlan } from "../task/types";

// === Helpers ===

// Construct banned/dangerous strings via concat to avoid self-detection
const BANNED_1 = "ANTHROPIC" + "_API" + "_KEY";
const BANNED_2 = "OPENAI" + "_API" + "_KEY";
const DANGER_RM = "fs" + ".rmSync";
const DANGER_EVAL = "ev" + "al(";
const DANGER_SPAWN = "spawn" + "Sync";
const DANGER_CHILD = "child" + "_process";

interface TestEnv {
  worktreePath: string;
  mainRepoPath: string;
  baseCommit: string;
}

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    plan_id: "test-plan",
    title: "test",
    created_by: "test",
    micro_tasks: [],
    banned_patterns: [BANNED_1, BANNED_2],
    allowed_imports: ["bun:test"],
    max_changed_files_per_task: 3,
    on_failure: "stop" as const,
    ...overrides,
  };
}

function makeTask(overrides?: Partial<MicroTask>): MicroTask {
  return {
    id: "MT-T",
    goal: "test",
    prompt: "",
    context_files: [],
    test_command: "echo ok",
    depends_on: null,
    max_time_seconds: 60,
    ...overrides,
  };
}

function setupGitRepo(): TestEnv {
  const worktreePath = mkdtempSync(join(tmpdir(), "validator-test-"));
  const mainRepoPath = mkdtempSync(join(tmpdir(), "validator-main-"));

  // Init worktree as git repo
  execSync("git init", { cwd: worktreePath });
  execSync('git config user.email "test@test.com"', { cwd: worktreePath });
  execSync('git config user.name "Test"', { cwd: worktreePath });
  writeFileSync(join(worktreePath, ".gitkeep"), "");
  execSync("git add -A && git commit -m 'init'", { cwd: worktreePath });

  const baseCommit = execSync("git rev-parse HEAD", {
    cwd: worktreePath,
    encoding: "utf-8",
  }).trim();

  // Also init main repo (for import comparison)
  execSync("git init", { cwd: mainRepoPath });
  execSync('git config user.email "test@test.com"', { cwd: mainRepoPath });
  execSync('git config user.name "Test"', { cwd: mainRepoPath });
  writeFileSync(join(mainRepoPath, ".gitkeep"), "");
  execSync("git add -A && git commit -m 'init'", { cwd: mainRepoPath });

  return { worktreePath, mainRepoPath, baseCommit };
}

function cleanup(env: TestEnv): void {
  try {
    execSync(`rm -rf "${env.worktreePath}" "${env.mainRepoPath}"`, {
      timeout: 5000,
    });
  } catch {}
}

// === Tests ===

describe("validator", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupGitRepo();
  });

  afterEach(() => {
    cleanup(env);
  });

  test("no changes → violation", () => {
    const result = validate(
      makeTask(),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("変更なし"))).toBe(true);
  });

  test("file count exceeded → violation", () => {
    // Create 4 files (max is 3)
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(env.worktreePath, `file${i}.ts`), `// file ${i}`);
    }

    const result = validate(
      makeTask(),
      makePlan({ max_changed_files_per_task: 3 }),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("変更ファイル数"))).toBe(
      true,
    );
  });

  test("banned pattern detected → violation", () => {
    // Write file containing banned string (constructed via concat)
    writeFileSync(
      join(env.worktreePath, "config.ts"),
      `const key = "${BANNED_1}";\n`,
    );

    const result = validate(
      makeTask(),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.banned_check_ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("禁止パターン検出")),
    ).toBe(true);
  });

  test("dangerous symbol in code → violation", () => {
    // Write file with dangerous symbol (constructed via concat)
    writeFileSync(
      join(env.worktreePath, "danger.ts"),
      `import { rmSync } from "fs";\n${DANGER_RM}("/tmp/x");\n`,
    );

    const result = validate(
      makeTask(),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.symbol_check_ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("危険シンボル検出")),
    ).toBe(true);
  });

  test("dangerous symbol in comment → no violation for that check", () => {
    // Dangerous symbol only in comment line
    writeFileSync(
      join(env.worktreePath, "safe.ts"),
      `// ${DANGER_RM} is dangerous but this is a comment\nconst x = 1;\n`,
    );

    const result = validate(
      makeTask(),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    // Symbol check should pass (comment lines skipped)
    expect(result.symbol_check_ok).toBe(true);
  });

  test("disallowed import → violation", () => {
    // Write file importing child_process (not in allowed_imports)
    const importLine = `import { exec } from "node:${DANGER_CHILD}";\n`;
    writeFileSync(
      join(env.worktreePath, "importer.ts"),
      importLine + "exec('ls');\n",
    );

    const result = validate(
      makeTask(),
      makePlan({ allowed_imports: ["bun:test"] }),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.import_check_ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("未許可Import追加")),
    ).toBe(true);
  });

  test("test command failure → test_passed false", () => {
    writeFileSync(join(env.worktreePath, "ok.ts"), "const x = 1;\n");

    const result = validate(
      makeTask({ test_command: "exit 1" }),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(false);
    expect(result.test_passed).toBe(false);
    expect(
      result.violations.some((v) => v.includes("テスト失敗")),
    ).toBe(true);
  });

  test("all checks pass → passed true", () => {
    writeFileSync(
      join(env.worktreePath, "hello.ts"),
      'export const greeting = "hello";\n',
    );

    const result = validate(
      makeTask({ test_command: "echo ok" }),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.passed).toBe(true);
    expect(result.file_count_ok).toBe(true);
    expect(result.banned_check_ok).toBe(true);
    expect(result.import_check_ok).toBe(true);
    expect(result.symbol_check_ok).toBe(true);
    expect(result.test_line_check_ok).toBe(true);
    expect(result.test_passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("test file line check: no test files → ok", () => {
    // テストファイル以外の変更のみ
    writeFileSync(
      join(env.worktreePath, "normal.ts"),
      'export const x = 1;\n',
    );

    const result = validate(
      makeTask({ test_command: "echo ok" }),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.test_line_check_ok).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("test file line check: 50 lines → ok", () => {
    // 50行のテストファイル
    const lines = Array(50).fill('test("x", () => {});').join("\n");
    writeFileSync(join(env.worktreePath, "good.test.ts"), lines);

    const result = validate(
      makeTask({ test_command: "echo ok" }),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.test_line_check_ok).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("test file line check: 5 lines → warning but passed still true", () => {
    // 5行の短すぎるテストファイル
    const lines = "// test\n// 2\n// 3\n// 4\n// 5";
    writeFileSync(join(env.worktreePath, "short.test.ts"), lines);

    const result = validate(
      makeTask({ test_command: "echo ok" }),
      makePlan(),
      env.worktreePath,
      env.mainRepoPath,
      env.baseCommit,
    );
    expect(result.test_line_check_ok).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.violations.some((v) => v.includes("short.test.ts") && v.includes("5行"))).toBe(true);
  });

  test("rollback cleans worktree", () => {
    writeFileSync(join(env.worktreePath, "dirty.ts"), "const x = 1;\n");

    rollback(env.worktreePath);

    const status = execSync("git status --porcelain", {
      cwd: env.worktreePath,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("");
  });
});
