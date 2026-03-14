# Claude Code 公式仕様リファレンス（キカイラボ向け抜粋）

**出典:** code.claude.com/docs/en/ (2026-03-14取得)
**全ドキュメント:** docs/claude-code-llms.txt にインデックス、個別MDファイルもdocs/に保存済み

---

## 認証 & 課金

- Max PlanのOAuthログインで動作（API従量課金不要）
- 使用量 = claude.ai + Claude Code + Claude Desktop の合算
- Extra Usage OFF → 枠到達で停止（従量課金に入らない）
- OAuth tokenはclaude.aiとClaude Codeのみ許可。他ツールでの使用はToS違反

## プログラマティック実行 (`claude -p`)

```bash
# ワンショット実行
claude -p "Find and fix the bug in auth.py" --allowedTools "Read,Edit,Bash"

# JSON出力（session_id取得可能）
claude -p "Summarize this project" --output-format json

# ストリーミング
claude -p "Explain recursion" --output-format stream-json --verbose

# ツール自動承認
claude -p "Run tests and fix failures" --allowedTools "Bash,Read,Edit"

# 全権限スキップ（自動化向け、注意が必要）
claude -p "Deploy" --dangerously-skip-permissions

# システムプロンプト追加（デフォルト保持 + 追加指示）
echo "diff" | claude -p --append-system-prompt "You are a reviewer."

# JSON Schema指定の構造化出力
claude -p "Extract functions" --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}}}'
```

## セッション管理

```bash
# 直近の会話を継続
claude -p "Continue the review" --continue

# session_idをキャプチャして特定セッションを再開
session_id=$(claude -p "Start review" --output-format json | jq -r '.session_id')
claude -p "Follow up" --resume "$session_id"

# インタラクティブモードでのセッション操作
claude --continue     # 直近セッション継続
claude --resume       # セッション選択画面
claude --resume name  # 名前でresume
```

**重要な仕様:**
- 各新規セッションは白紙のコンテキストウィンドウで開始
- `--resume` でフルコンテキスト（メッセージ、ツール結果、ファイルコンテキスト）を復元
- セッションはプロジェクトディレクトリ単位で保存（`~/.claude/projects/`）
- `--continue --fork-session` でセッションをフォーク（元を変更せず分岐）

## メモリ（永続知識）

### CLAUDE.md
- **毎セッション自動読み込み**。compactでも消えない
- 200行以内推奨（長いとトークン消費+遵守率低下）
- `@path/to/file` でインポート可能（再帰5段まで）
- 配置場所: `./CLAUDE.md`(プロジェクト), `~/.claude/CLAUDE.md`(ユーザー全体)
- `/init` で自動生成（ビルドシステム、テストFW、コードパターンを検出）

### Auto Memory
- Claudeが作業中に自動保存（ビルドコマンド、デバッグ知見、好み）
- `MEMORY.md` の最初の200行が毎セッション読み込まれる
- ワーキングツリー単位でスコープ

### .claude/rules/
- 複数ファイルにルールを分割
- `paths` frontmatterでファイルパターン別にスコープ可能（例: `src/api/**/*.ts`）

## コンテキストウィンドウ

- 会話履歴+ファイル内容+コマンド出力+CLAUDE.md+スキル+システム指示を保持
- **満杯に近づくと自動compact**（古いツール出力をクリア、会話を要約）
- compact後もCLAUDE.mdは保持される
- `/context` でスペース使用状況を確認
- `/compact focus on X` でフォーカス指定のcompact可能

## MCP（外部ツール接続）

プロジェクトの `.mcp.json` または `~/.claude.json` で設定:

```json
{
  "mcpServers": {
    "my-tool": {
      "command": "python3",
      "args": ["/path/to/server.py"],
      "env": { "KEY": "value" }
    }
  }
}
```

- ローカルプロセスとして起動、Claude Codeが自動接続
- ACCESS DB連携: PowerShellスクリプトをMCPサーバー化すれば、Claudeが直接DB操作可能
- MCPサーバーはコンテキストを消費する（`/mcp` でサーバーごとのコスト確認）

## Subagents

独自コンテキストで動く子タスク。メインのコンテキストを汚さない:

```markdown
# .claude/agents/researcher.md
---
description: "Research specialist for codebase analysis"
tools: ["Read", "Grep", "Glob", "Bash"]
model: sonnet
---
You are a research specialist. Analyze code and return concise findings.
```

- `model` 指定可能（sonnet/opus）→ quota管理に有用
- 完了後に要約をメインに返す
- ファイルシステムは共有（変更は他セッションにも見える）

## Agent Teams

複数の独立Claude Codeセッションが協調:
- 共有タスク、セッション間メッセージング
- 研究の仮説競合、並列コードレビュー、機能分担に最適
- **実験的機能、デフォルト無効**

## Hooks（自動化フック）

Claude Codeのアクション前後にシェルコマンドを自動実行:
- ファイル編集後に自動フォーマット
- コミット前にlint実行
- タスク完了時に通知

## Git Worktrees（並列セッション）

```bash
# 独立ワーキングツリーでClaude起動
claude --worktree feature-auth
claude --worktree bugfix-123
```

- 各worktreeは独自のファイル+ブランチ+セッション
- 案件ごとにworktree作成すれば完全独立

## キカイラボ案件チャットへの適用案

```
~/claude-projects/
├── M1317/
│   ├── CLAUDE.md              ← 案件永続知識 + DJ-SPEC参照
│   ├── .claude/
│   │   ├── agents/            ← subagent定義
│   │   └── rules/             ← 案件固有ルール
│   ├── .mcp.json              ← ACCESS DB MCP接続設定
│   └── context/
│       ├── emails.md          ← Gmail/LINE転送追記
│       ├── decisions.ndjson   ← 判断ログ
│       └── access-snapshot.md ← ACCESS DBスナップショット
├── M1319/
│   └── (同構造)
└── nightly/
    ├── CLAUDE.md              ← DESIGN-RULES参照 + Nightly専用ルール
    └── .claude/agents/        ← 改善発見用subagent
```

Jarvisからの呼び出しパターン:
```bash
# 案件メッセージ転送（ファイル追記 + セッション更新）
echo "📧 Gmail: 美山からカメラ設置変更" >> ~/claude-projects/M1317/context/emails.md
cd ~/claude-projects/M1317 && claude -p --continue "新着メール確認して対応方針を提案" --output-format json

# DJからの質問
cd ~/claude-projects/M1317 && claude -p --continue "次のアクションは？" --allowedTools "Read,Grep,Bash"

# Nightly改善（全権限、Sonnetで）
cd ~/claude-projects/nightly && claude -p --dangerously-skip-permissions --model sonnet "改善候補を3つ提案"
```

## 未検証事項（次セッションで実験）

1. セッション数管理: 20案件分のセッションをresume/continueで安定管理できるか
2. `-p --continue` の自動化安定性: Bun.spawnからの連続呼び出しで文脈が繋がるか
3. compact時の情報損失: 何が残り何が消えるか、CLAUDE.mdは本当に100%残るか
4. MCP + subagents の実際の挙動
