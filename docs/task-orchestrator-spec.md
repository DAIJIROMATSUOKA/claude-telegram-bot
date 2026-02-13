# Jarvis Task Orchestrator — 実装仕様書 v2

**ステータス:** Phase 1 実装完了 + スモークテスト 2/2 PASS
**ディベート:** 6ラウンド収束済み（2026-02-13）
**参加者:** クロッピーA🦞 / クロッピーB🦞 / ChatGPT🤖 / ジェミー💎
**最終更新:** 2026-02-14

---

## 1. 概要

DJがTelegramに1投稿 → Jarvisが自律でコーディング → 結果報告。DJは張り付かない。

**大原則:** 「Claude AIに1行投げたら、あとは何もしない」

---

## 2. アーキテクチャ

```
DJ → クロッピー🦞(Planner) → TaskPlan JSON
  → exec bridge --fire --notify
  → M1 Orchestrator: MicroTask×N (各15分上限)
  → 各タスク後: validator(AST+regex+git diff+test)
  → PASS→commit / FAIL→rollback+停止
  → 完了→Completion Report→DJ承認
```

### 役割分担

| 誰 | 何をする |
|---|---|
| DJ | 「XXXやって」→「OK行け」→結果承認（2発言のみ） |
| クロッピー🦞 | Planner: タスク分解→TaskPlan JSON生成→exec bridge投入 |
| Jarvis🤖 | Executor: MicroTask実行→検証→commit→通知（**判断しない。手であり脳ではない**） |

### Plannerワークフロー（クロッピーがやること）

```
1. DJから大タスクを受け取る
2. コードベースの状態をexec bridgeで確認
3. MicroTaskに分解（DJと対話で精度UP可能）
4. TaskPlan JSONを生成
5. DJに「この計画で行くか？」と確認（承認ゲート）
6. exec bridge 2発:
   a. JSON書き込み: exec.sh "cat > /tmp/taskplan.json << 'PLAN' ... PLAN"
   b. 起動: exec.sh --fire --notify "bun run src/task/orchestrate.ts /tmp/taskplan.json"
7. DJに「投入した。あとはJarvisが自動でやる」と報告
```

---

## 3. ディベートで決定した設計判断

### 3.1 Planner = クロッピー自身（DJ案）

**却下案:**

| 案 | 却下理由 |
|---|---|
| Jarvisテンプレート分解 | 品質が低い。パターン外のタスクに対応不可（A案R2） |
| Claude CLI Planner（読み取り専用） | 読み取り専用CLIが存在しない。起動コスト30秒（A再反論R2） |
| Gemini CLI Planner | コスト中。実装難度中。クロッピーに劣る（B比較表R3） |
| Phase 1テンプレート→Phase 2 CLI昇格 | クロッピーなら最初から最高品質。段階的アプローチ不要（B R3） |

**採用理由（B R3）:**
- DJの意図を最も正確に理解（対話コンテキスト）
- コードベース全体の設計思想を知っている
- 実装コストゼロ（既にやっていることをJSON化するだけ）
- 新コード不要（decomposer.ts / planner.ts 不要）

### 3.2 セッション長 = 15分/MicroTask

**却下案:**

| 案 | 却下理由 |
|---|---|
| 30分〜2時間（A R1） | エラーの複利効果（B R1: 20分目の誤判断が40分間の全作業を汚染） |
| 10分（B R1） | 短すぎ。bun test(26秒)+TypeCheck(30秒)+CLI起動(20秒)→実作業6分では不十分 |

**採用根拠（A R2, B R3で合意）:**
- bun test: 最大26秒
- TypeCheck: ~30秒
- Claude CLI起動+コンテキスト読み込み: ~20秒
- 実作業: 残り約13分 → 「1つの意味ある変更」に十分

### 3.3 事後検証 > 事前制限

**却下案:** TaskContract.files（触っていいファイルの事前列挙）

**却下理由（B R1）:**
- 事前に全ファイルを列挙できない（新規ファイル作成が必要な場合）
- CLIレベルでファイル制限を強制する手段がない
- TypeScriptの型定義で制限してもCLI実行時には無意味

**採用案:** git diff + banned_patterns + AST Import解析 + 危険シンボルregex

### 3.4 Heartbeat不要（spawnタイムアウトで十分）

**却下案:** CLAUDE.mdのHEARTBEATセクションを定期更新させて監視

**却下理由（B R1）:**
- Claude CLIはタスクに集中するとheartbeat更新を忘れる（LLMの本質的問題）
- ファイル監視のポーリングコスト（Bun on macOSで未検証）
- MicroTask方式（15分上限）なら不要

**採用案:** `spawn`の`timeout`パラメータ + process group kill

### 3.5 エラー時は停止+rollback（Phase 1）

**却下案:** 警告して継続（A R1）

**却下理由（B R1）:** 安全側に倒す。エラーの複利効果を防ぐ。

**Phase別方針:**
- Phase 1: 停止。git checkout→Telegram通知→DJ判断
- Phase 2: 1回だけ自動リトライ（失敗原因をCLIに伝えて再実行。2回目失敗→停止）
- Phase 3+: エラーパターン学習（Learning Log連携）

### 3.6 レビューサマリー自動生成（A R2提案）

DJが500行のgit diffを読まなくて済むように、Completion Reportに変更サマリーを含める。

### 3.7 「Jarvis単独実装禁止」→「Jarvis単独判断禁止」に修正（B R3）

- 旧: Jarvisはテスト/git/再起動のみ
- 新: Jarvisはクロッピーが定義したMicroTaskの**実行**のみ。タスク分解・設計判断はクロッピーが行う
- **本質は同じ。** Jarvisに「考えさせない」

---

## 4. セキュリティ設計（ChatGPT/ジェミー指摘を統合）

### 4.1 ChatGPT致命点指摘と対策

**致命点①: test_commandが任意シェルコマンド**

ChatGPT指摘: `test_command: "bun test && rm -rf ~"` が通る。

対策: test_command allowlist ID化。executor内部で`spawn("bun", ["test", ...])` と固定引数で実行。shell経由しない。`&&`, `;`, `|` は構造的に不可能。

**致命点②: `--dangerously-skip-permissions` の被害境界が未定義**

ChatGPT指摘: Claude CLIがrepo外（.env, ~/.ssh, Keychain等）を触れる。

対策:
- git worktree方式（本体repoとは分離）
- HOMEをworktreeに向ける（~/.ssh → 存在しないパスに向く）
- env最小化（API_KEY, SSH_AUTH_SOCK等は渡さない）
- proxy環境変数無効化

### 4.2 ジェミー致命点指摘と対策

**テストコード自体が危険:** `fs.rmSync("/")` をテスト内に書かれたらbun test実行で発動。

対策: テスト実行**前**にAST静的解析+危険シンボルregexを実行。

**ChatGPT R4 追加指摘:**

| 穴 | 対策 |
|---|---|
| regex列挙は文字列分割で回避される | AST allowlist方式に変更（Bun.Transpiler.scanImports） |
| 既存Import経由の危険API呼び出し | Import差分だけでなく危険シンボル参照リストもregex/ASTで検出 |
| fetch等Import不要の通信API | executor.tsでproxy環境変数無効化。Phase 1はDJ監視下で許容 |
| /stop時の子孫プロセス | process group kill（detached: true → kill(-pid)） |

### 4.3 バリデーション順序（確定）

```
1. git diff → 変更ファイル一覧 + ファイル数チェック
2. banned_patterns (APIキー等)
3. AST Import解析 (ファイル全文、変更前との差分比較)
4. 危険シンボルregex (fs.rmSync, eval, child_process等)
5. bun test実行
6. 全PASS → git commit / いずれかFAIL → rollback
```

### 4.4 AST Import解析（Bun.Transpiler使用）

```
判定ロジック: (変更後のImport) - (変更前のImport) - (許可リスト) = 空ならPASS
```

**Import許可リスト（デフォルト）:**
```
bun:test, ./, ../, src/, @/,
fs, node:fs, path, node:path, util, node:util, os, node:os,
assert, node:assert, crypto, node:crypto, stream, node:stream,
events, node:events, buffer, node:buffer, url, node:url
```

### 4.5 危険シンボルパターン

```
fs.rmSync, fs.rm(, fs.unlinkSync, fs.writeFileSync(/非tmp),
child_process, execSync, spawnSync, process.exit,
Bun.spawn, eval(, new Function(, require('child_process'),
bun:ffi, Bun.$, Bun.shell
```

### 4.6 env隔離

```typescript
spawn("claude", args, {
  cwd: worktreePath,
  detached: true,
  env: {
    HOME: worktreePath,
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '',
    // .env, SSH_AUTH_SOCK, ANTHROPIC_API_KEY等は渡さない
  },
});
```

---

## 5. TaskPlan JSON仕様

```json
{
  "plan_id": "TP-20260213-001",
  "title": "session-bridge.ts retry追加",
  "created_by": "croppy",
  "micro_tasks": [
    {
      "id": "MT-001",
      "goal": "retry utility関数を作成",
      "prompt": "具体的な指示文...",
      "context_files": ["src/utils/session-bridge.ts"],
      "test_command": "bun test src/utils/retry.test.ts",
      "max_time_seconds": 900,
      "depends_on": null
    }
  ],
  "banned_patterns": ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "@google/generative-ai"],
  "dangerous_symbols": ["fs.rmSync"],
  "allowed_imports": ["bun:test"],
  "max_changed_files_per_task": 5,
  "on_failure": "stop"
}
```

### MicroTask型定義

```typescript
interface MicroTask {
  id: string;                       // "MT-001"
  goal: string;                     // 人間が読める目的
  prompt: string;                   // Claude CLIに渡す指示
  context_files: string[];          // 読むべきファイル
  test_command: string;             // 成功判定コマンド
  depends_on: string | null;        // 前タスクID
  max_time_seconds: number;         // デフォルト900(15分)
  previous_changes_summary?: string; // 前タスク変更サマリー(自動挿入)
}
```

---

## 6. コンポーネント一覧

### 実装済み（Phase 1）

| ファイル | 仕様行数 | 実装行数 | テスト | 状態 |
|---------|---------|---------|-------|------|
| `src/task/types.ts` | ~80 | 129 | - | ✅ |
| `src/task/executor.ts` | ~120 | 165 | ✅ 5件 | ✅ |
| `src/task/validator.ts` | ~180 | 396 | ✅ あり | ✅ |
| `src/task/orchestrate.ts` | ~200 | 449 | - | ✅ |
| `src/task/reporter.ts` | ~90 | 219 | ✅ 9件 | ✅ |
| `src/handlers/task-command.ts` | ~80 | 170 | - | ✅ |

### 仕様外の追加実装

| ファイル | 行数 | テスト | 内容 |
|---------|------|-------|------|
| `run-logger.ts` | 180 | ✅ 10件 | 実行ログJSONL永続化 |
| `tasklog-command.ts` | 120 | ✅ 12件 | /tasklog コマンド |

### 作らなかったもの（却下済み）

| ファイル | 却下理由 |
|---------|---------|
| decomposer.ts | クロッピーがPlannerなので不要（DJ案） |
| planner.ts | 同上 |
| heartbeat監視 | spawnタイムアウトで十分（B R1） |

---

## 7. Telegram通知フォーマット

### 進捗通知

```
🔄 MicroTask 1/3: retry関数作成 — 開始
✅ MicroTask 1/3: 完了 (2ファイル変更, テスト4/4 passed, 3分12秒)
❌ MicroTask 2/3: 失敗 (未許可Import: child_process) → rollback済み
```

### Completion Report

```
📋 Task Complete: session-bridge.ts retry追加
━━━━━━━━━━━━━━━━
📊 結果: 2/3 MicroTask成功, 1失敗
🔧 変更ファイル:
  - src/utils/retry.ts (新規, 45行)
  - src/utils/retry.test.ts (新規, 30行)
✅ テスト: 12/12 passed
⏱️ 所要時間: 8分42秒
⚠️ MT-003失敗: child_process import検出→rollback
━━━━━━━━━━━━━━━━
```

### FAIL通知（ChatGPT指摘: 次の一手テンプレ付き）

```
❌ MicroTask 2/3 FAIL
━━━━━━━━━━━━━━━
原因: bun test失敗（src/utils/retry.test.ts:42 AssertionError）
変更: git checkout済み（ワークツリーはクリーン）
━━━━━━━━━━━━━━━
💡 次の一手（コピペ用）:
「MT-002を再分割: retry適用とテスト修正を別タスクにして再実行」
```

---

## 8. スモークテスト結果（2026-02-13）

### SMOKE-001: 成功系 ✅

**入力:** hello.txtにHello World書込み+テスト
**結果:** all_passed | 1/1 | 35秒
- Claude CLIがhello.txt + hello.test.ts作成
- bun test 2/2 pass
- バリデーション全項目pass
- worktree内commit成功

### SMOKE-002: 防御系 ✅

**入力:** 意図的にchild_processをimportするコードを書く
**結果:** failed | 0/1 | 9秒
- **防御が2層で作動:**
  - Layer 1: Claude CLI自身が禁止事項を認識し、コード作成を拒否
  - Layer 2: バリデータが「変更なし＝タスク未完了」として弾いた
- rollback実行 → on_failure=stop → 停止

---

## 9. Phase区分

| Phase | 条件 | 夜間 | 必要な追加実装 |
|-------|------|------|--------------|
| **1（現在）** | DJ監視下、AST+regex+process group kill | ❌ 禁止 | なし（実装済み） |
| 2 | +テスト行数チェック+2連続失敗停止+専用ユーザー | ⚠️ 1h上限 | OS専用ユーザー |
| 3 | Docker隔離+ネットワーク制御 | ✅ 一晩OK | Dockerfile |

### Phase 2への条件（未着手）

1. Phase 1で実タスク5件以上成功
2. OS専用ユーザー実装
3. テスト行数チェック追加
4. 2連続失敗停止ロジック追加
5. 夜間実行は1h上限

---

## 10. 絶対ルール（Phase 1運用）

1. **DJがPCの前にいる時のみ実行**
2. `/taskstop` でいつでも中断可能
3. worktree内で作業、mainには手動マージ
4. 従量課金API使用禁止（Claude CLI = Maxサブスク）
5. Jarvisは判断しない。クロッピーが判断する

---

## 11. ディベート経緯サマリー

### 参加者と役割

| 参加者 | 役割 | 特徴 |
|---|---|---|
| クロッピーA🦞 | 提案者（攻め） | /ai claude拡張、30分セッション、TaskContract |
| クロッピーB🦞 | 批判者（守り） | MicroTask方式、事後検証、「信頼しない、検証する」 |
| DJ | アイデア提供 | 「クロッピーがPlanner」案で全論点を解決 |
| ChatGPT🤖 | 審判（セキュリティ重視） | 致命点2つ指摘（任意コマンド実行+被害境界未定義） |
| ジェミー💎 | 審判（実用性重視） | テストコード内の危険コード指摘、Phase区分明確化 |

### ラウンド進行

| R | 内容 | 決着した論点 |
|---|---|---|
| R1 | A提案 vs B反論 | B: MicroTask方式、事後検証、heartbeat不要 |
| R2 | A再反論+統合案 | A: 15分セッション、レビューサマリー。B: Planner問題は未決 |
| R3 | B最終案+DJアイデア | **クロッピー=Planner**（DJ案）で全論点決着 |
| R4 | ChatGPT審判 | 致命点2つ: test_commandシェル注入 + 被害境界未定義 |
| R5 | ジェミー審判 | テストコード危険、Phase段階化、条件付きOK |
| R6 | ChatGPT R4+ジェミー最終 | AST allowlist、env隔離、process group kill → 全員GO |

### 投票結果

| 審判 | 判定 |
|------|------|
| クロッピーA🦞 | ✅ GO |
| クロッピーB🦞 | ✅ GO |
| ChatGPT🤖 | ✅ GO（条件付き: 残穴3点を必須仕様に） |
| ジェミー💎 | ✅ 完全GO |

### 収束チェックリスト（全論点決着）

| 論点 | A案 | B案 | 決着 |
|------|-----|-----|------|
| Planner | テンプレート→将来CLI | 2段階CLI | **クロッピー自身（DJ案）** |
| セッション長 | 15分 | 10分 | **15分（A案）** |
| ファイル制限 | 事前列挙 | 事後検証 | **事後検証（B案）** |
| Heartbeat | CLAUDE.md監視 | 不要 | **不要（B案）** |
| タスク分解 | Jarvis内蔵 | CLI分離 | **クロッピー（DJ案）** |
| エラー時 | 警告+継続 | 停止+rollback | **停止+rollback（B案）** |
| レビュー | diff500行 | — | **サマリー自動生成（A案）** |
| /taskコマンド | 新設 | 新設 | **合意** |
| /stop | 新設 | 新設 | **合意** |
| git commit/task | 各タスク後 | 各タスク後 | **合意** |
| 夜間バッチ | Phase 2 | Phase 2 | **合意** |
| テストコード安全 | — | — | **AST+regex事前検査（ChatGPT/ジェミー指摘）** |
| 隔離レベル | — | — | **worktree+env最小化（Phase 1）→Docker（Phase 3）** |

---

## 12. Phase 2以降のロードマップ

**優先順位（ChatGPT最終判定）:**

1. **Learning Log連携（最優先）** — 失敗理由と成功パターンを蓄積。Planner品質向上に直結
2. **自動リトライ（制限付き）** — 同一入力再実行ではなく、MicroTask再分割方向に限定。最大1回
3. **夜間バッチ** — 隔離（専用ユーザー/Docker）確立後に解禁

### 夜間バッチの実現方法（B R3設計）

```
DJ（寝る前）: 「明日までにこの3つやっといて」
クロッピー: 3タスク分のTaskPlanを生成 → exec bridge --fire --notify
Jarvis: 夜間に順次実行 → 朝にCompletion Report
DJ（朝）: Telegramで結果確認 → 承認 or ロールバック
```

### 定型タスクのcron化（B R3設計）

```
~/claude-telegram-bot/task-plans/
  ├── morning-briefing.json   # 毎朝3:00に実行
  ├── evening-review.json     # 毎晩20:00に実行
  └── weekly-report.json      # 毎週日曜19:00に実行
```

---

*ディベート6ラウンド、全員GO。Phase 1実装完了。*
