/**
 * Tests for src/utils/pending-task.ts
 *
 * File-based pending task persistence. Uses real /tmp file.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { PENDING_TASK_FILE } from "../config";
import {
  savePendingTask,
  clearPendingTask,
  getPendingTask,
  updatePendingTaskSessionId,
  type PendingTask,
} from "../utils/pending-task";

function cleanup() {
  try {
    if (existsSync(PENDING_TASK_FILE)) unlinkSync(PENDING_TASK_FILE);
  } catch {}
}

const basePending: Omit<PendingTask, "saved_at"> = {
  user_id: 12345,
  chat_id: 12345,
  username: "testuser",
  original_message: "Test task message",
  session_id: null,
  started_at: Date.now(),
};

describe("PendingTask", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  // --- savePendingTask ---

  test("saves task to file", () => {
    savePendingTask(basePending);
    expect(existsSync(PENDING_TASK_FILE)).toBe(true);
    const data = JSON.parse(readFileSync(PENDING_TASK_FILE, "utf-8"));
    expect(data.user_id).toBe(12345);
    expect(data.original_message).toBe("Test task message");
    expect(typeof data.saved_at).toBe("number");
  });

  // --- getPendingTask ---

  test("returns saved task", () => {
    savePendingTask(basePending);
    const task = getPendingTask();
    expect(task).not.toBeNull();
    expect(task!.user_id).toBe(12345);
    expect(task!.original_message).toBe("Test task message");
  });

  test("returns null when no file exists", () => {
    const task = getPendingTask();
    expect(task).toBeNull();
  });

  test("returns null and clears expired task (>24h)", () => {
    const expired: PendingTask = {
      ...basePending,
      saved_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    };
    writeFileSync(PENDING_TASK_FILE, JSON.stringify(expired));
    const task = getPendingTask();
    expect(task).toBeNull();
    expect(existsSync(PENDING_TASK_FILE)).toBe(false);
  });

  test("returns task within 24h window", () => {
    const recent: PendingTask = {
      ...basePending,
      saved_at: Date.now() - 60 * 1000, // 1 minute ago
    };
    writeFileSync(PENDING_TASK_FILE, JSON.stringify(recent));
    const task = getPendingTask();
    expect(task).not.toBeNull();
    expect(task!.user_id).toBe(12345);
  });

  test("handles corrupt JSON gracefully", () => {
    writeFileSync(PENDING_TASK_FILE, "not valid json{{{");
    const task = getPendingTask();
    expect(task).toBeNull();
    // Should also clean up corrupt file
    expect(existsSync(PENDING_TASK_FILE)).toBe(false);
  });

  // --- clearPendingTask ---

  test("removes the file", () => {
    savePendingTask(basePending);
    expect(existsSync(PENDING_TASK_FILE)).toBe(true);
    clearPendingTask();
    expect(existsSync(PENDING_TASK_FILE)).toBe(false);
  });

  test("no error when file does not exist", () => {
    expect(() => clearPendingTask()).not.toThrow();
  });

  // --- updatePendingTaskSessionId ---

  test("updates session_id in existing file", () => {
    savePendingTask(basePending);
    updatePendingTaskSessionId("session-abc123");
    const data = JSON.parse(readFileSync(PENDING_TASK_FILE, "utf-8"));
    expect(data.session_id).toBe("session-abc123");
    expect(data.user_id).toBe(12345); // other fields preserved
  });

  test("no-op when file does not exist", () => {
    expect(() => updatePendingTaskSessionId("session-xyz")).not.toThrow();
  });
});
