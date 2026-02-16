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
