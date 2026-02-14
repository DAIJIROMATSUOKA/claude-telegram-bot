import { describe, expect, test } from "bun:test";
import { buildPrompt } from "./executor";
import type { MicroTask } from "./types";

const makeTask = (overrides: Partial<MicroTask> = {}): MicroTask => ({
  id: "MT-TEST",
  goal: "テスト目的",
  prompt: "テスト指示",
  context_files: [],
  test_command: "echo ok",
  depends_on: null,
  max_time_seconds: 300,
  ...overrides,
});

describe("buildPrompt", () => {
  test("最小限のMicroTask（goal+promptのみ、context_files空）→ goalとpromptが含まれる", () => {
    const task = makeTask();
    const result = buildPrompt(task);

    expect(result).toContain("テスト目的");
    expect(result).toContain("テスト指示");
  });

  test("context_files あり → 「参考ファイル」セクションにファイルパスが列挙される", () => {
    const task = makeTask({
      context_files: ["src/foo.ts", "src/bar.ts"],
    });
    const result = buildPrompt(task);

    expect(result).toContain("参考ファイル");
    expect(result).toContain("- src/foo.ts");
    expect(result).toContain("- src/bar.ts");
  });

  test("previous_changes_summary あり → 「前タスクの変更」セクションが含まれる", () => {
    const task = makeTask({
      previous_changes_summary: "前回の変更内容サマリー",
    });
    const result = buildPrompt(task);

    expect(result).toContain("前タスクの変更");
    expect(result).toContain("前回の変更内容サマリー");
  });

  test("test_command → 「完了条件」に含まれる", () => {
    const task = makeTask({
      test_command: "bun test src/foo.test.ts",
    });
    const result = buildPrompt(task);

    expect(result).toContain("完了条件");
    expect(result).toContain("bun test src/foo.test.ts");
  });

  test("禁止事項セクションが常に含まれる", () => {
    const task = makeTask();
    const result = buildPrompt(task);

    expect(result).toContain("禁止事項");
    expect(result).toContain("テストファイルの削除");
    expect(result).toContain("/tmp以外への絶対パス書込み");
  });

  test("APIキー関連の禁止が含まれる", () => {
    const task = makeTask();
    const result = buildPrompt(task);

    // APIキー禁止の記述があることを確認（具体的なキー名は使わない）
    expect(result).toContain("APIキー");
    expect(result).toContain("の追加");
    // 禁止事項セクション内に含まれることを確認
    expect(result).toMatch(/禁止事項[\s\S]*APIキー/);
  });
});
