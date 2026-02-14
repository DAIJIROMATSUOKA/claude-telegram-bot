# JARVIS 完全メンテナンス仕様書
**作成日:** 2026-02-14
**作成者:** クロッピー🦞

---

## 目的
デッドコード削除・型エラー修正・テスト整理でコードベースを健全化。
54,181行 → 目標35,000行以下（35%削減）。

---

## Phase 1: デッドコード削除（安全・即効果）
**削除行数見込み: ~4,200行 / 28ファイル**
**リスク: ゼロ**（どこからもimportされていない）

### MicroTask 1-1: 完全孤立ディレクトリ削除
```
rm -rf src/features/          # 1,062行 旧ai_council実装（handlers/council.tsに置換済み）
rm -rf src/services/           #   606行 predictive-task-generator, proactive-secretary
rm -rf src/scripts/            #   401行 calculate-coverage等スタンドアロン
rm -rf src/mesh/               #   270行 mesh-registry
```

### MicroTask 1-2: 孤立ファイル削除
```
rm src/handlers/imagine.ts          # 104行 旧imagine（media-commands.tsに置換済み）
rm src/handlers/gemini-tasks-sync.ts # 241行 未接続
rm src/utils/task-poller.ts          #  89行 旧poller（src/bin/に置換済み）
rm src/utils/croppy-integration.ts   #   4行 空スタブ
rm src/utils/croppy-approval.ts      #  13行 空スタブ
rm src/jobs/evening-review.ts        #  42行 未接続
rm src/jobs/morning-briefing.ts      #  42行 未接続
rm src/jobs/analyze-patterns.ts      #  72行 未接続
rm src/jobs/mesh-health-check.ts     #  50行 未接続
rm src/jobs/tower-watchdog.ts        # 308行 未接続
```

### MicroTask 1-3: 未コミットゴミ削除
```
rm scripts/gmail-fetch.py        # 未追跡
rm src/bin/task-poller.ts.bak    # バックアップ
rm src/tests/session-helper.test.ts  # 未追跡
```

### MicroTask 1-4: handlers/index.ts整理
handlePhoto exportを削除（index.tsにmessage:photo登録なし→dead）
routeDarwinCommand exportを削除（index.tsで未使用）

### 検証
- `bun run src/index.ts` 起動確認
- Telegramで /start, テキスト送信, /debate, /imagine 動作確認

---

## Phase 2: 機能疑問コード精査（DJ判断必要）
**対象: ~11,600行 / 42ファイル**

### MicroTask 2-1: DJ判断 — 残すか消すか

| 機能 | ファイル数 | 行数 | 状態 | 俺の推奨 |
|---|---|---|---|---|
| **src/autopilot/** | 22 | 7,219 | /autopilotコマンド登録済み、AUTOPILOT_ENABLED=falseで無効化中 | 🔴削除（未稼働、再実装の方が早い） |
| **src/meta-agent/** | 9 | 1,329 | /metaコマンド群登録済み | 🔴削除（型エラー多、未稼働） |
| **src/darwin/** | 8 | 2,309 | darwinコマンド群。ジョブ未接続 | 🔴削除（darwin-night.ts含め全て未接続） |
| **src/jobs/darwin-night.ts** | 1 | 814 | 未接続 | 🔴削除 |
| **src/jobs/autopilot-cron.ts** | 1 | 89 | 未接続 | 🔴削除 |
| **src/handlers/photo.ts** | 1 | 271 | index.tsに未登録 | 🔴削除 |
| **src/handlers/voice.ts** | 1 | 31 | OpenAI API依存で無効化中 | 🟡残す（将来ローカルWhisper化？） |
| **src/handlers/nightshift.ts** | 1 | 699 | /nightshift登録済み、Jarvis自律実行 | 🟡残す（Jarvis実装禁止ルールと矛盾するが機能自体は価値あり） |
| **src/handlers/auto-rules.ts** | 1 | 776 | commands.tsからparseAlarmMessageのみ使用 | 🟡parseAlarmMessageだけ残して残り削除 |
| **src/handlers/croppy-commands.ts** | 1 | 210 | handlers/index.tsからexport、auto-approval機能 | 🟡残す |
| **src/handlers/media-group.ts** | 1 | 222 | document.tsが使用中 | 🟢残す |

### MicroTask 2-2: DJ判断後の削除実行
DJ承認分を一括削除 + index.ts/handlers/index.tsからimport除去

### MicroTask 2-3: index.tsコマンド登録整理
削除した機能のbot.command()を除去。コマンドマップも整理

### 検証
- 起動確認 + 全残存コマンド動作テスト

---

## Phase 3: 型エラー修正（183個→0）
**対象: 主にテストファイルとtask/orchestrate.ts**

### MicroTask 3-1: 本番コード型エラー修正（優先）
```
src/task/orchestrate.ts          27個
src/task/tasklog-command.ts       5個
src/task/resource-limits.test.ts  9個
src/handlers/media-commands.ts    2個
src/bin/task-poller.ts            2個
```

### MicroTask 3-2: テスト型エラー修正
Phase 2の削除後に残ったテストファイルの型エラーを修正

### 検証
- `bun run typecheck` → エラー0

---

## Phase 4: テスト整理
**対象: 48ファイル / 15,353行**

### MicroTask 4-1: Phase 2で削除した機能のテスト削除
削除したモジュールに対応するテストを一括削除

### MicroTask 4-2: 残存テストの動作確認
- TELEGRAM_BOT_TOKEN未設定でクラッシュする問題修正（モック化）
- `bun test` 全パス確認

### 検証
- `bun test` → 全パス、0 fail

---

## Phase 5: 最終整理

### MicroTask 5-1: handlers/index.ts再構成
残存handlerのみexport。不要export削除

### MicroTask 5-2: config.ts整理
削除した機能のconfig参照を除去

### MicroTask 5-3: CLAUDE.md更新
削除したコマンド・機能の記述を除去

### MicroTask 5-4: git commit + push
```
git add -A
git commit -m "refactor: major cleanup - remove dead code, fix type errors"
```

### 検証
- 最終起動テスト
- Telegram全コマンド動作確認

---

## 実行順序と所要時間見込み

| Phase | 内容 | 見込み時間 | リスク |
|---|---|---|---|
| 1 | デッドコード削除 | 15分 | ゼロ |
| 2 | 機能疑問精査+削除 | 30分（DJ判断含む） | 低（git revertで戻せる） |
| 3 | 型エラー修正 | 45分 | 中（orchestrate.ts複雑） |
| 4 | テスト整理 | 30分 | 低 |
| 5 | 最終整理 | 15分 | 低 |
| **合計** | | **~2.5時間** | |

---

## 削減見込み

| 区分 | Before | After | 削減 |
|---|---|---|---|
| ファイル数 | 198 | ~120 | -78 |
| コード行数 | 54,181 | ~33,000 | -21,000 |
| 型エラー | 183 | 0 | -183 |
| デッドコード率 | 29% | 0% | -29% |
