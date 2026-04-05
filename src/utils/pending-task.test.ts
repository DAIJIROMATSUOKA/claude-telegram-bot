import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { invalidateConfig } from "./config-loader";

// Use a unique temp file for tests to avoid collision with real pending task
const TEST_PENDING_FILE = "/tmp/claude-telegram-pending-task-TEST.json";

mock.module("../config", () => ({
  PENDING_TASK_FILE: TEST_PENDING_FILE,
}));

import {
  savePendingTask,
  clearPendingTask,
  getPendingTask,
  updatePendingTaskSessionId,
} from "./pending-task";

function cleanup() {
  try {
    if (existsSync(TEST_PENDING_FILE)) unlinkSync(TEST_PENDING_FILE);
    invalidateConfig(TEST_PENDING_FILE);
  } catch {}
}

describe("pending-task", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe("savePendingTask", () => {
    test("saves task to file", () => {
      savePendingTask({
        user_id: 123,
        chat_id: 456,
        username: "testuser",
        original_message: "hello world",
        session_id: "sess-1",
        started_at: Date.now(),
      });
      expect(existsSync(TEST_PENDING_FILE)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_PENDING_FILE, "utf-8"));
      expect(data.user_id).toBe(123);
      expect(data.original_message).toBe("hello world");
      expect(data.saved_at).toBeGreaterThan(0);
    });

    test("saves very long message (10000+ chars)", () => {
      const longMsg = "x".repeat(10000);
      savePendingTask({
        user_id: 123,
        chat_id: 456,
        username: "testuser",
        original_message: longMsg,
        session_id: null,
        started_at: Date.now(),
      });
      const data = JSON.parse(readFileSync(TEST_PENDING_FILE, "utf-8"));
      expect(data.original_message.length).toBe(10000);
    });

    test("saves message with special characters (unicode, newlines, quotes)", () => {
      const specialMsg = '日本語テスト\n"quoted"\t\ttabs\u0000null';
      savePendingTask({
        user_id: 123,
        chat_id: 456,
        username: "testuser",
        original_message: specialMsg,
        session_id: null,
        started_at: Date.now(),
      });
      const data = JSON.parse(readFileSync(TEST_PENDING_FILE, "utf-8"));
      expect(data.original_message).toBe(specialMsg);
    });
  });

  describe("clearPendingTask", () => {
    test("removes file when it exists", () => {
      writeFileSync(TEST_PENDING_FILE, "{}");
      expect(existsSync(TEST_PENDING_FILE)).toBe(true);
      clearPendingTask();
      expect(existsSync(TEST_PENDING_FILE)).toBe(false);
    });

    test("does not throw when file does not exist", () => {
      expect(() => clearPendingTask()).not.toThrow();
    });
  });

  describe("getPendingTask", () => {
    test("returns null when no file exists", () => {
      expect(getPendingTask()).toBeNull();
    });

    test("returns task when file is recent", () => {
      const task = {
        user_id: 123,
        chat_id: 456,
        username: "test",
        original_message: "test msg",
        session_id: "s1",
        started_at: Date.now(),
        saved_at: Date.now(),
      };
      writeFileSync(TEST_PENDING_FILE, JSON.stringify(task));
      invalidateConfig(TEST_PENDING_FILE);
      const result = getPendingTask();
      expect(result).not.toBeNull();
      expect(result!.user_id).toBe(123);
      expect(result!.original_message).toBe("test msg");
    });

    test("returns null and clears expired task (>24h old)", () => {
      const task = {
        user_id: 123,
        chat_id: 456,
        username: "test",
        original_message: "old task",
        session_id: null,
        started_at: Date.now() - 25 * 60 * 60 * 1000,
        saved_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      };
      writeFileSync(TEST_PENDING_FILE, JSON.stringify(task));
      invalidateConfig(TEST_PENDING_FILE);
      const result = getPendingTask();
      expect(result).toBeNull();
      expect(existsSync(TEST_PENDING_FILE)).toBe(false);
    });

    test("handles corrupted JSON gracefully", () => {
      writeFileSync(TEST_PENDING_FILE, "not valid json {{{");
      invalidateConfig(TEST_PENDING_FILE);
      const result = getPendingTask();
      expect(result).toBeNull();
      // Should have cleaned up the corrupted file
      expect(existsSync(TEST_PENDING_FILE)).toBe(false);
    });

    test("task just under 24h is still valid", () => {
      const task = {
        user_id: 123,
        chat_id: 456,
        username: "test",
        original_message: "borderline task",
        session_id: null,
        started_at: Date.now() - 23 * 60 * 60 * 1000,
        saved_at: Date.now() - 23 * 60 * 60 * 1000, // 23 hours ago
      };
      writeFileSync(TEST_PENDING_FILE, JSON.stringify(task));
      invalidateConfig(TEST_PENDING_FILE);
      const result = getPendingTask();
      expect(result).not.toBeNull();
      expect(result!.original_message).toBe("borderline task");
    });
  });

  describe("updatePendingTaskSessionId", () => {
    test("updates session_id in existing file", () => {
      const task = {
        user_id: 123,
        chat_id: 456,
        username: "test",
        original_message: "msg",
        session_id: null,
        started_at: Date.now(),
        saved_at: Date.now(),
      };
      writeFileSync(TEST_PENDING_FILE, JSON.stringify(task));
      invalidateConfig(TEST_PENDING_FILE);
      updatePendingTaskSessionId("new-session-id-xyz");
      const data = JSON.parse(readFileSync(TEST_PENDING_FILE, "utf-8"));
      expect(data.session_id).toBe("new-session-id-xyz");
    });

    test("does nothing when no file exists", () => {
      expect(() => updatePendingTaskSessionId("whatever")).not.toThrow();
      expect(existsSync(TEST_PENDING_FILE)).toBe(false);
    });
  });

  describe("concurrent saves (edge case)", () => {
    test("rapid sequential saves keep last value", () => {
      for (let i = 0; i < 10; i++) {
        savePendingTask({
          user_id: 123,
          chat_id: 456,
          username: "test",
          original_message: `message-${i}`,
          session_id: null,
          started_at: Date.now(),
        });
      }
      const data = JSON.parse(readFileSync(TEST_PENDING_FILE, "utf-8"));
      expect(data.original_message).toBe("message-9");
    });

    test("save then immediate clear leaves no file", () => {
      savePendingTask({
        user_id: 123,
        chat_id: 456,
        username: "test",
        original_message: "will be cleared",
        session_id: null,
        started_at: Date.now(),
      });
      clearPendingTask();
      expect(existsSync(TEST_PENDING_FILE)).toBe(false);
      expect(getPendingTask()).toBeNull();
    });

    test("save-get-clear-get cycle", () => {
      savePendingTask({
        user_id: 111,
        chat_id: 222,
        username: "cycle",
        original_message: "cycle test",
        session_id: "s-cycle",
        started_at: Date.now(),
      });
      const result1 = getPendingTask();
      expect(result1).not.toBeNull();
      expect(result1!.original_message).toBe("cycle test");

      clearPendingTask();
      const result2 = getPendingTask();
      expect(result2).toBeNull();
    });
  });
});
