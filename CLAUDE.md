# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## 📝 Auto Memory (Claude Code自動記憶)
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/architecture.md
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/lessons.md
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/task-state.md

---

## 🚨 絶対ルール

1. **従量課金API使用禁止** — CLI経由のみ（詳細はUser CLAUDE.md + MEMORY.md参照）
2. **Bot再起動は `scripts/restart-bot.sh`** — pkill/bun/launchctl直接実行禁止（409競合防止）
3. **コミット前に `bun test`** — Husky pre-commitが自動実行（Layer 2は `--no-verify`）
4. **コードを書く前に深く考える** — 急がない。「なぜ？」を3回繰り返す

---

## Commands

```bash
bun run start      # Run the bot
bun run dev        # Run with auto-reload (--watch)
bun run typecheck  # TypeScript type checking
bun install        # Install dependencies
bun test           # Run all tests
```

---

## Architecture

Telegram bot (~19,000 lines TypeScript, 109 files) built with Bun + grammY. Lets DJ control Claude Code from phone via text, photos, and documents.

### Message Flow

```
Telegram message → Handler → Auth check → Rate limit → Claude session → Streaming response → Audit log
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Entry point, handler registration, polling |
| `src/config.ts` | Environment parsing, MCP loading, safety prompts |
| `src/session.ts` | ClaudeSession: streaming, persistence, defense-in-depth |
| `src/security.ts` | RateLimiter (token bucket), path validation, command safety |
| `src/formatting.ts` | Markdown→HTML for Telegram |

### Handlers (`src/handlers/`)

| Handler | Purpose |
|---------|---------|
| `commands.ts` | /start, /new, /stop, /status, /resume, /restart, /alarm, /recall, /todoist, /focus |
| `text.ts` | Text messages: intent filtering, Croppy debug, AI session routing |
| `document.ts` | PDF extraction (pdftotext CLI) and text file processing |
| `media-commands.ts` | /imagine, /edit, /outpaint, /animate (FLUX + ComfyUI) |
| `council.ts` | /debate (3AI council), /gpt, /gem |
| `ai-session.ts` | /ai (Claude/Gemini/GPT session bridge) |
| `ai-router.ts` | CLI-based AI calls (no API keys) |
| `streaming.ts` | StreamingState and status callback factory |
| `callback.ts` | Inline keyboard button handling |
| `why.ts` | /why context explanation |
| `croppy-commands.ts` | /croppy auto-approval management |
| `media-group.ts` | Media group buffering for albums |

### Task Orchestrator (`src/task/`)

| Module | Purpose |
|--------|---------|
| `orchestrate.ts` | Task orchestration core |
| `task-command.ts` | /task, /taskstop, /taskstatus commands |
| `executor.ts` | Command execution with safety |
| `validator.ts` | Change validation (banned patterns, tests) |
| `reporter.ts` | Task result reporting |

### External Processes

| Process | LaunchAgent | Notes |
|---------|-------------|-------|
| JARVIS Bot | com.claude-telegram-ts | src/index.ts |
| Task Poller | com.jarvis.task-poller | src/bin/task-poller.ts (独立、Jarvisクラッシュ時も生存) |

### Security Layers

1. User allowlist (`TELEGRAM_ALLOWED_USERS`)
2. Rate limiting (token bucket)
3. Path validation (`ALLOWED_PATHS`)
4. Command safety (blocked patterns)
5. git pre-commit hook (Husky) — BANNED keyword detection
6. Hookify rules — SDK import/API key runtime blocking

### Configuration

All config via `.env` (copy from `.env.example`). Key variables:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` (required)
- `CLAUDE_WORKING_DIR` — Working directory for Claude
- `ALLOWED_PATHS` — Directories Claude can access
- AI calls: Claude CLI / Gemini CLI / ChatGPT Shortcuts (no API keys)

### Runtime Files

- `/tmp/claude-telegram-session.json` — Session persistence
- `/tmp/telegram-bot/` — Downloaded photos/documents
- `/tmp/claude-telegram-audit.log` — Audit log

---


## Past Context Retrieval

実装中に過去の設計決定や解決策が必要な場合、以下のツールを使う:

**ChatLog検索** (M1上で直接実行):
```bash
python3 ~/scripts/search-chatlogs.py "キーワード" --list    # ファイル一覧
python3 ~/scripts/search-chatlogs.py "キーワード" --context 3  # 前後3行
```

**時間旅行** (過去のclaude.aiチャットに直接質問):
```bash
bash ~/claude-telegram-bot/scripts/time-travel.sh --search "キーワード" "質問"
bash ~/claude-telegram-bot/scripts/time-travel.sh <chat_id> "質問"
```
注意: Chromeタブを一時的にナビゲートするため、他のChrome操作と競合する。

**使い分け**:
- まずsearch-chatlogs.pyでログ検索（高速、ローカル）
- ログだけで不十分なら time-travel.sh で当時のClaudeに直接質問（遅い、Chrome占有）

## Patterns

**Adding a command**: Create handler in `commands.ts`, register in `index.ts` with `bot.command("name", handler)`

**Adding a message handler**: Create in `handlers/`, export from `handlers/index.ts`, register in `index.ts`

**Streaming pattern**: All handlers use `createStatusCallback()` from `streaming.ts` and `session.sendMessageStreaming()`

**Type checking**: Run `bun run typecheck` periodically. Fix errors before committing.

**After code changes**: Restart with `bash scripts/restart-bot.sh`

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers.
