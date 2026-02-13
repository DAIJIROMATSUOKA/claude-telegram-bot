import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock run-logger before importing
vi.mock("./run-logger", () => ({
  listRecentRuns: vi.fn(),
  readRunSummary: vi.fn(),
  readRunEvents: vi.fn(),
}));

import { handleTaskLogCommand } from "./tasklog-command";
import { listRecentRuns, readRunSummary, readRunEvents } from "./run-logger";
import type { RunSummary, RunEvent } from "./run-logger";

function makeCtx(text: string) {
  const replies: Array<{ text: string; opts?: any }> = [];
  return {
    ctx: {
      message: { text },
      reply: vi.fn(async (t: string, opts?: any) => {
        replies.push({ text: t, opts });
      }),
    } as any,
    replies,
  };
}

const SAMPLE_SUMMARY: RunSummary = {
  run_id: "run_test-plan_2026-02-13T10-00-00",
  plan_id: "test-plan",
  title: "Test Plan Title",
  started_at: "2026-02-13T10:00:00.000Z",
  completed_at: "2026-02-13T10:05:30.000Z",
  final_status: "all_passed",
  total_tasks: 3,
  passed_tasks: 3,
  failed_tasks: 0,
  total_duration_seconds: 330,
  task_results: [
    {
      task_id: "MT-001",
      status: "passed",
      duration_seconds: 120,
      exit_code: 0,
      violations: [],
      changed_files: ["src/foo.ts"],
    },
    {
      task_id: "MT-002",
      status: "passed",
      duration_seconds: 90,
      exit_code: 0,
      violations: [],
      changed_files: ["src/bar.ts", "src/baz.ts"],
    },
    {
      task_id: "MT-003",
      status: "passed",
      duration_seconds: 120,
      exit_code: 0,
      violations: [],
      changed_files: [],
    },
  ],
};

const SAMPLE_EVENTS: RunEvent[] = [
  { timestamp: "2026-02-13T10:00:00.000Z", run_id: "run_test", event: "run_start", data: { plan_id: "test-plan" } },
  { timestamp: "2026-02-13T10:00:01.000Z", run_id: "run_test", event: "task_start", data: { task_id: "MT-001" } },
  { timestamp: "2026-02-13T10:02:01.000Z", run_id: "run_test", event: "task_done", data: { task_id: "MT-001", status: "passed" } },
  { timestamp: "2026-02-13T10:05:30.000Z", run_id: "run_test", event: "run_complete", data: {} },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleTaskLogCommand", () => {
  describe("/tasklog (no args - list recent)", () => {
    it("shows empty message when no runs exist", async () => {
      (listRecentRuns as any).mockReturnValue([]);
      const { ctx } = makeCtx("/tasklog");
      await handleTaskLogCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain("実行履歴なし");
    });

    it("lists recent runs", async () => {
      (listRecentRuns as any).mockReturnValue([SAMPLE_SUMMARY]);
      const { ctx } = makeCtx("/tasklog");
      await handleTaskLogCommand(ctx);
      expect(listRecentRuns).toHaveBeenCalledWith(5);
      expect(ctx.reply).toHaveBeenCalledOnce();
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("Recent Task Runs");
      expect(msg).toContain("run_test-plan_2026-02-13T10-00-00");
      expect(msg).toContain("3/3 passed");
      expect(ctx.reply.mock.calls[0][1]).toEqual({ parse_mode: "HTML" });
    });
  });

  describe("/tasklog <run_id> (detail)", () => {
    it("shows not found for unknown run", async () => {
      (readRunSummary as any).mockReturnValue(null);
      const { ctx } = makeCtx("/tasklog run_nonexistent");
      await handleTaskLogCommand(ctx);
      expect(readRunSummary).toHaveBeenCalledWith("run_nonexistent");
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("Run not found");
    });

    it("shows detailed summary", async () => {
      (readRunSummary as any).mockReturnValue(SAMPLE_SUMMARY);
      const { ctx } = makeCtx("/tasklog run_test-plan_2026-02-13T10-00-00");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("run_test-plan_2026-02-13T10-00-00");
      expect(msg).toContain("Test Plan Title");
      expect(msg).toContain("3/3 passed");
      expect(msg).toContain("MT-001");
      expect(msg).toContain("MT-002");
      expect(msg).toContain("MT-003");
      expect(msg).toContain("src/foo.ts");
      expect(msg).toContain("5m30s");
    });

    it("shows partial status with warning icon", async () => {
      const partial = { ...SAMPLE_SUMMARY, final_status: "partial" as const, failed_tasks: 1, passed_tasks: 2 };
      (readRunSummary as any).mockReturnValue(partial);
      const { ctx } = makeCtx("/tasklog run_partial");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("\u26a0");
    });

    it("shows failed status with X icon", async () => {
      const failed = { ...SAMPLE_SUMMARY, final_status: "failed" as const, failed_tasks: 3, passed_tasks: 0 };
      (readRunSummary as any).mockReturnValue(failed);
      const { ctx } = makeCtx("/tasklog run_failed");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("\u274c");
    });

    it("shows violations when present", async () => {
      const withViolation = {
        ...SAMPLE_SUMMARY,
        task_results: [
          { ...SAMPLE_SUMMARY.task_results[0], violations: ["lint error", "type error"] },
        ],
      };
      (readRunSummary as any).mockReturnValue(withViolation);
      const { ctx } = makeCtx("/tasklog run_v");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("Violations: lint error, type error");
    });
  });

  describe("/tasklog <run_id> events", () => {
    it("shows not found for unknown run", async () => {
      (readRunEvents as any).mockReturnValue([]);
      const { ctx } = makeCtx("/tasklog run_nope events");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("Run not found");
    });

    it("shows event log", async () => {
      (readRunEvents as any).mockReturnValue(SAMPLE_EVENTS);
      const { ctx } = makeCtx("/tasklog run_test events");
      await handleTaskLogCommand(ctx);
      expect(readRunEvents).toHaveBeenCalledWith("run_test");
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("Events:");
      expect(msg).toContain("run_start");
      expect(msg).toContain("task_start");
      expect(msg).toContain("run_complete");
    });
  });

  describe("fmtDur", () => {
    it("formats seconds correctly via summary display", async () => {
      const shortRun = { ...SAMPLE_SUMMARY, total_duration_seconds: 45 };
      (readRunSummary as any).mockReturnValue(shortRun);
      const { ctx } = makeCtx("/tasklog run_short");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("45s");
    });

    it("formats minutes correctly", async () => {
      const medRun = { ...SAMPLE_SUMMARY, total_duration_seconds: 180 };
      (readRunSummary as any).mockReturnValue(medRun);
      const { ctx } = makeCtx("/tasklog run_med");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).toContain("3m");
    });
  });

  describe("HTML escaping", () => {
    it("escapes HTML in run_id", async () => {
      (readRunSummary as any).mockReturnValue(null);
      const { ctx } = makeCtx("/tasklog <script>alert(1)</script>");
      await handleTaskLogCommand(ctx);
      const msg = ctx.reply.mock.calls[0][0] as string;
      expect(msg).not.toContain("<script>");
      expect(msg).toContain("&lt;script&gt;");
    });
  });
});
