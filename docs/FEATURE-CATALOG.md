/debate -> council.ts
/ai {claude|gemini|gpt|end|status} -> ai-session.ts, session-bridge.ts
/imagine -> mflux (Z-Image-Turbo 8bit)
/edit -> ComfyUI+FLUX.1Dev Q5 GGUF
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
