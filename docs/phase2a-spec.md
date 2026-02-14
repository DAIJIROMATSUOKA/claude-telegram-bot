# Task Orchestrator Phase 2a 仕様書

**作成日:** 2026-02-14
**前提:** Phase 1完了（実タスク5件+4種成功、失敗系テスト3/3 PASS）
**ゴール:** 「暴走しない」自律制御ロジックを完成させ、夜間1h無人運転を可能にする

---

## 主要機能一覧

| # | 機能 | 概要 |
|---|------|------|
| 1 | 1回リトライ | 失敗理由を要約→再プロンプト→1回リトライ→再失敗で停止 |
| 2 | 2連続失敗全停止 | 2タスク連続失敗→全MicroTask停止+Telegram通知 |
| 3 | リソース上限統合 | ファイル数/変更行数/実行時間チェック→超過で即停止+rollback |
| 4 | Health Check | 夜間運転前にclaude --version+ダミープロンプトで生存確認 |
| 5 | caffeinate統合 | スリープ防止ラッパー |
| 6 | worktreeクリーナー | 起動時にgit worktree prune+古いディレクトリ強制削除 |
| 7 | on_failure拡張 | "stop"(既存) / "retry_then_stop"(新規) をTaskPlanで選択 |

**スコープ外（Phase 2b/3へ）:** Docker隔離、DAG依存関係、チェックポイント、D1ローカルバッファ

---

## ファイル責務

| ファイル | 変更 | 責務 |
|----------|------|------|
| `src/task/types.ts` | 修正 | on_failure拡張、RetryContext型追加 |
| `src/task/orchestrate.ts` | 修正 | リトライループ、リソース上限チェック、worktreeクリーナー、Health Check呼び出し |
| `src/task/health-check.ts` | **新規** | claude --version確認+ダミープロンプト実行 |
| `src/task/retry.ts` | **新規** | 失敗理由要約+再プロンプト生成 |
| `src/task/resource-limits.ts` | 既存 | ✅ 作成済み。orchestrate.tsから呼び出すのみ |
| `src/task/reporter.ts` | 修正 | リトライ通知、2連続失敗通知、Health Check結果通知 |
| `src/task/task-command.ts` | 修正 | caffeinate -i -sラッパー追加 |

---

## 詳細設計

### 1. リトライ（retry.ts + orchestrate.ts）

```
MicroTask失敗
  → buildRetryPrompt(task, failureReason, validation)
    → 元のpromptに失敗理由・violationsを追記した新promptを生成
  → 同じworktreeで再実行（rollback後）
  → 再度validate
  → 再失敗 → タスク停止（consecutiveFailures++）
  → 成功 → consecutiveFailures = 0
```

**retry.ts の関数:**
```typescript
export function buildRetryPrompt(
  originalPrompt: string,
  failureReason: string,
  violations: string[],
  testOutput: string
): string
```

- 元のpromptの末尾に「前回の失敗理由」セクションを追加
- violations一覧とtestOutputの最後500文字を含める
- 「前回と同じミスを繰り返すな」の指示を付与

### 2. 2連続失敗全停止（orchestrate.ts）

既存の`consecutiveFailures >= 2`ロジックを拡張:
- `on_failure: "retry_then_stop"` の場合のみリトライ実行
- `on_failure: "stop"` は従来通り即停止（Phase 1互換）
- 全停止時にTelegram通知: `notifyConsecutiveFailureStop(plan, results, runId)`

### 3. リソース上限統合（orchestrate.ts）

バリデーション後、追加チェック:
```typescript
const resourceChecks = checkAllLimits({
  changedFiles: validation.changed_files,
  diffOutput: getDiffOutput(worktreePath),
  startTime: taskStart,
  limits: plan.resource_limits ?? DEFAULT_RESOURCE_LIMITS,
});
const resourceFailed = resourceChecks.find(r => !r.passed);
if (resourceFailed) {
  // rollback + fail
}
```

**types.ts追加:**
```typescript
export interface ResourceLimits {
  maxFiles: number;          // default 10
  maxLineChanges: number;    // default 500
  maxSeconds: number;        // default 900
}
```

TaskPlanに `resource_limits?: ResourceLimits` を追加（任意。未指定時はデフォルト）。

### 4. Health Check（health-check.ts）

```typescript
export async function runHealthCheck(): Promise<{
  passed: boolean;
  claude_version: string;
  dummy_response: boolean;
  errors: string[];
}>
```

- `claude --version` → バージョン文字列取得（失敗→即停止）
- `echo "hello" | claude --print --model claude-sonnet-4-20250514` → 応答確認（30秒タイムアウト）
- Sonaute使用（安い方）。応答があればOK、内容は問わない

### 5. caffeinate統合（task-command.ts）

`/task` 実行時のnohupコマンドを変更:
```
caffeinate -i -s nohup bun run src/task/orchestrate.ts ... &
```
- `-i` = idle sleep防止
- `-s` = system sleep防止

### 6. worktreeクリーナー（orchestrate.ts）

`main()` 冒頭に追加:
```typescript
// Prune stale worktrees
execSync("git worktree prune", { cwd: MAIN_REPO });
// Remove worktrees older than 24h
cleanOldWorktrees(WORKTREE_BASE, 24 * 60 * 60 * 1000);
```

---

## MicroTask分割（実装順）

| MT | 内容 | 新規/修正ファイル | テスト |
|----|------|-------------------|--------|
| MT-001 | types.ts拡張 + retry.ts新規作成 | types.ts, retry.ts | retry.test.ts |
| MT-002 | health-check.ts新規作成 | health-check.ts | health-check.test.ts |
| MT-003 | orchestrate.tsにリトライ統合+リソース上限統合+worktreeクリーナー | orchestrate.ts | 手動検証 |
| MT-004 | reporter.tsにリトライ/全停止通知追加 | reporter.ts | reporter通知テスト |
| MT-005 | task-command.tsにcaffeinate追加 | task-command.ts | 手動検証 |
| MT-006 | 2連続失敗全停止の統合テスト | — | consecutive-failure.test.ts |

---

## 移行条件（Phase 2a → 2b）

- 夜間1h × 3回の無人運転で正常動作
- リトライが正常に動作（成功リトライ1件以上確認）
- 2連続失敗停止が正常に動作（テストで確認）
- リソース上限超過が正常に検知される（テストで確認）
- Docker PoC判定完了
