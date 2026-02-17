# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📝 Auto Memory (Claude Code自動記憶)
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/architecture.md
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/lessons.md
@/Users/daijiromatsuokam1/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory/task-state.md


---

## 🚨 絶対ルール

### 1. 従量課金API は絶対使わない
- API使用前に必ず課金体系を確認
- 無料枠超過時は停止、代替案を提示
- 詳細は「API使用ポリシー」セクション参照

### 2. Phase完了毎にSTOP & 報告
- 各フェーズ完了時に必ずユーザーに報告
- 次のフェーズに進む前に承認を待つ
- 勝手に先に進まない

### 3. 仕様書の指示に従う
- 勝手に省略・簡略化しない
- 不明点があれば質問する
- ユーザーの意図を最優先

### 4. 文脈を必ず確認して使う
- [SYSTEM]ブロック内のjarvis_contextに現在のタスクが書いてある
- 「状況は？」と聞かれたらjarvis_contextの内容を答える
- chat_historyに直近の会話がある。必ず読んで会話を継続する
- プロジェクトパスは /Users/daijiromatsuokam1/claude-telegram-bot
- 「こんにちは」「何かお手伝いできますか」等の初回挨拶は禁止。文脈に基づいて返答する

### 5. Bot再起動方法
- 必ず `~/claude-telegram-bot/scripts/restart-bot.sh` を使用（重複インスタンス防止）
- pkillやbunやlaunchctl kickstartを直接呼ばないこと

### 6. タイムトラッキングとステータス更新
- ステータス変更（START/STOP/PAUSE）時は必ずtimer-sync.shでM3 Agentと同期
- 作業時間の記録はDJのタスク管理に直結するため、絶対に忘れない

### 7. 文脈ブロックの取り扱い
- [SYSTEM CONTEXT]や[RECENT CONVERSATION]はClaudeへの内部情報
- ユーザーへの応答にそのまま表示しない

### 8. 全体の文体ルール（応答・会話・council全て）
- 敬語禁止。「だ/である」調を使え
- 不要な前置きを省け
- 質問するな。最善の判断で自分で進め
- 長文禁止。要点だけ伝えろ
- 「どれを進めますか？」のような選択肢を出すな。自分で判断して実行しろ
- council:の議論も同じルール。丁寧語は不要
- 専門用語を使う場合、会話中の初回のみ括弧で簡潔な説明を付けろ。2回目以降は不要

### 9. 応答の方向性
- ユーザーのメッセージに素直に答えろ
- 関係ない文脈を引っ張るな
- 「テスト」→「テスト受信。何をする？」程度でいい
- 「状況は？」の時だけ状況レポートを返せ
- 聞かれていないことを長々と説明するな

---

## 📋 タスク管理（Todoist連携）

### トリガー
- 「今日のタスク教えて」「今週のTodoistタスク」等でタスク一覧を取得
- 「【Todoist】タスク名 #プロジェクト @タグ 期限」でタスク追加

### 認証情報
- Todoist APIトークンは `~/.claude/jarvis_config.json` に保存

---

## ⏱️ タスク時間計測

### スクリプト情報
- スクリプトパス: `/Users/daijiromatsuokam1/task-tracker.py`
- 状態ファイル: `~/.task-tracker.json`（開始時刻を保持）

### トリガー
- メッセージ末尾が「**開始**」→ タスク開始
- メッセージ末尾が「**終了**」→ タスク終了

### コマンド実行
```bash
python3 ~/task-tracker.py start "タスク名"
python3 ~/task-tracker.py end "タスク名"
```

---

## Commands

```bash
bun run start      # Run the bot
bun run dev        # Run with auto-reload (--watch)
bun run typecheck  # Run TypeScript type checking
bun install        # Install dependencies
bun test           # Run all tests (479 pass)
```

## Architecture

Telegram bot (~19,000 lines TypeScript, 109 files) that lets you control Claude Code from your phone via text, photos, and documents. Built with Bun and grammY.

### Message Flow

```
Telegram message → Handler → Auth check → Rate limit → Claude session → Streaming response → Audit log
```

### Key Modules

- **`src/index.ts`** - Entry point, registers handlers, starts polling
- **`src/config.ts`** - Environment parsing, MCP loading, safety prompts
- **`src/session.ts`** - `ClaudeSession` class with streaming, session persistence, defense-in-depth
- **`src/security.ts`** - `RateLimiter` (token bucket), path validation, command safety
- **`src/formatting.ts`** - Markdown→HTML conversion for Telegram

### Handlers (`src/handlers/`)

| Handler | Purpose |
|---------|---------|
| `commands.ts` | /start, /new, /stop, /status, /resume, /restart, /alarm, /recall, /todoist, /focus |
| `text.ts` | Text messages with intent filtering, Croppy debug, AI session routing |
| `document.ts` | PDF extraction (pdftotext CLI) and text file processing |
| `media-commands.ts` | /imagine, /edit, /outpaint, /animate (FLUX + ComfyUI) |
| `council.ts` | /debate (3AI council), /gpt, /gem |
| `ai-session.ts` | /ai (Claude/Gemini/GPT session bridge) |
| `ai-router.ts` | CLI-based AI calls (no API keys) |
| `streaming.ts` | StreamingState and status callback factory |
| `callback.ts` | Inline keyboard button handling |
| `why.ts` | /why command for context explanation |
| `croppy-commands.ts` | /croppy auto-approval management |
| `media-group.ts` | Media group buffering for albums |

### Task Orchestrator (`src/task/`)

| Module | Purpose |
|--------|---------|
| `orchestrate.ts` | Task orchestration core |
| `task-command.ts` | /task, /taskstop, /taskstatus commands |
| `tasklog-command.ts` | /tasklog for run history |
| `executor.ts` | Command execution with safety |
| `validator.ts` | Change validation (banned patterns, tests) |
| `reporter.ts` | Task result reporting |
| `run-logger.ts` | JSONL event logging per TaskRun |
| `health-check.ts` | Task health monitoring |
| `resource-limits.ts` | Resource limit enforcement |
| `retry.ts` | Retry logic |

### Registered Commands

| Command | Handler |
|---------|---------|
| `/start` | Start bot |
| `/new` | New conversation |
| `/stop` | Stop current task |
| `/status` | Show bot status |
| `/resume` | Resume session |
| `/restart` | Restart session |
| `/retry` | Retry last message |
| `/why` | Explain context |
| `/alarm` | Set alarm (e.g. /alarm 7時半 エサ) |
| `/recall` | Recall learned memory |
| `/todoist` | Todoist integration |
| `/focus` | Focus mode toggle |
| `/task` | Task orchestrator |
| `/taskstop` | Stop orchestrator task |
| `/taskstatus` | Task status |
| `/tasklog` | View task run history |
| `/debate` | 3AI council discussion |
| `/gpt` | Ask ChatGPT |
| `/gem` | Ask Gemini |
| `/ai` | AI session bridge (claude/gemini/gpt) |
| `/imagine` | Image generation (mflux) |
| `/edit` | Image editing (FLUX Kontext + ComfyUI) |
| `/outpaint` | Image outpainting (FLUX + ComfyUI) |
| `/animate` | Video generation (Wan2.2) |
| `/croppy` | Croppy auto-approval settings |

### External Processes

| Process | Location | Manager |
|---------|----------|---------|
| JARVIS Bot | src/index.ts | launchd (com.claude-telegram-ts) |
| Task Poller | src/bin/task-poller.ts | launchd (com.jarvis.task-poller) |

Task Poller runs independently from JARVIS. If JARVIS crashes, Poller survives and can restart JARVIS via exec bridge.

### Security Layers

1. User allowlist (`TELEGRAM_ALLOWED_USERS`)
2. Rate limiting (token bucket)
3. Path validation (`ALLOWED_PATHS`)
4. Command safety (blocked patterns)
5. System prompt constraints
6. Audit logging
7. git pre-commit hook (Husky) - BANNED keyword detection

### Configuration

All config via `.env` (copy from `.env.example`). Key variables:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` (required)
- `CLAUDE_WORKING_DIR` - Working directory for Claude
- `ALLOWED_PATHS` - Directories Claude can access
- AI calls: Claude CLI / Gemini CLI / ChatGPT Shortcuts (no API keys)

### ⚠️ CRITICAL: API使用ポリシー

**絶対ルール: 従量課金APIは使用禁止**

#### ✅ 許可されているAPI

| API | 用途 | 制限 |
|-----|------|------|
| `gemini` CLI | AI機能 | Google AI Pro定額サブスク（API KEY不要） |
| `TELEGRAM_BOT_TOKEN` | Bot通信 | 完全無料 |
| `GATEWAY_API_KEY` | Memory Gateway | 内部認証（無料） |

#### ❌ 禁止されているAPI

| API | 理由 |
|-----|------|
| `ANTHROPIC_API_KEY` | 従量課金のみ |
| `OPENAI_API_KEY` | 従量課金 |
| `GEMINI_API_KEY` | CLI化済み。`gemini` CLIを使うこと |

#### 🔧 AI呼び出し方法

```typescript
// ❌ 直接API呼び出し（禁止）
import Anthropic from '@anthropic-ai/sdk';

// ✅ CLI経由（推奨）
import { callClaudeCLI, callCodexCLI, callGeminiAPI } from './handlers/ai-router';
```

### Bot再起動

**必ず `scripts/restart-bot.sh` を使用。** pkill/bun/launchctlの直接実行は禁止。

理由: Telegram getUpdates Error 409（複数インスタンス競合）を防止。

### Runtime Files

- `/tmp/claude-telegram-session.json` - Session persistence
- `/tmp/telegram-bot/` - Downloaded photos/documents
- `/tmp/claude-telegram-audit.log` - Audit log

## Patterns

**Adding a command**: Create handler in `commands.ts`, register in `index.ts` with `bot.command("name", handler)`

**Adding a message handler**: Create in `handlers/`, export from `handlers/index.ts`, register in `index.ts`

**Streaming pattern**: All handlers use `createStatusCallback()` from `streaming.ts` and `session.sendMessageStreaming()`

**Type checking**: Run `bun run typecheck` periodically. Fix errors before committing.

**After code changes**: Restart with `bash scripts/restart-bot.sh`

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers.

---

## 📝 学習済みナレッジ

### DJ方針
- **スピードは重視しない。記憶すること、効率化、自動化を重視**
- 安易な結論を出さず、前提を疑い、反論も含めて段階的に深く考える
- 自分で判断して実行。選択肢を出すな
- **ネガティブなことも含めて報告する**。失敗・エラー・副作用・デメリット・未検証事項を必ず正直に含めろ
- **報告フォーマット**: 見やすく、詳細に。改善前/改善後の表形式、番号付きセクション、具体的な値

### 環境情報
- **マシン**: M1 MAX MacBook Pro（macOS Sequoia）、メモリ64GB
- **ランタイム**: Bun 1.3.x（TypeScript直接実行）
- **Bot起動**: launchd → restart-bot.sh
- **ComfyUI**: `/Users/daijiromatsuokam1/ComfyUI/` - FLUX系モデルで画像生成・編集
- **mflux**: Apple Silicon最適化のFLUX推論。`--low-ram` `--8-bit` オプション必須

### /edit（画像編集）の知見
- FLUX Kontext Edit使用。ComfyUIワークフロー経由
- 画像リサイズ: 最大1024px（長辺）にリサイズしてからFLUXに渡す（MPS互換性）
- 画像送信: 写真プレビュー（圧縮）+ ドキュメント（原寸PNG）の両方を送信

### 既知の未解決課題
- **Voice transcription**: OpenAI API依存のため現在無効。Whisper.cppローカル化が候補
- **/edit SIGTERM**: 単発でもSIGTERMが出る場合あり。Grammy/Telegramタイムアウトが濃厚

---


---

## 🤖 Master-Clone委譲パターン

カスタムSubagent定義ファイルは作らない。全文脈はこのCLAUDE.mdに集約し、自分自身のクローンに動的委譲する。

### 原則
- 重い調査・探索 → `Task(subagent_type="explore")` で読み取り専用クローンに委譲
- 並列可能な独立タスク → 複数の `Task()` を同時起動（最大7並列）
- メインコンテキストは戦略・判断に集中。実行の詳細はクローンが持つ
- クローンはこのCLAUDE.mdを自動継承するため、ルール・制約は一箇所管理

### いつ委譲するか
| 状況 | 委譲先 | 理由 |
|------|--------|------|
| ファイル探索・grep（5ファイル超） | Explore subagent | メインの文脈汚染防止 |
| テスト実行+結果分析 | Task(general-purpose) | 出力が大きい |
| 複数ファイル同時リファクタ | Task() × 複数 | ファイルオーナーシップ分離 |
| ドキュメント生成 | Task(general-purpose) | メインは次タスクに進める |
| 単純な1ファイル修正 | 自分でやる | 委譲オーバーヘッド > 直接実行 |

### 禁止事項
- `.claude/agents/` にSpecialist定義を作らない（メンテ負荷が高く脆い）
- 委譲先で従量課金APIを使わない（CLAUDE.mdルール継承で自動防止）
- 同じファイルを2つのクローンに触らせない（上書き事故）

<!-- SESSION_STATE_START -->
## 🧠 現在の状態

### 完了タスク

- なし（このセッションでは作業を行っていない）

### 残タスク

- なし（タスクの依頼を受けていない）

### 学んだこと

- なし

### 現在の問題

- `scripts/ai-media.py` が変更済み（uncommitted）の状態で残っている（git statusより）
<!-- SESSION_STATE_END -->
