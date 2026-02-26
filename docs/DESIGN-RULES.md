# 設計ルール（クロッピー🦞 必読）
**最終更新:** 2026-02-26

---

## 0. 最重要原則

### DJの大原則
**「Telegramへの最初の投稿以外は何もしない」**
→ すべての設計判断はこの原則に照らして評価する。手動ステップが増える設計は却下。

### クロッピーの約束
問題が起きたら「なぜ？」を3回繰り返す。表面的な修正ではなく根本原因を特定する。「これで本当に直るか？」を自問する。分からなければ「分からない、もう少し考える」と言う。

### 従量課金API使用は絶対禁止
ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY を直接使わない。全AI呼び出しはCLI経由（Max/Pro/Proサブスク範囲内）。4層防御（コード/env/npm/husky）で封鎖済み。

---

## 1. ディベート・設計

### ディベート中
- 各ラウンドで収束した項目に [DECIDED] をつけて docs/{feature}-spec.md に保存
- 次ラウンドの評価者には「DECIDED項目は議論対象外」と明示
- **却下した案とその理由も記録**（消えやすいので最重要）

### ディベート完了時
- 最終仕様書を docs/{feature}-spec.md として保存
- 含める内容: 投票結果、採用設計+理由、却下案+理由、Phase状態と次Phase条件

### 実装着手前
- 仕様書にフェーズ分割 + ファイル責務 + 主要機能一覧まで仕上げる
- MicroTask詳細は各フェーズ着手時に作る（事前完全分割は不要）
- **DESIGN-RULES.md（この文書）を必ず読む。読まずに着手は絶対禁止**

---

## 2. 実装ルール

### コード品質
- **コードを書き出す時は必ず時間をかけて深く綿密に考えてから書く。急がない**
- 安易な結論を出さない — 前提を疑い、反論も含めて段階的に深く考える
- 冪等性チェック必須 — パッチ・スクリプトは2回実行で壊れないように

### 実装方式（Croppy-Driven Architecture）
- **🦞が設計+コード → DJコピペ → Jarvisはテスト/git/再起動のみ**
- Jarvis単独実装は禁止（ハングループする）
- 重いタスク = 🦞 → Claude Code spawn（/code or exec bridge --fire）
- 軽いタスク = Telegram → Jarvis（既存ハンドラ）

### Jarvisへの指示テンプレート
```
[JARVIS TASK]
Goal: （1文で）
Context: （背景）
Deliverables: patch + commands + checklist
Exec: propose
Stop: Deliverablesが揃ったら終了
```
- Jarvisへの指示で「完璧」と言わない — 必ず ①コード実装 ②全パターンをテスト ③結果報告 を含める

### コマンド提供
- コマンドは1つにまとめてコピペしやすく — 複数行に分けない
- 問題が発生したら先回りして解決策を提示 — DJに確認を求めず自分で判断
- exec bridgeのツール呼び出しを効率化 — 1回のexecで複数確認をまとめる

---

## 3. フェーズ分割のルール

### ❌ やってはいけない
- 「最小構成で始めて徐々に広げる」→ Phase 1で終わる。Phase 2以降は永遠に来ない

### ✅ 正しいやり方
- **一気に実装 + フォールバック設計**
- 各機能を独立させて、1つ失敗しても他が動く構造にする
- 外部依存（他のハンドラ追加が必要等）がある部分だけ後回し
- フェーズ分割するなら「なぜ分けるのか」の具体的理由が必須

---

## 4. 実装完了後

### 必ず更新する3箇所
1. `docs/FEATURE-CATALOG.md` — 機能一覧（忘れた機能は存在しない）
2. `croppy-notes.md` (Dropbox) — セッション記録
3. `DESIGN-RULES.md` (この文書) — 新しい教訓があれば追記

**Auto Memory自動同期:** Claude Code Stop hook (auto-memory-sync.py) がセッション終了時に以下を自動更新:
- memory/task-state.md ← WIP.md + git status
- memory/lessons.md ← DESIGN-RULES §8
- memory/architecture.md ← FEATURE-CATALOG + 既存決定
- HANDOFF廃止済み（2026-02-26）。Auto Memoryが代替。

### テスト・確認
- スモークテスト/実戦テスト結果を仕様書に追記
- 機能が完全に安定稼働したら仕様書削除（git履歴に残る）

### Git
- コミットメッセージは`feat:` / `fix:` / `docs:` プレフィックス
- `--no-verify` はLayer 2自動コミット専用、通常コミットでは使わない
- `.husky/_/pre-commit` でBANNEDキーワードチェック + bun test が走る

---

## 5. exec bridge運用

### 基本パターン
- 同期（結果待ち）: `bash exec.sh "command"`
- 非同期（即戻り）: `bash exec.sh --fire "command"`
- 非同期+通知: `bash exec.sh --fire --notify "command"`
- 結果確認: `bash exec.sh --check task_id`

### 30秒超のコマンド
- `--fire --notify` を使う（claude.aiセッション死亡でも作業継続）
- Claude Code spawn は必ず `--fire` + nohup

### Gateway APIフィールド名（ハマりポイント）
- `d.task.result_stdout` であって `d.stdout` ではない
- submitのレスポンスは `task_id` フィールド

### Chromeセキュリティフィルター回避
- コード内容・base64・hexを含むstdoutはブロックされる
- `sed "s/[^a-zA-Z0-9 .:_,=-]/ /g"` でサニタイズすれば回避可能

---

## 6. パッチ適用のベストプラクティス

1. **Pythonスクリプトとして作成** → base64転送 → `python3 script.py` で実行
2. heredoc方式は**日本語・バッククォートが無い場合のみ**使用可
3. 文字列マッチ方式が最も安全（行ズレリスクなし）
4. **冪等性チェック必須** — 2回実行で壊れないように
5. base64転送パターン: `echo 'B64...' | base64 -d > file.py && python3 file.py`

### DJのダウンロードパス
```
~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/
```

---

## 7. プロセス管理

### launchd設計原則
- crash → exit(1) → launchd自動再起動
- safe-mode（エラー上限） → exit(0) → 停止（再起動なし）
- SIGTERM → cleanup → exit(0) → graceful stop

### 停止フラグ
| フラグ | 対象 |
|--------|------|
| `/tmp/croppy-stop` | クロッピーのexec bridgeループ |
| `/tmp/autokick-stop` | Auto-Kick Watchdog |
| `/tmp/jarvis-scout-stop` | Scout Agent |
| `/tmp/jarvis-nightly-stop` | Nightly Ralph Loop |

### Auto-Kick + M1.md連携
- M1.md STATUS=DONE/IDLE → watchdog自動disarm（無限ループ防止）
- croppy-start.sh もM1.md確認 → DONE/IDLEならarm skip

---

## 8. 蓄積された教訓

### インフラ
- `core.hooksPath=.husky/_` が設定されていると `.git/hooks/` は完全に無視される
- Jarvisのログ報告は信用できない → M1ターミナルでDJ直接grep
- Bunのspawn timeout は Node.js と挙動が異なる
- `claude -p` は非対話環境でパーミッション確認ハング → `--dangerously-skip-permissions` 必須
- Poller子プロセスでclaude -p → メモリ圧迫SIGTERM → nohupで独立プロセス化が正解
- launchctl load/unload state がPoller死の根本原因だった
- crontab は exec bridge 経由で使えない（TCC権限） → LaunchAgent一択

### AI関連
- ChatGPT Shortcuts: 毎回新チャット、`continuous=true`はCLI自動化で使えない
- ChatGPT Pro: レート制限に達すると3週間Proモデル使用不可
- Gemini CLI: 引数方式で失敗 → stdin方式に変更
- detectWorkMode()のconfidenceは不安定 → キーワードマッチが確実

### Gateway
- Gateway cleanup: ISO日付とSQLite datetime()は比較不可 → replace('T',' ')で正規化
- `~/.claude/settings.json` の deny: `Bash(rm -rf /:**)` は無効 → `Bash(rm -rf /*)` に修正
- memory-gateway は ~/memory-gateway/ にある（claude-telegram-bot内ではない）

### メディア
- outpaint の edge-mirror fill → 平均色+ノイズfill に変更
- withMediaQueue() で重いAI処理を直列化（同時実行=メモリ圧迫SIGTERM）
- patch-queue.py は冪等ではない（2回実行で重複宣言エラー）

### mdb-tools (Access DB)
- bash直接だと日本語テーブル名で失敗 → Python subprocess経由なら動く
- `mdb-export` + csv.DictReader で構造化データ取得

---

## 9. 自律ループ（Plan D）運用

### M1.md状態遷移
```
IDLE → RUNNING → DONE/FAILED/WAITING
```
- RUNNING: ループ実行中（Auto-Kick復帰時は即再開）
- DONE: 全タスク完了（watchdog disarm対象）
- WAITING: DJ判断待ち（手動介入が必要）
- FAILED: MAX_RETRIES超過

### 安全装置
- /tmp/croppy-stop: 即停止
- MAX_RETRIES: 3（同一ステップ3回失敗→FAILED）
- MAX_STEPS: 10
- TIMEOUT: 60min/step

---

## 10. Scout Agent運用

### スキャン範囲（全部入り）
1. コード健康（TypeScript/テストカバレッジ/未使用export/git変更）
2. ビジネスデータ（Access DB: 見積書/プロジェクト/受注）
3. システム監視（ディスク/メモリ/プロセス/Poller/Nightly）
4. ドキュメント鮮度（FEATURE-CATALOG/DESIGN-RULES/HANDOFF/croppy-notes）
5. 日報サマリ（git/テスト/Journal）

### 原則
- 各セクション独立実行（1つ失敗しても他は続行）
- 推奨アクションは自動実行可能なものだけ提案
- launchd: 毎朝 02:30 (com.jarvis.scout)
- Phase 2: /scout N → 推奨アクション即実行（actions.json経由）
- Phase 3: SAFE:trueアクションは自動実行→Telegram通知のみ
- CMD:タグ: 推奨アクションにシェルコマンド付与、SAFE:true/falseで安全性分類
- 🤖バッジ=自動実行、👤バッジ=手動実行
### 通知・フック
- Claude Code Stop hook通知が重複する → /tmp にlast-commit+timestampで30秒dedup
- hookifyプラグインは直接通知しない。croppy-done.sh(プロジェクト)とsession-end-notify.sh(グローバル)が別々に通知
- 複数Claude Codeセッション同時終了 → 同じコミットを複数回通知する問題

### Gateway/Poller
- exec bridgeデフォルト300秒 < Scout内部600秒 → 長いタスクは --fire --notify + 直接実行
- Pollerリスタート時に実行中タスクがorphaned(永久running) → cleanup APIが未実装の既知問題
- withMediaQueueパッチで/edit SIGTERMは解決済み（DJ実使用確認）

