# FEATURE-CATALOG.md 監査レポート

**監査日:** 2026-02-17
**対象:** docs/FEATURE-CATALOG.md 全19セクション
**方法:** 各セクションの記載内容を実コード・設定ファイルと突合

---

## 凡例

| 記号 | 意味 |
|------|------|
| ✅ | 正確。コードと一致 |
| ⚠️ | 軽微な不正確・不足あり |
| ❌ | 誤りまたは重大な不足 |

---

## 1. /debate → council.ts ✅

- **正確性:** `src/handlers/council.ts` に `handleDebate`, `handleAskGPT`, `handleAskGemini` がある
- **登録:** `src/index.ts` L203 で `bot.command("debate", handleDebate)` 登録済み
- **不足情報:** 3ラウンド構成（生成→批評→統合）、Web検索enrichment、10分タイムアウト等の詳細がカタログに未記載。ただし一覧としては妥当

## 2. /ai {claude|gemini|gpt|end|status} → ai-session.ts, session-bridge.ts ✅

- **正確性:** `src/handlers/ai-session.ts` + `src/utils/session-bridge.ts` に実装
- **登録:** `src/index.ts` L208 で登録済み
- **不足情報なし**

## 3. /imagine → mflux (Z-Image-Turbo 8bit) ⚠️

- **正確性:** `handleImagine()` は `ai-media.py generate` を呼ぶ。mflux/Z-Image-Turbo使用は正しい
- **不正確:** カタログに「8bit」とあるが、コード上は `ai-media.py` に引数で渡しており、ハンドラ側では明示的に8bitを指定していない。実際のモデル設定は `ai-media.py` 内部に依存
- **不足情報:** 25分タイムアウト、写真+ドキュメント両送信パターンが未記載

## 4. /edit → ComfyUI+FLUX Kontext Dev Q5 GGUF ⚠️

- **正確性:** FLUX Kontext Edit使用は正しい。ComfyUI経由も正しい
- **不正確:** カタログに「--engine dev|fill selectable」とあるが、実コードでは `--engine kontext|dev|fill` の3択。`kontext` が漏れている
- **不足情報:** `--denoise`, `--face-mask`, `--face-protect`, `--expand`, `--guidance`, `--nsfw`, `--neg`, `--pos` オプション群、ローカルパスプライバシーモード、25分タイムアウトが未記載

## 5. /outpaint → ComfyUI+FLUX.1Dev ✅

- **正確性:** FLUX Dev outpaint使用。コードのステータスメッセージに "FLUX Dev outpaint" とある
- **不足情報:** `--direction`, `--expand`, `--denoise`, `--feathering`, `--neg` オプション、プライバシーモード、45分タイムアウトが未記載

## 6. /animate → Wan2.2 TI2V-5B ✅

- **正確性:** Wan2.2使用。121フレーム@8fps（約15秒）
- **不足情報:** テキスト→動画モードと画像→動画モードの2モード、45分タイムアウト、GIF/動画出力切替が未記載

## 7. Orchestrator → orchestrate.ts, 6layer safety ✅

- **正確性:** `src/task/orchestrate.ts` (641行) に完全実装。6層安全検証は `validator.ts` で確認済み:
  1. ファイル数制限
  2. 禁止ファイル検出
  3. Bannedパターン検出
  4. AST import解析
  5. テストファイル行数チェック
  6. テスト実行必須
- **TaskPlan JSON:** `src/task/types.ts` で `TaskPlan` / `MicroTask` インターフェース定義済み
- **不足情報:** git worktree分離、PID排他ロック、SIGTERM→SIGKILL段階的停止、連続失敗停止（2回）等のメカニズムが未記載

## 8. ExecBridge → exec.sh+task-poller.ts+gateway ⚠️

- **不正確:** カタログに「exec.sh」とあるが、該当ファイルは存在しない。exec bridgeはGateway API（`/v1/exec/submit`, `/v1/exec/poll`, `/v1/exec/complete`）+ task-poller.ts の組み合わせで実装されている
- **正確:** `src/bin/task-poller.ts` は存在し、Memory Gateway (CF Worker) も稼働中
- **不足情報:** ポーリング間隔（idle: 10s, active: 1s）、80KB出力上限、ENOENT 3リトライ、セーフモード（10エラー/10分→exit）が未記載

## 9. MediaQueue → withMediaQueue() in media-commands.ts ✅

- **正確性:** `src/handlers/media-commands.ts` L21-35 に `withMediaQueue()` 定義済み
- **実装:** シングルフラグ + FIFOキュー。メモリ圧迫下のSIGTERM防止目的
- **不足情報なし**

## 10. Layer2Memory → /ai end → CLAUDE.md SESSION_STATE auto-update+git commit ✅

- **正確性:** `ai-session.ts` L152-154 で `/ai end` 時に `saveSessionState()` → `session-bridge.ts` L169-206 で SESSION_STATE ブロック書き換え + git commit
- **不足情報なし**

## 11. API block → 4layer(code/env/npm/husky) ✅

- **正確性:** 全4層確認済み:
  1. **Code:** SDK import なし、API key 直接使用なし
  2. **Env:** `.env` に従量課金キーなし
  3. **npm:** `package.json` に `@anthropic-ai/sdk`, `openai` なし
  4. **Husky:** `.husky/pre-commit` で従量課金系APIキー名・SDKパッケージ名をgrep検出→コミット拒否
- **不足情報なし**

## 12. Journal → nightly 23:55 auto-gen to Dropbox ⚠️

- **正確性:** `scripts/generate-journal.sh` が存在し、Dropboxへ出力
- **不正確:** カタログに「23:55」とあるが、スケジュールはLaunchAgentで管理。実際の時刻は plist で定義されるため、コード側からは確認不可。`jarvis-nightly.sh` (23:00) との混同の可能性あり
- **不足情報:** croppy-notes.mdマージ、git活動ログ、ブランチ状態等の内容詳細が未記載

## 13. FocusMode → /focus on|off ✅

- **正確性:** `src/utils/focus-mode.ts` に実装。通知バッファリング + 一括配信
- **登録:** `src/handlers/commands.ts` からインポート
- **DB:** Memory Gateway SQLite `focus_mode_buffer` テーブル
- **不足情報なし**

## 14. Metrics → bun:sqlite, /status shows P50/P99 ✅

- **正確性:** `src/utils/metrics.ts` で bun:sqlite 使用。`~/.claude-telegram-metrics.db`
- **フィールド:** `enrichment_ms`, `context_fetch_ms`, `claude_latency_ms`, `total_ms`, `context_size_chars`, `tool_count`
- **公開:** `formatMetricsForStatus()` → `/status` で表示
- **不足情報なし**

## 15. BgTaskManager → fire-and-forget with retry+tracking ✅

- **正確性:** `src/utils/bg-task-manager.ts` に `runBgTask()` 実装
- **リトライ:** maxRetries=2、指数バックオフ（baseMs=1000）
- **追跡:** メモリ保持（最大100タスク）、`getBgTaskSummary()` でステータス公開
- **不足情報なし**

## 16. ContextSwitcher → SmartRouter+ToolPreload+FocusMode ⚠️

- **不正確:** 「SmartRouter」という名前のモジュールは存在しない。実際は `src/handlers/ai-router.ts` の `parseRoutePrefix()` がプレフィックスルーティングを担当
- **不正確:** 「ToolPreload」という名前のモジュールは存在しない。実際は `src/utils/context-detector.ts` の `DetectionResult` + 6ワークモード（coding/debugging/planning/research/urgent等）がコンテキスト検出を担当
- **FocusMode:** 正確（上記 #13）
- **推奨:** カタログの記載名を実モジュール名に合わせるべき

## 17. EmergencyStop → touch /tmp/croppy-stop ⚠️

- **正確性:** 仕様として `/tmp/croppy-stop` は定義されている
- **注意:** Jarvis botコード (`src/**/*.ts`) 内にはこのファイルを参照するコードがない。Auto-Kick Watchdog (`auto-kick-watchdog.sh`) 内で `/tmp/autokick-stop` をチェックしているが、`/tmp/croppy-stop` は Croppy自律ループ（Plan D）側の責務であり、まだ未実装（設計フェーズ）
- **不足情報:** 現時点では設計のみで実装されていない旨を明記すべき

## 18. /code → code-command.ts ✅

- **正確性:** `src/handlers/code-command.ts` に実装
- **実装:** `nohup claude -p --dangerously-skip-permissions` → `/tmp/claude-code-output.log`
- **PID返却:** 確認済み
- **不足情報なし**

## 19. CroppyLoop(PlanD) → M1.md状態永続化+Auto-Kick復帰 ✅

- **正確性:** `docs/croppy-loop-spec.md` に設計仕様あり。Plan D全員一致採用
- **状態:** 設計フェーズ（未実装）— カタログの記載と一致
- **不足情報なし**

---

## 追加セクション監査

### Auto-Kick Watchdog ✅

- **正確性:** `scripts/auto-kick-watchdog.sh` 存在。20秒間隔、2回連続=40秒、osascript+Chrome JS、LaunchAgent `com.jarvis.autokick-watchdog`
- **制御:** ARM: `/tmp/autokick-armed`, STOP: `/tmp/autokick-stop` — 全て正確
- **不足情報なし**

### Autonomous Workflow v3.2 ✅

- **正確性:** `docs/autonomous-workflow-spec.md` 存在。B案（🦞直接+Auto-Kick）
- **不足情報なし**

### HANDOFF自動化 (Phase 1-4) ✅

- **正確性:** 全コンポーネント確認済み:
  - Auto Memory ✅ (`~/.claude/projects/.../memory/`)
  - Stop hook (auto-handoff.py → Dropbox + croppy-done.sh → Telegram) ✅
  - PreCompact hook (pre-compact.sh) ✅
  - Agent Teams設定 ✅
  - Master-Clone委譲 ✅
- **不足情報なし**

### Poller Watchdog (3-layer) ✅

- **正確性:** `com.jarvis.poller-watchdog` LaunchAgent + `scripts/poller-watchdog.sh` 確認済み
- **3層:** SIGTERM→launchd再起動 / heartbeat / watchdog — 全て正確
- **不足情報なし**

### Claude Code Hooks ✅

- **正確性:** `.claude/settings.json` に SessionStart/Stop/PreCompact 全フック定義済み
- **不足情報なし**

### Gateway Cleanup Endpoint ✅

- **正確性:** Memory Gateway Worker に実装（外部リポジトリ）
- **不足情報なし**

### JARVIS v2 Croppy-Driven Architecture ✅

- **正確性:** `docs/jarvis-v2-spec.md` 存在。2レーン設計、fire-and-forget原則
- **不足情報なし**

---

## 総合サマリー

| 状態 | セクション数 | 割合 |
|------|-------------|------|
| ✅ 正確 | 20 | 74% |
| ⚠️ 軽微な不正確/不足 | 7 | 26% |
| ❌ 重大な誤り | 0 | 0% |

### 要修正項目（優先度順）

| # | セクション | 問題 | 推奨アクション |
|---|-----------|------|---------------|
| 1 | ExecBridge | `exec.sh` は存在しない | 「exec.sh」→「Gateway API + task-poller.ts」に修正 |
| 2 | /edit | `--engine dev\|fill` は不完全 | `--engine kontext\|dev\|fill` に修正 |
| 3 | ContextSwitcher | SmartRouter/ToolPreloadは架空の名前 | `ai-router.ts` / `context-detector.ts` に修正 |
| 4 | EmergencyStop | `/tmp/croppy-stop` は未実装 | 「設計のみ、Plan D実装待ち」を追記 |
| 5 | Journal | 23:55の時刻が未検証 | LaunchAgent plistと突合して確認 |
| 6 | /imagine | 「8bit」はハンドラ側で明示されない | ai-media.py内部設定である旨を注記 |
| 7 | 各メディアコマンド | オプション・タイムアウト未記載 | 必要に応じて詳細追記 |
