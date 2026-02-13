/**
 * Tests for src/utils/task-analyzer.ts
 *
 * Pure logic tests for AI_MEMORY task parsing and analysis.
 */
import { describe, test, expect } from "bun:test";
import {
  parseTasksFromMemory,
  calculateDaysElapsed,
  analyzeTasks,
  formatTaskAnalysis,
  formatEveningReview,
  type Task,
} from "../utils/task-analyzer";

// === parseTasksFromMemory ===

describe("parseTasksFromMemory", () => {
  test("parses today tasks", () => {
    const content = `## 2026-02-13 今日やること
- プリマ食品対応
- 水産流通ソフト
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks.length).toBe(2);
    expect(todayTasks[0].content).toBe("プリマ食品対応");
    expect(todayTasks[0].completed).toBe(false);
  });

  test("parses completed tasks with ✅", () => {
    const content = `## 2026-02-13 今日やること
- ✅ ケンコーマヨネーズ電話
- プリマ食品対応
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks[0].completed).toBe(true);
    expect(todayTasks[0].content).toBe("ケンコーマヨネーズ電話");
    expect(todayTasks[1].completed).toBe(false);
  });

  test("parses tomorrow tasks", () => {
    const content = `## 2026-02-13 今日やること
- タスクA

## 2026-02-14 明日やること
- タスクB
- タスクC
`;
    const { tomorrowTasks } = parseTasksFromMemory(content);
    expect(tomorrowTasks.length).toBe(2);
    expect(tomorrowTasks[0].content).toBe("タスクB");
  });

  test("extracts date from section header", () => {
    const content = `## 2026-02-13 今日やること
- タスクA
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks[0].date).toBe("2026-02-13");
  });

  test("deduplicates tasks with same content", () => {
    const content = `## 2026-02-13 今日やること
- プリマ食品対応
- プリマ食品対応
- 水産流通ソフト
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks.length).toBe(2);
  });

  test("ends section on --- separator", () => {
    const content = `## 2026-02-13 今日やること
- タスクA
---
- これはタスクではない
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks.length).toBe(1);
  });

  test("assigns priority based on keywords", () => {
    const content = `## 2026-02-13 今日やること
- 緊急対応
- 整理
- 普通のタスク
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks[0].priority).toBe("high"); // 緊急
    expect(todayTasks[1].priority).toBe("low"); // 整理
    expect(todayTasks[2].priority).toBe("medium"); // default
  });

  test("meeting keywords are high priority", () => {
    const content = `## 2026-02-13 今日やること
- 15時美山Web会議
- メール返信
`;
    const { todayTasks } = parseTasksFromMemory(content);
    expect(todayTasks[0].priority).toBe("high"); // 会議
    expect(todayTasks[1].priority).toBe("high"); // メール返信
  });

  test("empty content returns empty arrays", () => {
    const { todayTasks, tomorrowTasks } = parseTasksFromMemory("");
    expect(todayTasks).toEqual([]);
    expect(tomorrowTasks).toEqual([]);
  });
});

// === calculateDaysElapsed ===

describe("calculateDaysElapsed", () => {
  test("returns 0 for today", () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(calculateDaysElapsed(dateStr)).toBe(0);
  });

  test("returns positive for past dates", () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
    expect(calculateDaysElapsed(dateStr)).toBe(5);
  });

  test("returns 0 for invalid date", () => {
    expect(calculateDaysElapsed("invalid")).toBe(0);
    expect(calculateDaysElapsed("")).toBe(0);
  });
});

// === analyzeTasks ===

describe("analyzeTasks", () => {
  function makeTask(overrides?: Partial<Task>): Task {
    return {
      content: "Test task",
      completed: false,
      priority: "medium",
      ...overrides,
    };
  }

  test("counts completed and pending", () => {
    const tasks = [
      makeTask({ completed: true }),
      makeTask({ completed: false }),
      makeTask({ completed: false }),
    ];
    const analysis = analyzeTasks(tasks);
    expect(analysis.totalTasks).toBe(3);
    expect(analysis.completedTasks).toBe(1);
    expect(analysis.pendingTasks).toBe(2);
  });

  test("identifies high priority pending tasks", () => {
    const tasks = [
      makeTask({ priority: "high", completed: false }),
      makeTask({ priority: "high", completed: true }),
      makeTask({ priority: "low", completed: false }),
    ];
    const analysis = analyzeTasks(tasks);
    expect(analysis.highPriorityTasks.length).toBe(1);
    expect(analysis.highPriorityTasks[0].priority).toBe("high");
  });

  test("identifies stale tasks (3+ days)", () => {
    const past = new Date();
    past.setDate(past.getDate() - 4);
    const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;

    const tasks = [
      makeTask({ date: dateStr, completed: false }),
    ];
    const analysis = analyzeTasks(tasks);
    expect(analysis.staleTasks.length).toBe(1);
    expect(analysis.staleTasks[0].daysElapsed).toBe(4);
  });

  test("completed tasks not counted as stale", () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;

    const tasks = [makeTask({ date: dateStr, completed: true })];
    const analysis = analyzeTasks(tasks);
    expect(analysis.staleTasks.length).toBe(0);
  });

  test("empty task list", () => {
    const analysis = analyzeTasks([]);
    expect(analysis.totalTasks).toBe(0);
    expect(analysis.completedTasks).toBe(0);
    expect(analysis.pendingTasks).toBe(0);
    expect(analysis.highPriorityTasks).toEqual([]);
  });
});

// === formatTaskAnalysis ===

describe("formatTaskAnalysis", () => {
  test("includes progress bar", () => {
    const analysis = analyzeTasks([
      { content: "A", completed: true, priority: "medium" },
      { content: "B", completed: false, priority: "medium" },
    ]);
    const output = formatTaskAnalysis(analysis, []);
    expect(output).toContain("進捗状況");
    expect(output).toContain("50%");
  });

  test("includes high priority tasks section", () => {
    const analysis = analyzeTasks([
      { content: "緊急対応", completed: false, priority: "high" },
    ]);
    const output = formatTaskAnalysis(analysis, []);
    expect(output).toContain("高優先度タスク");
    expect(output).toContain("緊急対応");
  });

  test("includes tomorrow tasks", () => {
    const analysis = analyzeTasks([]);
    const tomorrow = [
      { content: "明日のタスク", completed: false, priority: "medium" as const },
    ];
    const output = formatTaskAnalysis(analysis, tomorrow);
    expect(output).toContain("明日のタスク");
  });
});

// === formatEveningReview ===

describe("formatEveningReview", () => {
  test("includes evening review header", () => {
    const analysis = analyzeTasks([
      { content: "A", completed: true, priority: "medium" },
    ]);
    const output = formatEveningReview(analysis, []);
    expect(output).toContain("振り返り");
  });

  test("shows completed count", () => {
    const analysis = analyzeTasks([
      { content: "完了タスク", completed: true, priority: "medium" },
    ]);
    const output = formatEveningReview(analysis, []);
    expect(output).toContain("完了したタスク: 1件");
    expect(output).toContain("お疲れ様でした");
  });

  test("shows uncompleted tasks", () => {
    const analysis = analyzeTasks([
      { content: "未完了タスク", completed: false, priority: "medium" },
    ]);
    const output = formatEveningReview(analysis, []);
    expect(output).toContain("未完了タスク");
  });
});
