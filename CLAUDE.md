# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- 必ず ~/claude-telegram-bot/scripts/start-bot.sh を使用
- pkillやbunを直接呼ばないこと

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
  - 例: 「WebSocket（サーバーとリアルタイム双方向通信する仕組み）で接続する」
  - 2回目: 「WebSocketで再接続する」（説明不要）

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
- ファイルが存在しない場合はその旨をユーザーに報告

### タスク取得
```bash
curl -s "https://api.todoist.com/rest/v2/tasks?filter=today" \
  -H "Authorization: Bearer $TOKEN"
```

### タスク追加
- プロジェクト指定: #プロジェクト名
- タグ指定: @タグ名
- 存在しないプロジェクト/タグは自動作成

---

## ⏱️ タスク時間計測

### スクリプト情報
- スクリプトパス: `/Users/daijiromatsuokam1/task-tracker.py`
- 状態ファイル: `~/.task-tracker.json`（開始時刻を保持）

### トリガー
- メッセージ末尾が「**開始**」→ タスク開始
- メッセージ末尾が「**終了**」→ タスク終了
- 「開始」「終了」を除いた部分がタスク名

### コマンド実行
```bash
# タスク開始
python3 ~/task-tracker.py start "タスク名"

# タスク終了
python3 ~/task-tracker.py end "タスク名"
```

### 応答フォーマット
- **開始時**: 「✅ {タスク名} 開始しました（HH:MM）」
- **終了時**: 「✅ {タスク名} 終了 ⏱️ 経過時間: X時間X分 📅 LOGカレンダーに保存しました」

### 機能詳細
- 複数タスクの並行計測に対応
- 24時間後に自動クリーンアップ
- 終了時にGoogleカレンダーのLOGカレンダーにAppleScript経由でイベント作成

### 例
```
ユーザー: ヤガイ2号機設計開始
→ python3 ~/task-tracker.py start "ヤガイ2号機設計"
→ 「✅ ヤガイ2号機設計 開始しました（08:30）」

ユーザー: ヤガイ2号機設計終了
→ python3 ~/task-tracker.py end "ヤガイ2号機設計"
→ 「✅ ヤガイ2号機設計 終了 ⏱️ 経過時間: 2時間15分 📅 LOGカレンダーに保存しました」
```

---

## 🔄 標準ワークフロー

### 簡単なタスク
```
DJ → Jarvis直接実行
```
- 単純なファイル編集
- 明確な仕様の実装
- 1-2ステップで完了するタスク

### 複雑なタスク
```
DJ → council: で設計 → Jarvis実装
```
- 複数ファイルにまたがる変更
- アーキテクチャ設計が必要
- 複数の選択肢がある場合

使用例：
```
council: Darwin Engineのパフォーマンス改善方法を3つ提案して
```

### つまずいた時
```
DJ → council: に相談 → 代替案提示
```
- エラーが解決できない
- 設計の方向性が不明
- 技術的な判断が必要

---

## Bot再起動方法

### 🚨 必ずこのスクリプトを使用

**絶対に以下のスクリプトで起動してください：**

```bash
~/claude-telegram-bot/scripts/start-bot.sh
```

### ⚠️ 重要な注意事項

1. **直接コマンドを実行しない**
   - ❌ `pkill -9 -f "bun.*index.ts"` （禁止）
   - ❌ `bun run src/index.ts` （禁止）
   - ❌ `nohup bun run ...` （禁止）
   - ❌ 任意のbunコマンド直接実行 （禁止）

2. **なぜこのスクリプトを使う必要があるか**
   - **Error 409問題**: Telegramは同じbotトークンで複数のgetUpdatesリクエストを許可しません
   - 既存プロセスが完全に停止する前に新しいインスタンスを起動すると、以下のエラーでbotが停止します：
     ```
     GrammyError: Call to 'getUpdates' failed! (409: Conflict:
     terminated by other getUpdates request; make sure that only
     one bot instance is running)
     ```
   - このスクリプトは以下を保証します：
     - ✅ 既存の全プロセスを確実に停止（pkill -9）
     - ✅ 3秒待機して完全な停止を確認
     - ✅ 停止できない場合は起動せずエラー終了
     - ✅ 単一インスタンスのみを起動
     - ✅ 起動確認とログ出力

3. **スクリプトの動作**
   ```bash
   # 1. 既存プロセスを強制停止（pkill -9）
   # 2. 3秒待機して完全に停止
   # 3. まだプロセスが残っていればエラーで終了
   # 4. ログディレクトリ作成
   # 5. 新しいインスタンスを起動
   # 6. 3秒待機して起動確認
   # 7. PIDとログパスを表示
   ```

### トラブルシューティング

**Bot が Error 409 で停止する場合:**
- 複数のbotインスタンスが起動している可能性があります
- 必ず `~/claude-telegram-bot/scripts/start-bot.sh` を使用してください
- 手動で起動した場合は、一度全て停止してからスクリプトで起動
- **絶対にpkillやbunコマンドを直接実行しないでください**

## Commands

```bash
bun run start      # Run the bot
bun run dev        # Run with auto-reload (--watch)
bun run typecheck  # Run TypeScript type checking
bun install        # Install dependencies
```

## Architecture

This is a Telegram bot (~3,300 lines TypeScript) that lets you control Claude Code from your phone via text, voice, photos, and documents. Built with Bun and grammY.

### Message Flow

```
Telegram message → Handler → Auth check → Rate limit → Claude session → Streaming response → Audit log
```

### Key Modules

- **`src/index.ts`** - Entry point, registers handlers, starts polling
- **`src/config.ts`** - Environment parsing, MCP loading, safety prompts
- **`src/session.ts`** - `ClaudeSession` class wrapping Agent SDK V2 with streaming, session persistence (`/tmp/claude-telegram-session.json`), and defense-in-depth safety checks
- **`src/security.ts`** - `RateLimiter` (token bucket), path validation, command safety checks
- **`src/formatting.ts`** - Markdown→HTML conversion for Telegram, tool status emoji formatting
- **`src/utils.ts`** - Audit logging, voice transcription (OpenAI), typing indicators
- **`src/types.ts`** - Shared TypeScript types

### Handlers (`src/handlers/`)

Each message type has a dedicated async handler:
- **`commands.ts`** - `/start`, `/new`, `/stop`, `/status`, `/resume`, `/restart`
- **`text.ts`** - Text messages with intent filtering
- **`voice.ts`** - Voice→text via OpenAI, then same flow as text
- **`photo.ts`** - Image analysis with media group buffering (1s timeout for albums)
- **`document.ts`** - PDF extraction (pdftotext CLI) and text file processing
- **`callback.ts`** - Inline keyboard button handling for ask_user MCP
- **`streaming.ts`** - Shared `StreamingState` and status callback factory

### Security Layers

1. User allowlist (`TELEGRAM_ALLOWED_USERS`)
2. Rate limiting (token bucket, configurable)
3. Path validation (`ALLOWED_PATHS`)
4. Command safety (blocked patterns)
5. System prompt constraints
6. Audit logging

### Configuration

All config via `.env` (copy from `.env.example`). Key variables:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` (required)
- `CLAUDE_WORKING_DIR` - Working directory for Claude
- `ALLOWED_PATHS` - Directories Claude can access
- Gemini AI features use `gemini` CLI (Google AI Pro subscription, no API key needed)

MCP servers defined in `mcp-config.ts`.

### ⚠️ CRITICAL: API使用ポリシー

**絶対ルール: 従量課金APIは使用禁止**

#### ✅ 許可されているAPI

| API | 用途 | 制限 |
|-----|------|------|
| `gemini` CLI | AI機能 | Google AI Pro定額サブスク（API KEY不要） |
| `TELEGRAM_BOT_TOKEN` | Bot通信 | 完全無料 |
| `GATEWAY_API_KEY` | Memory Gateway | 内部認証（無料） |
| `M3_AGENT_TOKEN` | M3 Agent | 内部認証（無料） |

#### ❌ 禁止されているAPI

| API | 理由 |
|-----|------|
| `ANTHROPIC_API_KEY` | 従量課金のみ（無料枠なし） |
| `OPENAI_API_KEY` | 従量課金（$5トライアル後は課金） |
| `GEMINI_API_KEY` | CLI化済み。`gemini` CLIを使うこと |

#### 🔧 AI呼び出し方法（従量課金回避）

**AI Router経由で呼び出す（`src/handlers/ai-router.ts`）:**

```typescript
// ❌ 直接API呼び出し（禁止）
import { AnthropicProvider } from './providers/anthropic';
const provider = new AnthropicProvider(); // 従量課金API使用

// ✅ AI Router経由（推奨）
import { callClaudeCLI, callCodexCLI, callGeminiAPI } from './handlers/ai-router';

// Claude via CLI（Telegram転送 = 無料）
const response = await callClaudeCLI(prompt, memoryPack);

// ChatGPT via Codex CLI（Telegram転送 = 無料）
const response = await callCodexCLI(prompt, memoryPack);

// Gemini via API（無料枠）
const response = await callGeminiAPI(prompt, memoryPack);
```

**Darwin Engine**: すべてのモデル（claude/chatgpt/gemini）をAI Router経由で呼び出し

**Voice transcription**: 現在無効（OpenAI API使用のため）

### Runtime Files

- `/tmp/claude-telegram-session.json` - Session persistence for `/resume`
- `/tmp/telegram-bot/` - Downloaded photos/documents
- `/tmp/claude-telegram-audit.log` - Audit log

## Patterns

**Adding a command**: Create handler in `commands.ts`, register in `index.ts` with `bot.command("name", handler)`

**Adding a message handler**: Create in `handlers/`, export from `index.ts`, register in `index.ts` with appropriate filter

**Streaming pattern**: All handlers use `createStatusCallback()` from `streaming.ts` and `session.sendMessageStreaming()` for live updates.

**Type checking**: Run `bun run typecheck` periodically while editing TypeScript files. Fix any type errors before committing.

**After code changes**: Restart the bot so changes can be tested. Use `launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts` if running as a service, or `bun run start` for manual runs.

## Standalone Build

The bot can be compiled to a standalone binary with `bun build --compile`. This is used by the ClaudeBot macOS app wrapper.

### External Dependencies

PDF extraction uses `pdftotext` CLI instead of an npm package (to avoid bundling issues):

```bash
brew install poppler  # Provides pdftotext
```

### PATH Requirements

When running as a standalone binary (especially from a macOS app), the PATH may not include Homebrew. The launcher must ensure PATH includes:
- `/opt/homebrew/bin` (Apple Silicon Homebrew)
- `/usr/local/bin` (Intel Homebrew)

Without this, `pdftotext` won't be found and PDF parsing will fail silently with an error message.

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers to commit messages.

## Running as Service (macOS)

```bash
cp launchagent/com.claude-telegram-ts.plist.template ~/Library/LaunchAgents/com.claude-telegram-ts.plist
# Edit plist with your paths
launchctl load ~/Library/LaunchAgents/com.claude-telegram-ts.plist

# Logs
tail -f /tmp/claude-telegram-bot-ts.log
tail -f /tmp/claude-telegram-bot-ts.err
```

---

## 📝 学習済みナレッジ（セッション横断の運用知見）

### DJ方針
- **スピードは重視しない。記憶すること、効率化、自動化を重視**
- 安易な結論を出さず、前提を疑い、反論も含めて段階的に深く考える
- 自分で判断して実行。選択肢を出すな
- **ネガティブなことも含めて報告する**。都合の良いことだけ報告するな
  - ❌ 「修正完了しました！」（エラーや未テスト事項を隠す）
  - ✅ 「修正完了。ただし〇〇は未テスト / △△のデメリットあり」
  - 失敗・エラー・副作用・デメリット・未検証事項を必ず正直に含めろ
- **報告フォーマット**: 見やすく、詳細に、訳わからない記号は使わない
  - 改善前/改善後の表形式で変更内容を明示
  - 番号付きセクションで構造化
  - 技術的な詳細（パラメータ値、ファイル名等）を具体的に記載
  - 「大幅改善」のような曖昧な表現ではなく、何を何に変えたかを書く
  - 例: 「サンプラー: euler+simple から dpmpp_2m+karras に変更」

### 環境情報
- **マシン**: MacBook Pro M3 Max（macOS Sequoia 15.3.1）、メモリ36GB
- **ランタイム**: Bun 1.2.x（TypeScript直接実行）
- **Bot起動**: `start-bot.sh` → `bun --watch` で起動（ソース変更で自動再起動）。Watchdog (`watchdog-bot.sh`) が30秒間隔で監視
- **ComfyUI**: `/Users/daijiromatsuokam1/ComfyUI/` に設置。FLUX系モデルで画像生成・編集
- **mflux**: Apple Silicon最適化のFLUX推論。`--low-ram` `--8-bit` オプション必須（36GBメモリ制約）

### /edit（画像編集）の知見
- FLUX Kontext Edit使用。ComfyUIワークフロー経由
- **顔保護マスク**: denoise 0.85で顔部分を保護するが、合成ズレ（顔が背中に出る等）が発生する場合あり
- **outpaint**: 外側に拡張する機能。patch-outpaint.pyで制御
- 画像リサイズ: 最大1024px（長辺）にリサイズしてからFLUXに渡す（MPS互換性のため）
- 画像送信: 写真プレビュー（圧縮, インライン表示）+ ドキュメント（原寸PNG）の両方を送信

### 解決済みの問題
- **型エラー258個**: 2025-02-09に全て修正済み（65ファイル変更）。ロジック変更なし、型アノテーション追加のみ
- **Error 409**: Telegram getUpdates競合。start-bot.shで解決済み
- **OpenAI/Anthropic API課金**: AI Router導入で従量課金API完全排除済み
- **再起動忘れ**: `bun --watch` を start-bot.sh に導入。ソース変更で自動再起動
- **Watchdog誤検知**: サイレント死亡チェックをログサイズ比較方式に改善（mtimeだけでなくサイズ変化で判定）
- **画像送信の画質劣化**: `/imagine`, `/edit`, `/outpaint` で写真プレビュー + ドキュメント原寸の両方を送信
- **MPS convolution_overrideable**: 入力画像を1024pxにリサイズ（1536→1024）。ComfyUIは `--force-fp32` + `PYTORCH_ENABLE_MPS_FALLBACK=1` で起動済み

### 既知の未解決課題
- **Voice transcription**: OpenAI API依存のため現在無効。Whisper.cppローカル化が候補
- **/edit画像品質**: FLUX Editで顔合成ズレが発生する場合がある。マスク戦略の改善が必要
- **MPS convolution**: `--force-fp32` + 1024pxリサイズで軽減したが、完全に防げるか未検証。Python 3.14 + PyTorch互換性の可能性あり

---

<!-- SESSION_STATE_START -->
## 🧠 現在の状態

### 完了タスク
- なし（このセッションではタスク実行していない）

### 残タスク
- なし（タスク依頼なし）

### 学んだこと
- なし（技術的作業なし）

### 現在の問題
- なし

このセッションはping/echoの疎通確認のみだった。
<!-- SESSION_STATE_END -->
