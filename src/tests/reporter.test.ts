/**
 * Tests for src/task/reporter.ts
 *
 * Mocks global.fetch to capture Telegram API calls.
 * Tests secret masking and long message truncation.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { TaskPlan, MicroTask, TaskResult, CompletionReport } from "../task/types";

// === Capture fetch calls ===
let fetchCalls: { url: string; body: any }[] = [];
const origFetch = globalThis.fetch;

function mockFetch() {
  fetchCalls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    fetchCalls.push({ url: String(url), body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = origFetch;
}

// Helpers
function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    plan_id: "TP-TEST",
    title: "Test Plan",
    created_by: "test",
    micro_tasks: [makeTask()],
    banned_patterns: [],
    allowed_imports: [],
    max_changed_files_per_task: 5,
    on_failure: "stop" as const,
    ...overrides,
  };
}

function makeTask(overrides?: Partial<MicroTask>): MicroTask {
  return {
    id: "MT-001",
    goal: "Test task goal",
    prompt: "",
    context_files: [],
    test_command: "echo ok",
    depends_on: null,
    max_time_seconds: 60,
    ...overrides,
  };
}

function makeResult(overrides?: Partial<TaskResult>): TaskResult {
  return {
    task_id: "MT-001",
    status: "success",
    validation: {
      passed: true,
      changed_files: ["src/foo.ts"],
      file_count_ok: true,
      banned_check_ok: true,
      import_check_ok: true,
      symbol_check_ok: true,
      test_passed: true,
      test_output: "",
      violations: [],
    },
    duration_seconds: 15,
    exit_code: 0,
    changes_summary: "",
    ...overrides,
  };
}

// Dynamically import reporter (must be after env setup)
async function loadReporter() {
  // Clear module cache to pick up fresh env
  delete require.cache[require.resolve("../task/reporter")];
  const mod = await import("../task/reporter");
  return mod;
}

describe("reporter", () => {
  const FAKE_TOKEN = "1234567890:ABCDEFGHIJ";
  const FAKE_CHAT = "999888777";

  beforeEach(() => {
    mockFetch();
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_ALLOWED_USERS = FAKE_CHAT;
  });

  afterEach(() => {
    restoreFetch();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USERS;
  });

  test("initReporter picks up env vars", async () => {
    const { initReporter, notifyOrchestratorStarted } = await loadReporter();
    initReporter();
    await notifyOrchestratorStarted(makePlan());
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain(FAKE_TOKEN);
    expect(fetchCalls[0].body.chat_id).toBe(FAKE_CHAT);
  });

  test("notifyTaskStarted sends correct message", async () => {
    const { initReporter, notifyTaskStarted } = await loadReporter();
    initReporter();
    const task = makeTask({ goal: "Create foo" });
    await notifyTaskStarted(makePlan(), task, 0, 3);
    expect(fetchCalls.length).toBe(1);
    const text = fetchCalls[0].body.text;
    expect(text).toContain("MicroTask 1/3");
    expect(text).toContain("Create foo");
    expect(text).toContain("開始");
  });

  test("notifyTaskPassed includes file count and duration", async () => {
    const { initReporter, notifyTaskPassed } = await loadReporter();
    initReporter();
    const result = makeResult({ duration_seconds: 42 });
    await notifyTaskPassed(makeTask(), result, 1, 5);
    expect(fetchCalls.length).toBe(1);
    const text = fetchCalls[0].body.text;
    expect(text).toContain("✅");
    expect(text).toContain("1ファイル変更");
    expect(text).toContain("42秒");
  });

  test("notifyTaskFailed includes violations", async () => {
    const { initReporter, notifyTaskFailed } = await loadReporter();
    initReporter();
    const result = makeResult({
      status: "failed",
      validation: {
        passed: false,
        changed_files: [],
        file_count_ok: false,
        banned_check_ok: true,
        import_check_ok: true,
        symbol_check_ok: true,
        test_passed: false,
        test_output: "",
        violations: ["変更ファイル数 6 > 上限 3"],
      },
    });
    await notifyTaskFailed(makeTask(), result, 0, 1);
    expect(fetchCalls.length).toBe(1);
    const text = fetchCalls[0].body.text;
    expect(text).toContain("❌");
    expect(text).toContain("変更ファイル数");
    expect(text).toContain("rollback");
  });

  test("sendCompletionReport includes summary", async () => {
    const { initReporter, sendCompletionReport } = await loadReporter();
    initReporter();
    const report: CompletionReport = {
      plan_id: "TP-TEST",
      title: "My Test Plan",
      results: [makeResult(), makeResult({ task_id: "MT-002", status: "failed" })],
      total_duration_seconds: 120,
      final_status: "partial",
    };
    await sendCompletionReport(report);
    expect(fetchCalls.length).toBe(1);
    const text = fetchCalls[0].body.text;
    expect(text).toContain("My Test Plan");
    expect(text).toContain("1/2");
    expect(text).toContain("120秒");
    expect(text).toContain("⚠️");
  });

  test("secret masking replaces token values", async () => {
    const { initReporter, notifyTaskStarted } = await loadReporter();
    initReporter();
    // Goal contains the actual token value
    const task = makeTask({ goal: `Token is ${FAKE_TOKEN}` });
    await notifyTaskStarted(makePlan(), task, 0, 1);
    const text = fetchCalls[0].body.text;
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).toContain("[***]");
  });

  test("long message gets truncated with notice", async () => {
    const { initReporter, sendCompletionReport } = await loadReporter();
    initReporter();
    // Create report with enough content to exceed 4000 chars
    const longViolation = "x".repeat(500);
    const results: TaskResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push(
        makeResult({
          task_id: `MT-${String(i).padStart(3, "0")}`,
          status: "failed",
          validation: {
            passed: false,
            changed_files: Array.from({ length: 10 }, (_, j) => `src/file${i}-${j}.ts`),
            file_count_ok: true,
            banned_check_ok: true,
            import_check_ok: true,
            symbol_check_ok: true,
            test_passed: false,
            test_output: "",
            violations: [longViolation],
          },
        }),
      );
    }
    const report: CompletionReport = {
      plan_id: "TP-LONG",
      title: "Long Report",
      results,
      total_duration_seconds: 300,
      final_status: "failed",
    };
    await sendCompletionReport(report);
    expect(fetchCalls.length).toBe(1);
    const text = fetchCalls[0].body.text;
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("中略");
  });

  test("escHtml escapes special characters", async () => {
    const { initReporter, notifyTaskStarted } = await loadReporter();
    initReporter();
    const task = makeTask({ goal: '<script>alert("xss")</script>' });
    await notifyTaskStarted(makePlan(), task, 0, 1);
    const text = fetchCalls[0].body.text;
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  test("no fetch when token not set", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { initReporter, notifyOrchestratorStarted } = await loadReporter();
    initReporter();
    await notifyOrchestratorStarted(makePlan());
    expect(fetchCalls.length).toBe(0);
  });
});
