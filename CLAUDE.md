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
5. **躓いたらまずWebSearchで調べろ** — エラー、未知のAPI、ライブラリの使い方で詰まったらWebSearch/WebFetchで公式ドキュメントを検索してから対処。推測で試行錯誤するな

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

Telegram bot (~36,000 lines TypeScript, 142 files) built with Bun + grammY. Lets DJ control Claude Code from phone via text, photos, and documents.

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

41 handler files. Core: `commands.ts` (bot commands), `text.ts` (message routing), `streaming.ts` (status callbacks). Media: `media-commands.ts` (FLUX/ComfyUI), `media-group.ts` (albums). AI: `council.ts` (/debate), `ai-session.ts` (/ai bridge), `ai-router.ts` (CLI calls), `claude-chat.ts` (claude.ai). Other: `document.ts` (PDF), `callback.ts` (buttons), `inbox.ts` (notifications), `scout-command.ts`, `code-command.ts`, `croppy-commands.ts`.

### Task Orchestrator (`src/task/`)

`orchestrate.ts` (core), `task-command.ts` (/task commands), `executor.ts` (safe exec), `validator.ts` (banned patterns + tests), `reporter.ts` (results).

### External Processes

- JARVIS Bot: `com.claude-telegram-ts` → `src/index.ts`
- Task Poller: `com.jarvis.task-poller` → `src/bin/task-poller.ts` (独立、Jarvisクラッシュ時も生存)

### Security: 6 layers

Allowlist → Rate limit → Path validation → Command safety → git pre-commit (BANNED keywords) → Hookify (SDK/API key blocking)

### Configuration

`.env` (from `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, `CLAUDE_WORKING_DIR`, `ALLOWED_PATHS`. AI calls: CLI only (no API keys).

### Runtime: `/tmp/claude-telegram-session.json`, `/tmp/telegram-bot/`, `/tmp/claude-telegram-audit.log`

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

## Compaction

Claude Code handles context compaction internally (server-side summarization for long conversations). This reduces the need for manual handoff in long sessions. See `docs/compaction.md` for details. Auto-handoff (`scripts/auto-handoff.py`) remains for between-session context transfer.

## Agent Teams

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is exported in `scripts/claude-code-spawn.sh`. Agent definitions in `.claude/agents/`: batch-leader, test-runner, code-reviewer, batch-worker. See `docs/agent-teams.md`.

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers.
