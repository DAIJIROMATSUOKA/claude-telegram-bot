/debate -> council.ts
/ai {claude|gemini|gpt|end|status} -> ai-session.ts, session-bridge.ts
/imagine -> mflux (Z-Image-Turbo 8bit)
/edit -> ComfyUI+FLUX Kontext Dev Q5 GGUF (default), --engine dev|fill selectable
/outpaint -> ComfyUI+FLUX.1Dev
/animate -> Wan2.2 TI2V-5B
Orchestrator -> orchestrate.ts, 6layer safety, 6/6 stable, TaskPlan JSON->autonomous exec
ExecBridge -> exec.sh+task-poller.ts+gateway(CF Worker)
MediaQueue -> withMediaQueue() in media-commands.ts
Layer2Memory -> /ai end->CLAUDE.md SESSION_STATE auto-update+git commit
API block -> 4layer(code/env/npm/husky)
Journal -> nightly 23:55 auto-gen to Dropbox
FocusMode -> /focus on|off, buffers notifications
Metrics -> bun:sqlite, /status shows P50/P99 latency
BgTaskManager -> fire-and-forget with retry+tracking
ContextSwitcher -> SmartRouter+ToolPreload+FocusMode
EmergencyStop -> touch /tmp/croppy-stop
/code -> code-command.ts, nohup Claude Code spawn from Telegram
CroppyLoop(PlanD) -> M1.md状態永続化+Auto-Kick復帰、🦞自律spawn→検証→再spawnループ

## /code（Telegram直通 Claude Code）
- **状態:** ✅ 本番稼働中
- **ハンドラー:** src/handlers/code-command.ts
- **仕組み:** `/code <task>` → nohup で Claude Code を独立プロセスとして spawn（`claude -p --dangerously-skip-permissions`）→ Stop hook が完了時に Telegram 通知
- **特徴:** SIGTERM カスケード防止（nohup）、Bot プロセスから完全独立、PID を返してユーザーに通知
- **出力:** /tmp/claude-code-output.log
- **Commit:** d33649c

## Auto-Kick Watchdog（自動復帰ウォッチドッグ）
- **状態:** ✅ 本番稼働中
- **LaunchAgent:** com.jarvis.autokick-watchdog
- **スクリプト:** scripts/auto-kick-watchdog.sh
- **仕組み:** claude.aiの応答停止を検知（20秒間隔、2回連続=40秒）→ osascript+Chrome JSで自動入力+送信 → 同一コンテキストで再開
- **制御:** ARM: touch /tmp/autokick-armed / DISARM: rm / STOP: touch /tmp/autokick-stop
- **通知:** キック時にTelegram通知
- **設計思想:** DJ介入ゼロでクロッピー🦞が自律的に長時間作業を継続可能に
- **PoC日:** 2026-02-15

## Autonomous Workflow v3.2
- **状態:** 設計完了、Phase 1実装中
- **仕様書:** docs/autonomous-workflow-spec.md
- **アーキテクチャ:** B案（🦞直接作業 + Auto-Kick）。Jarvis実装委譲は不要に。
- **ディベート:** ChatGPT/Gemini/🦞 全員一致でB案採用
- **ツール:** poll_job.sh, autonomous/state/M1.md

## HANDOFF自動化 (Phase 1-4 完了 2026-02-15)
- Auto Memory: ~/.claude/projects/.../memory/ (MEMORY.md + 3 topic files)
- memory-sync.sh: 5min cron → croppy-notes.md backup
- Stop hook: auto-handoff.py → Dropbox Journal + Telegram通知
- Nightly: jarvis-nightly.sh (launchd 23:00) Ralph Loop方式 → 全タスク完了/停止条件まで自律ループ (circuit breaker=3連続失敗, max 4h)
- Agent Teams: ~/.claude/settings.json で有効化済み (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1) — 並列エージェント協調
- PreCompact Hook: 圧縮前にtranscriptバックアップ + last-compaction.md保存 + Telegram通知- SessionStart:compact Hook: 圧縮後にlast-compaction.mdを自動復元 → 保存→復元の完全ループ
- Stop Self-Validation: コード変更時にbun test+BANNEDチェック自動実行 → 失敗ならClaudeに修正を強制(max 3回)
- Master-Clone委譲: CLAUDE.mdに方針記述 → Claude Codeが自分でTask/Exploreに動的委譲(specialist定義不要)
- Phase 5 (exec bridge廃止) はDEFERRED


## Poller Watchdog (3-layer) (2026-02-16)
- Status: DEPLOYED + self-bootstrap verified
- Layer1: SIGTERM exit(143) -> launchd auto-restart
- Layer2: heartbeat (/tmp/poller-heartbeat) written every poll cycle
- Layer3: com.jarvis.poller-watchdog (LaunchAgent, 60s) checks freshness+process -> auto-restart+Telegram
- Coverage: SIGTERM/plist unload/process hang/Gateway unreachable/watchdog death
- Spec: docs/poller-watchdog-spec.md
- Commits: 107cb88, 534363b

## Claude Code Hooks (2026-02-16)
- Status: DEPLOYED
- Config: .claude/settings.json (project-level)
- SessionStart -> croppy-start.sh (autokick ARM)
- Stop -> auto-handoff.py (Journal) + croppy-done.sh (Telegram)
- PreCompact -> pre-compact.sh (transcript backup)
- Commit: d419fe1

## Gateway Cleanup Endpoint (2026-02-16)
- Status: DEPLOYED
- API: POST /v1/exec/cleanup {stuck_minutes?, purge_hours?}
- running>10min -> pending, done>24h -> delete
- Worker Version: 5c92fe60

### JARVIS v2 Croppy-Driven Architecture（2026-02-16 DECIDED）
- **概要:** 🦞(claude.ai)が設計→exec bridge --fire→Claude Code自律実行→Stop hook→Telegram通知
- **2レーン:** 重いタスク=🦞→Claude Code、軽いタスク=Telegram→Jarvis（既存）
- **原則:** 🦞はfire-and-forget。Jarvisは判断ゼロ。障害点は🦞かClaude Codeの2択のみ
- **仕様書:** docs/jarvis-v2-spec.md

## Croppy自律ループ (Plan D)（2026-02-17 DECIDED）
- **状態:** ディベート完了 → 設計フェーズ（案D全員一致採用）
- **仕様書:** docs/croppy-loop-spec.md
- **概要:** DJの1行指示 → 🦞が計画策定 → Claude Codeをspawn → 結果検証 → 次ステップspawn のループを自律実行
- **状態永続化:** autonomous/state/M1.md にSTATUS/GOAL/PLAN/CURRENT/RESULTSを記録。🦞が死んでも状態が残る
- **M1.mdフォーマット:** STATUS(IDLE/RUNNING/WAITING/DONE/FAILED)、STEPS(各ステップの状態+結果)、CURRENT(実行中タスクID/PID)、NEXT_ACTION
- **Auto-Kick復帰:** 🦞死亡 → Auto-Kick復帰 → M1.md読む → STATUS:RUNNINGならループ再開（実行中タスクの--check/結果検証/再spawnを自動判断）
- **ループフロー:** Phase1(計画策定) → Phase2(exec bridge --fire → --checkポーリング → 検証 → STEP++) → Phase3(全完了→通知) → Phase4(障害復帰)
- **安全装置:** /tmp/croppy-stop(即停止)、MAX_RETRIES:3(同一ステップ3回失敗→FAILED)、MAX_STEPS:10、TIMEOUT:60min/step、STATUS:WAITING(DJ判断待ち)
- **変更不要（既存活用）:** exec bridge, Auto-Kick Watchdog, M1.md, Claude Code nohupパターン, /tmp/croppy-stop
- **却下案:** A(exec bridgeのみ→復帰不可), B(M1オーケストレータ→🦞品質管理喪失), C(ワンショット→検証不可)

## iPhone Remote (Tailscale SSH) (2026-02-22)
- **状態:** セットアップ完了・動作確認済み
- **仕様書:** docs/iphone-remote-spec.md
- **構成:** Tailscale SSH + Termius スニペット
- **位置づけ:** Poller/Watchdog全滅時の最終保険。日常運用ではない
- **ディベート:** VNC却下(モバイル非実用的)、超軽量Bot却下(複雑性増大)

## Croppy Dispatch Commands (scripts/croppy-dispatch.sh)
| コマンド | 用途 | テスト |
|---------|------|-----
### Scout Phase 2（/scout N）
- **コマンド:** `/scout` → 推奨アクション一覧、`/scout N` → アクションN実行
- **仕組み:** scout-agent.shが推奨アクションから`CMD:`タグ抽出→actions.json保存→JARVISハンドラが実行
- **ファイル:** src/handlers/scout-command.ts, scripts/scout-agent.sh, scripts/scout-scan.md
- **コミット:** 0470cec (2026-02-26)
- **安全策:** 破壊的コマンド(rm,reset等)はscan promptで明示禁止

---|
| `/alarm` | iPhoneアラーム | ✅ |
| `/timer` | タスク時間計測 | ✅ |
| `/status` | システム状態 | ✅ |
| `/git` | Git操作 | ✅ |
| `/restart` | Bot再起動 | ✅ |
| `/gpt` | ChatGPTに質問 | ⚠️ Pro制限中 |
| `/gem` | Geminiに質問 | ✅ |
| `/debate` | 3AI評議会 | 未テスト（/gptが制限中） |
| `/todoist` | タスク管理(list/add/done/reschedule) | ✅ v1 API |
| `/help` | 一覧表示 | ✅ |

メモリ1枠、コマンド10個。追加はM1の`scripts/croppy-dispatch.sh`にcase足すだけ。

## X (Twitter) Search Fetcher (2026-02-26)
- **Status:** DEPLOYED
- **Script:** scripts/x-fetch.py
- **Usage:** python3 scripts/x-fetch.py 'search query' [max_tweets]
- **How:** AppleScript -> Chrome (DJ's logged-in session) -> JS DOM extraction -> auto-close tab
- **No API keys needed.** Uses existing Premium Plus session. Zero additional cost.
- **MCP:** chrome-devtools MCP also registered in Claude Code (for future Chrome debug port usage)
- **Queries tested:** Claude Code OR OpenClaw, Claude Code hooks worktree agent

## Scout Agent - 全方位スキャン (2026-02-26)
- **Status:** DEPLOYED (daily 06:30)
- **LaunchAgent:** com.jarvis.scout
- **Scripts:** scripts/scout-agent.sh + scripts/scout-scan.md
- **Spec:** docs/scout-agent-spec.md
- **スキャン範囲（全部入り）:**
  1. コード健康（TypeScript/テストカバレッジ/未使用export/git変更）
  2. ビジネスデータ（Access DB: 見積書/プロジェクト/受注 via mdb-tools+Python）
  3. システム監視（ディスク/メモリ/プロセス/Poller/Nightly）
  4. ドキュメント鮮度（FEATURE-CATALOG/DESIGN-RULES/HANDOFF/croppy-notes）
  5. 日報サマリ（git/テスト/Journal）
- **出力:** Telegram通知 + /tmp/jarvis-scout/latest-report.txt
- **設計:** 各セクション独立実行（1つ失敗しても他は続行）、Claude Code Max 10min timeout
- **停止:** touch /tmp/jarvis-scout-stop
- **Commits:** d40f1bf, e1aa052

## Auto-HANDOFF docs/保存 + Dedup (2026-02-26)
- **Status:** DEPLOYED
- **Script:** scripts/auto-handoff.py (Stop hook)
- **改修内容:**
  - docs/HANDOFF_{date}.md に上書き保存を追加（最新セッションが勝つ）
  - 2層デデュプ: タイムスタンプ(5秒)チェック + fcntl.flock排他ロック
  - Agent Teams重複実行を完全防止（以前は毎回2重実行されていた）
- **Commits:** b55329e, 6b619bc

## Husky pre-commit docs/除外 (2026-02-26)
- **Status:** DEPLOYED
- **.husky/pre-commit:** docs/* をBANNEDキーワードチェックから除外
- **理由:** DESIGN-RULES.mdにAPI_KEY名を記載するとコミット拒否されていた
- **Commit:** a007c5b

## DESIGN-RULES.md 包括的更新 (2026-02-26)
- **Status:** 6行→223行に拡充
- **追加セクション:** 最重要原則/実装ルール/フェーズ分割/exec bridge運用/パッチ適用/プロセス管理/蓄積された教訓/自律ループ/Scout運用
- **Commit:** 2211641

### Scout Phase 3（SAFE:自動実行）
- **仕組み:** Scout reportのSAFE:trueアクションをDJ承認なしで自動実行
- **通知:** 実行結果をTelegram '🤖 Scout自動実行' で送信
- **安全基準:** 読取専用・サービス起動・冪等操作のみSAFE:true
- **表示:** /scoutで🤖(自動)と👤(手動)バッジ
- **コミット:** 41bcd00 (2026-02-26)

## /manual - Claude Code自律マニュアル生成 (2026-02-28)
- **Status:** DEPLOYED
- **Handler:** src/handlers/manual-command.ts (140行)
- **使い方:** `/manual M1308 ベーコン原木をハーフカットする装置`
- **説明省略可:** `/manual M1308` → 装置概要.txt or フォルダ名から自動推測
- **3フェーズ自律実行:**
  1. collect-materials.py (部品表/ニモニック/電装図/画像収集)
  2. Claude CLI -p --model opus (AI生成)
  3. generate-docx.cjs (Markdown→Docx変換)
- **設計:** nohup独立プロセス (/codeパターン踏襲)、Stop hook通知
- **ログ:** /tmp/claude-code-manual-{番号}.log
- **出力:** Dropbox/M{番号}_*/M{番号}_取扱説明書.docx
- **Commit:** 33bd67e

## Obsidian CLI Phase 2 - Vault統合 + 文脈ブリーフィング (2026-03-02)
- **Status:** DEPLOYED
- **3AI Council決定:** Claude×Gemini×ChatGPT全員一致
- **ファイル配置:**
  - M1.md → 変更なし (高頻度書換のためiCloud不可)
  - WIP.md → MyObsidian/90_System/JARVIS/WIP.md (symlink互換)
  - JARVIS-Journal → MyObsidian/90_System/JARVIS/Journal/ (33ファイル移行)
- **文脈ブリーフィング:** dj-ops-briefing.sh が過去3日のdaily noteを読んで文脈注入
- **更新スクリプト:** auto-handoff.py, generate-journal.sh, auto-memory-sync.py, pre-compact-hook.py, scout-scan.md
- **Spec:** docs/obsidian-cli-phase2-spec.md
- **Phase 3 (Inbox自動実行ループ):** 未実装。00_Inbox/jarvis.md → 5分ポーリング → 実行


## claude.ai Chat Management via Telegram (2026-03-10 LIVE)
- **状態:** 稼働中
- **コマンド:**
  - `/chat <msg>` → 新規チャット作成（JarvisプロジェクトURL）→ inject → タイトル取得 → Telegram返信
  - `/post <name> <msg>` → タイトル部分一致検索 → inject
  - `/chats` → 全claude.aiタブ一覧（W:T + タイトル）
  - `/workers setup N` → N個のJ-WORKERタブ開設 + config更新
- **リプライルーティング:** /chatのTelegram通知にリプライ → 同チャットにinject（チェーン対応）
- **永続化:** /tmp/croppy-chat-map.json（msgId→chatTitle）、Jarvis再起動後も維持
- **タイトル取得:** 3s×10回ポーリング、30sタイムアウト→Chat-HHMMSS
- **ファイル:** src/handlers/claude-chat.ts（新規）、croppy-tab-manager.sh（new-chat/inject-by-title/setup-workers追加）、text.ts、index.ts、croppy-bridge.ts

## Jarvis→Croppy Bridge（夜間現場監督）(2026-03-04 DECIDED)
- **状態:** 仕様書完了、PoC全テスト合格
- **仕様書:** docs/jarvis-croppy-bridge-spec.md
- **PoC:** 2タブ同時応答✅、E2E双方向通信✅
- **概要:** Jarvisがosascript→Chrome JS経由でclaude.aiの🦞に指示投入。🦞がMCPツール群で作業→exec bridge→M1→Telegram通知
- **構成:** 2タブ固定([J-WORKER-1],[J-WORKER-2]) + タイトルベース特定 + 夜間caffeinate
- **ディベート:** Gemini×ChatGPT×🦞 全員賛成。DJ全自動承認（外部送信/削除含む）
- **ファイル:** croppy-tab-manager.sh, nightshift.sh, croppy-bridge.ts, croppy-health LaunchAgent
- **却下:** 司令塔タブ、専用Chromeプロファイル、二段階コミット、JSON出力プロトコル

## Memory System v2 — Full Implementation (2026-03-04)
- **状態:** 稼働中
- **D1テーブル:** jarvis_user_profile, jarvis_projects, jarvis_conversation_summaries, jarvis_pending_memory
- **ベクトルDB:** ~/jarvis-memory/vectors.db (intfloat/multilingual-e5-small, port 19823)
- **READ path:** 毎ターン自動注入（profile + projects + vector search + summaries + pending通知）
- **WRITE path:** Gemini CLI抽出 → confidence routing（≥0.7→直接保存, 0.4-0.7→pending, <0.4→スキップ）
- **コンフリクト解決:** manual > approved > extracted, 同source→高confidence優先
- **コマンド:** /memory (概要), /memory pending (承認待ち), /memory approve|reject <id>, /forget <keyword>, /remember <key> <value>
- **GC:** ベクトル(90日/5000件上限), サマリ(180日), pending(30日自動失効)
- **CLI:** ~/scripts/memory/memory-cli.py (status/profile/projects/pending/search/forget/remember)
- **LaunchAgent:** com.jarvis.embed-server (埋め込みサーバー)
- **ファイル:** src/services/jarvis-memory.ts, src/services/memory-extractor.ts, src/handlers/memory-commands.ts, scripts/memory-embed-server.py

### Doc Generator Pipeline (2026-03-05)
- **Location:** `~/scripts/doc-generator/`
- **Trigger:** DJ says "仕様書作って" or "マニュアル作って"
- **First action:** `exec bridge: cat ~/scripts/doc-generator/KNOWLEDGE.md`
- **Templates:** spec_m1253.js, spec_m1291.js (proven quality)
- **Output:** DOCX (MS fonts) + PDF (JP fonts + 図面結合)

## Exec Bridge Concurrent Execution (2026-03-05)
- **状態:** 稼働中
- **修正:** task-poller.ts — isExecuting排他ロック → activeTasks並行カウンター (MAX_CONCURRENT=3)
- **効果:** Claude Code spawn (5分) 実行中でも他のexec bridgeコマンドが即実行可能
- **設計:** pollAndExecute()はタスク発見→executeAndComplete()をfire-and-forget spawn→即return
- **安全性:** activeTasks++はタスク発見時のみ(empty pollでリーク無し)、activeTasks--はfinally保証

## Bridge v2: Granularity + Auto-Handoff (2026-03-06)
- **Worker Project Instructions:** 粒度ルール(ツール最大2回/応答)、応答ルール(Artifact要約、【決定】マーク、短い応答、ファイル書き出し)
- **Inject Counter:** workerInjectCounts Map (W:T→count)、25往復で⚠️警告、30往復で🔄自動handoff
- **Self-Summary Handoff:** handoff前に「この会話を要約して」inject→応答待ち(max 60s)→要約を新チャット初回injectに注入
- **Worker Instructions:** docs/worker-project-instructions.md に分離（Project設定にコピペ用）
- **Commit:** 28073b1

## Bridge v2: Default Routing + Response Relay (2026-03-07)
- **状態:** 稼働中
- **BRIDGE_MODE:** text.tsでデフォルトメッセージ→🦞Worker経由（true/falseで即切替可能）
- **raw mode:** 通常メッセージはそのまま🦞に渡す（[JARVIS TASK]ヘッダー・粒度ルールなし）。/bridge経由のみタスクモード（ルール付き）
- **Response Relay:** 🦞応答をDOMから自動読み取り→Telegram転送
  - セレクタ: `.font-claude-response` の最後の実質的要素（20文字超）
  - check-status: タブ位置ベース（タイトル非依存。claude.aiがタイトルを上書きしても動作）
  - re-mark: 応答読み取り後にタブタイトルを[J-WORKER-N]で再マーキング
  - タイムアウト: 3分でDJ通知
- **Worker Project:** メインJarvis Projectを共用（exec.sh等のProject filesをそのまま利用）
- **Project Instructions:** [JARVIS TASK]開始→タスクモード、それ以外→通常対話
- **管理コマンド:** /workers, /bridge nightshift はJarvis直接処理（🦞を経由しない）
- **Commits:** c2f4fba (routing), 4355fac (relay), cd0922c (raw+check-status), c436995 (last-substantial fix)

## Inbox Triage Agent (2026-03-12)
- **状態:** Phase 1 (候補表示のみ、自動実行なし)
- **サービス:** src/services/inbox-triage.ts (459行)
- **Gateway:** /v1/inbox/{enqueue,dequeue,result,feedback,cleanup}
- **GAS:** enqueueForTriage() → Gateway enqueue (clasp push待ち)
- **仕組み:** GAS/LINE/iMessage通知 → Gateway queue → Jarvis 60s poller → 🦞Worker inject [TRIAGE] → JSON判断 → アクション実行 → Telegram確認ボタン
- **アクション:** archive/delete/reply(下書き)/obsidian/bug_fix/ignore/escalate
- **バッファリング:** 同一送信者30秒ルール(Gateway dequeue buffer_seconds)
- **安全装置:** /tmp/triage-stop、Phase 1は全候補表示(自動実行なし)
- **Callback:** triage:{approve,reject,undo,send}:{item_id}
- **Phase 2:** confidence≥0.9 → 自動実行
- **Phase 3:** 承認率95%超 → 閾値0.8に下降
- **Worker Project Instructions:** [TRIAGE]プレフィックスでトリアージモード起動

### claude.ai Internal API Integration (2026-03-13)
- **Status:** Phase 1 完了（検索+投稿）、構想段階（オーケストレーション）
- **Files:** ~/scripts/claude-chat-post.py, src/handlers/claude-chat-api.ts
- **Commands:** /ask, /findchat, /askuuid
- **API:** 20+エンドポイント確認。sessionKey認証。チャットCRUD、Completion(SSE)、Project docs CRUD、Settings変更
- **Skill:** claude-ai-api.skill（プロジェクトSkillsに登録）
- **Next:** 案件別AIオーケストレーション構想（Inboxチャット、DJ分身チャット、夜間自律改善）

## Chrome Orchestration (2026-03-14)
- **状態:** 稼働中（スモークテスト+debateテスト合格）
- **決定:** sessionKey API廃棄、Chrome Worker Tab一本化（3AIディベート、DJ承認）
- **仕様書:** docs/chrome-orchestration-spec.md
- **却下:** sessionKey維持(BANリスク)、Claude Code CLI主系(機能不足)、従量課金API($170-350/月)

### 新規ファイル
| ファイル | 行数 | 責務 |
|---|---|---|
| scripts/tab-relay.sh | 241→264 | タブ間応答リレー(relay/ask-and-forward/debate) |
| scripts/project-tab-router.sh | 229 | M番号→Chromeタブ解決(D1+ローカルフォールバック) |
| src/handlers/orchestrator-chrome.ts | 284 | Chrome版Orchestrator(F4置換) |

### 既存ファイル変更
| ファイル | 変更 |
|---|---|
| scripts/croppy-tab-manager.sh | +wait-response、inject-raw Retry button fix |
| src/handlers/text.ts | getChromeOrchestrator置換 |
| src/index.ts | sessionKey orchestrator除去 |

### 削除ファイル (archive/sessionkey-f1-f9ブランチに退避)
- src/utils/claude-ai-client.ts (F1, 450行)
- src/utils/project-chat-manager.ts (F2, 312行)
- src/utils/project-context-builder.ts (F3, 409行)
- src/utils/orchestrator.ts (F4, 372行)
- src/utils/orchestrator-init.ts (F5, 202行)
- src/utils/auto-handoff.ts (F7, 320行)
- src/utils/nightly-forge-v2.ts (F8, 468行)
- src/utils/dj-spec-manager.ts (F9, 278行)
- src/handlers/dj-spec-command.ts (152行)
- **合計: -3,228行**

### Chrome操作プリミティブ（全テスト合格）
| コマンド | 状態 |
|---|---|
| new-chat (プロジェクトタブ作成) | ✅ |
| inject / inject-raw (メッセージ送信) | ✅ (Retry button fix適用) |
| wait-response (BUSY→READY待ち) | ✅ |
| read-response (応答DOM取得) | ✅ |
| project-tab-router resolve (M番号→タブ) | ✅ |
| tab-relay relay (タブ間転送) | ✅ |
| tab-relay debate (多往復ディベート) | ✅ (1round完走確認) |

### Commits
- 934ba6b feat: Chrome Orchestration (N1-N3 + spec)
- 44d88b8 feat: replace sessionKey orchestrator with Chrome-native
- feaf55a fix: inject-raw Retry button check + tab-relay temp file quoting
