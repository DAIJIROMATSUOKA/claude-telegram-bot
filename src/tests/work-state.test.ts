/**
 * Tests for src/utils/work-state.ts
 *
 * Multi-step work plan persistence across restarts.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  setWorkState,
  getWorkState,
  updateWorkProgress,
  updateWorkStateSessionId,
  clearWorkState,
  formatWorkStateForContext,
  isWorkComplete,
  WORK_STATE_FILE,
  type WorkState,
  type WorkTask,
} from "../utils/work-state";

function cleanup() {
  clearWorkState();
}

const baseState: Omit<WorkState, "created_at" | "updated_at" | "expires_at"> = {
  assigned_by: "DJ",
  directive: "テスト作業指示",
  user_id: 12345,
  chat_id: 12345,
  username: "testuser",
  tasks: [
    { id: 1, task: "Step 1: Prepare", status: "pending" },
    { id: 2, task: "Step 2: Execute", status: "pending" },
    { id: 3, task: "Step 3: Verify", status: "pending" },
  ],
  constraints: ["no downtime", "backup first"],
  last_progress: "",
  session_id: null,
};

describe("WorkState", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  // --- setWorkState / getWorkState ---

  test("saves and retrieves work state", () => {
    setWorkState(baseState);
    const state = getWorkState();
    expect(state).not.toBeNull();
    expect(state!.directive).toBe("テスト作業指示");
    expect(state!.tasks.length).toBe(3);
    expect(typeof state!.created_at).toBe("string");
    expect(typeof state!.expires_at).toBe("number");
  });

  test("returns null when no file exists", () => {
    expect(getWorkState()).toBeNull();
  });

  test("returns null and clears expired state", () => {
    setWorkState(baseState);
    // Manually set expires_at to past
    const raw = JSON.parse(readFileSync(WORK_STATE_FILE, "utf-8"));
    raw.expires_at = Date.now() - 1000;
    writeFileSync(WORK_STATE_FILE, JSON.stringify(raw));

    expect(getWorkState()).toBeNull();
    expect(existsSync(WORK_STATE_FILE)).toBe(false);
  });

  // --- updateWorkProgress ---

  test("updates task status", () => {
    setWorkState(baseState);
    updateWorkProgress(1, "completed", "Done successfully");
    const state = getWorkState();
    const task1 = state!.tasks.find((t) => t.id === 1);
    expect(task1!.status).toBe("completed");
    expect(task1!.notes).toBe("Done successfully");
  });

  test("updates last_progress", () => {
    setWorkState(baseState);
    updateWorkProgress(2, "in_progress", undefined, "Working on step 2");
    const state = getWorkState();
    expect(state!.last_progress).toBe("Working on step 2");
  });

  test("no-op when no state exists", () => {
    expect(() => updateWorkProgress(1, "completed")).not.toThrow();
  });

  // --- updateWorkStateSessionId ---

  test("updates session_id", () => {
    setWorkState(baseState);
    updateWorkStateSessionId("sess-12345678");
    const state = getWorkState();
    expect(state!.session_id).toBe("sess-12345678");
  });

  test("no-op when no state exists", () => {
    expect(() => updateWorkStateSessionId("sess-xyz")).not.toThrow();
  });

  // --- clearWorkState ---

  test("removes the file", () => {
    setWorkState(baseState);
    expect(existsSync(WORK_STATE_FILE)).toBe(true);
    clearWorkState();
    expect(existsSync(WORK_STATE_FILE)).toBe(false);
  });

  test("no error when file does not exist", () => {
    expect(() => clearWorkState()).not.toThrow();
  });

  // --- formatWorkStateForContext ---

  test("formats context string with all fields", () => {
    setWorkState(baseState);
    const state = getWorkState()!;
    const ctx = formatWorkStateForContext(state);
    expect(ctx).toContain("[ACTIVE WORK PLAN]");
    expect(ctx).toContain("DJ");
    expect(ctx).toContain("テスト作業指示");
    expect(ctx).toContain("no downtime");
    expect(ctx).toContain("Step 1: Prepare");
    expect(ctx).toContain("⬜"); // pending icon
    expect(ctx).toContain("再起動前から継続中");
  });

  test("shows correct status icons", () => {
    setWorkState({
      ...baseState,
      tasks: [
        { id: 1, task: "Done", status: "completed" },
        { id: 2, task: "Doing", status: "in_progress" },
        { id: 3, task: "Failed", status: "failed" },
        { id: 4, task: "Todo", status: "pending" },
      ],
    });
    const state = getWorkState()!;
    const ctx = formatWorkStateForContext(state);
    expect(ctx).toContain("✅");
    expect(ctx).toContain("🔄");
    expect(ctx).toContain("❌");
    expect(ctx).toContain("⬜");
  });

  test("includes last_progress when set", () => {
    setWorkState({ ...baseState, last_progress: "Step 1 done, moving to step 2" });
    const state = getWorkState()!;
    const ctx = formatWorkStateForContext(state);
    expect(ctx).toContain("Step 1 done, moving to step 2");
  });

  // --- isWorkComplete ---

  test("returns false when tasks pending", () => {
    setWorkState(baseState);
    expect(isWorkComplete(getWorkState()!)).toBe(false);
  });

  test("returns true when all completed", () => {
    setWorkState({
      ...baseState,
      tasks: [
        { id: 1, task: "A", status: "completed" },
        { id: 2, task: "B", status: "completed" },
      ],
    });
    expect(isWorkComplete(getWorkState()!)).toBe(true);
  });

  test("returns true when all completed or failed", () => {
    setWorkState({
      ...baseState,
      tasks: [
        { id: 1, task: "A", status: "completed" },
        { id: 2, task: "B", status: "failed" },
      ],
    });
    expect(isWorkComplete(getWorkState()!)).toBe(true);
  });

  test("returns false when any in_progress", () => {
    setWorkState({
      ...baseState,
      tasks: [
        { id: 1, task: "A", status: "completed" },
        { id: 2, task: "B", status: "in_progress" },
      ],
    });
    expect(isWorkComplete(getWorkState()!)).toBe(false);
  });
});
