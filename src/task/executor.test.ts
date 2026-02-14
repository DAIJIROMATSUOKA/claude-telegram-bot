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

  test("goalが空文字 → エラーにならない（空文字含むプロンプト生成）", () => {
    const task = makeTask({ goal: "" });
    const result = buildPrompt(task);

    // エラーが発生せず、プロンプトが生成される
    expect(typeof result).toBe("string");
    expect(result).toContain("## Task:");
    // promptは含まれる
    expect(result).toContain("テスト指示");
  });

  test("context_filesが5個以上 → 全てプロンプトに含まれる", () => {
    const files = [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
      "src/g.ts",
    ];
    const task = makeTask({ context_files: files });
    const result = buildPrompt(task);

    expect(result).toContain("参考ファイル");
    for (const f of files) {
      expect(result).toContain(`- ${f}`);
    }
  });

  test("promptに日本語が含まれる → 正常にプロンプト生成", () => {
    const task = makeTask({
      goal: "日本語のゴール設定",
      prompt: "これは日本語の詳細な指示です。テストを追加してください。",
    });
    const result = buildPrompt(task);

    expect(result).toContain("日本語のゴール設定");
    expect(result).toContain("これは日本語の詳細な指示です。テストを追加してください。");
  });

  test("previous_changes_summaryが非常に長い(500文字) → 含まれる", () => {
    const longSummary = "変更内容: " + "あ".repeat(490); // 500文字
    const task = makeTask({ previous_changes_summary: longSummary });
    const result = buildPrompt(task);

    expect(result).toContain("前タスクの変更");
    expect(result).toContain(longSummary);
  });

  test("test_commandが複数コマンド(&&区切り) → そのまま含まれる", () => {
    const multiCommand = "bun run typecheck && bun test src/foo.test.ts && echo done";
    const task = makeTask({ test_command: multiCommand });
    const result = buildPrompt(task);

    expect(result).toContain("完了条件");
    expect(result).toContain(multiCommand);
  });
});
