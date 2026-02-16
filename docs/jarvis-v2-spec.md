# JARVIS v2 — Croppy-Driven Architecture 仕様書

**作成日:** 2026-02-16
**ステータス:** DECIDED（ディベート完了）
**決定者:** DJ + クロッピー🦞

---

## 1. 概要

JARVIS v2は「🦞が設計・判断、Claude Codeが実行、Jarvisは軽いタスクのみ」のアーキテクチャ。
重いタスクからJarvis🤖の判断を完全に排除し、失敗点を最小化する。

## 2. アーキテクチャ図

```
【重いタスク — Croppy-Driven】
DJ → claude.ai(🦞) → exec bridge --fire
  → M1: claude -p "タスク指示書"
    → Claude Code（sandbox + subagents + ralph-loop）
      → 自律実行（設計・コード・テスト・git push）
      → Stop hook → Telegram API 直接通知 → DJ📱

【軽いタスク — 既存Jarvis】
DJ → Telegram → Jarvis🤖（今のまま）
  → Claude CLI / Gemini CLI / 直接応答
  → Telegram応答 → DJ📱
```

## 3. ディベート決定事項

| ID | 決定 | 理由 | 却下案と理由 |
|----|------|------|-------------|
| Q1 | exec bridge → `claude -p` 直接実行 | ファイルウォッチャー不要。シンプル | 案A（ファイルウォッチ方式）: Jarvisに新コード必要、複雑 |
| Q2 | Claude Code Stop hook → Telegram API直接 | Jarvis経由しない。障害点削減 | 案A（ファイル経由）: 遅い。案C（--notify）: exec bridge依存残る |
| Q3 | 一括移行 | DJ判断。段階的は中途半端 | 段階的移行: Phase管理コスト不要 |
| レーン | 2レーン設計 | 重い/軽いで経路分離 | 全タスクClaude Code: 軽いタスクにオーバーキル |

## 4. コンポーネント責務

| コンポーネント | 責務 | 判断力 | 失敗時の影響 |
|---------------|------|--------|-------------|
| 🦞 クロッピー（claude.ai） | 設計・指示書作成・fire-and-forget | 全判断 | タスク未投入（DJが気づく） |
| exec bridge（exec.sh） | --fire でコマンド投入 | ゼロ | Gateway/Poller障害 → 既存3層防御 |
| Claude Code（M1） | 自律実行（sandbox内） | タスク内判断 | Stop hookで失敗通知 |
| Telegram通知（Stop hook） | 結果をDJに直接送信 | ゼロ | 通知漏れ（Claude Code自体は完了） |
| Jarvis🤖（既存） | 軽いタスクのみ | 限定的 | 軽いタスク応答失敗（既存リスク） |

## 5. 🦞のfire-and-forget原則

- 🦞はexec bridgeで `claude -p` を --fire で投げて**終わり**
- 結果のポーリング不要。セッションが死んでもOK
- 結果はClaude CodeのStop hookがTelegramに直接送信
- 🦞の責務は「良い指示書を書く」ことだけ

## 6. 実行フロー詳細

### 6.1 🦞がタスクを投げる（claude.ai上）
```bash
bash exec.sh --fire "cd ~/claude-telegram-bot && nohup claude -p --dangerously-skip-permissions 'ここにタスク指示書' > /tmp/claude-code-output.log 2>&1 & echo SPAWNED"
```

### 6.2 Claude Codeが自律実行
- sandbox内でファイル編集・テスト・git操作
- subagentsでテスト並列化（Haiku/Sonnet）
- ralph-loopで長時間タスク継続
- BASH_DEFAULT_TIMEOUT_MS=1800000（30分）
- BASH_MAX_TIMEOUT_MS=7200000（2時間）

### 6.3 Stop hookでTelegram通知
```bash
# scripts/croppy-done.sh（改修版）
#!/bin/bash
source ~/claude-telegram-bot/.env 2>/dev/null

# 最新コミットまたはセッション結果を取得
LAST_COMMIT=$(cd ~/claude-telegram-bot && git log --oneline -1 2>/dev/null)
MSG="Claude Code完了: $LAST_COMMIT"

curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_ALLOWED_USERS" \
  -d "text=$MSG" > /dev/null 2>&1
```

## 7. Claude Code環境設定

### 7.1 .claude/settings.json
```json
{
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "1800000",
    "BASH_MAX_TIMEOUT_MS": "7200000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "90"
  },
  "hooks": {
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{"type": "command", "command": "bash ~/claude-telegram-bot/scripts/croppy-start.sh"}]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [
        {"type": "command", "command": "python3 ~/claude-telegram-bot/scripts/auto-handoff.py"},
        {"type": "command", "command": "bash ~/claude-telegram-bot/scripts/croppy-done.sh"}
      ]
    }],
    "PreCompact": [{
      "matcher": "*",
      "hooks": [{"type": "command", "command": "bash ~/claude-telegram-bot/scripts/pre-compact.sh"}]
    }]
  }
}
```

### 7.2 Sandbox
```
claude /sandbox
```
- ファイルシステム: ~/claude-telegram-bot 内のみ
- ネットワーク: npm/pip/git 許可
- パーミッションプロンプト84%削減

### 7.3 ralph-wiggum（検証後導入）
```
/plugin install ralph-wiggum@claude-plugins-official
/ralph-loop "タスク" --max-iterations 30 --completion-promise "DONE"
```

## 8. 2レーン振り分け基準

| タスク例 | レーン | 理由 |
|---------|--------|------|
| 機能実装 | 🦞→Claude Code | 設計判断+複数ファイル変更 |
| バグ修正（複雑） | 🦞→Claude Code | 調査+修正+テスト |
| git status確認 | Telegram→Jarvis | 1コマンド |
| 天気・雑談 | Telegram→Jarvis | AI不要 or 軽量 |
| /debate | Telegram→Jarvis | 既存機能 |
| /imagine, /edit | Telegram→Jarvis | 既存メディアパイプライン |
| リファクタリング | 🦞→Claude Code | subagent並列テスト |
| nightly自律タスク | ralph-loop→Claude Code | 🦞不要（事前指示書） |

**判断者: 常にDJまたは🦞。Jarvisは振り分けしない。**

## 9. エラーリカバリ

| 障害 | 検知 | 復旧 |
|------|------|------|
| exec bridge失敗 | 🦞がエラー確認 | 🦞が再投入 |
| Claude Code失敗 | Stop hookで「FAIL」通知 | DJが🦞に報告→再設計 |
| Telegram通知漏れ | DJが気づく | exec bridge --check で結果確認 |
| M1ダウン | Poller watchdog + heartbeat | 自動再起動（3層防御） |

## 10. 既存インフラとの関係

| コンポーネント | v2での状態 | 理由 |
|---------------|-----------|------|
| exec bridge (exec.sh) | 維持 | 🦞の入口として引き続き使用 |
| Task Poller | 維持 | exec bridge実行に必要 |
| Poller Watchdog | 維持 | Poller生存保証 |
| Gateway | 維持 | exec bridgeバックエンド |
| Auto-Kick | 保険のまま | Claude Code CLIにはタイムアウトなし |
| Jarvis Bot | 維持（軽いタスク用） | /debate, /ai, /imagine 等 |
| Layer 2自動記憶 | 維持 | /ai セッション管理 |
| 4層API封鎖 | 維持 | 最重要ルール |

## 11. 移行チェックリスト（一括）

- [ ] .claude/settings.json にenv追加（timeout + autocompact）
- [ ] scripts/croppy-done.sh 改修（Telegram直接通知+結果情報）
- [ ] sandbox有効化テスト
- [ ] ralph-wiggum導入テスト
- [ ] 🦞からexec bridge --fire でclaude -p 実行テスト
- [ ] Stop hook → Telegram通知テスト
- [ ] E2Eテスト: 🦞→exec bridge→Claude Code→git push→Telegram通知
- [ ] docs/FEATURE-CATALOG.md 更新
- [ ] croppy-notes.md 更新
- [ ] git commit + push

## 12. 成功基準

1. 🦞が1回のexec bridge --fireでClaude Codeタスクを起動できる
2. Claude Codeがsandbox内で自律的にコード変更+テスト+git pushできる
3. 完了時にDJのTelegramに結果通知が届く
4. 🦞のセッションが死んでもタスクは完走する
5. Jarvisの既存機能（/debate, /imagine等）に影響なし


## 13. E2Eテスト結果（2026-02-16）

### 成功パターン（確定）
```
bash exec.sh --fire "cd ~/claude-telegram-bot && nohup claude -p --dangerously-skip-permissions 'タスク' > /tmp/claude-code-output.log 2>&1 & echo SPAWNED"
```

### 失敗パターンと修正
| 問題 | 原因 | 修正 |
|------|------|------|
| claude -p がハング | パーミッション確認（非対話環境） | --dangerously-skip-permissions |
| PollerがSIGTERM | claude -pがメモリ食い→macOSがPoller殺す | nohup ... & で独立プロセス化 |
| stuckタスクがrunningのまま | Gateway Cleanup日付フォーマット不一致 | 要修正（ISO vs SQLite） |

### 確認済みフロー
1. exec bridge --fire → Poller即完了（nohup spawn）
2. nohup claude -p → 独立プロセスで自律実行
3. Claude Code → git log実行 → 正しい結果
4. Stop hook → croppy-done.sh → Telegram直接通知
5. auto-handoff.py → セッション保存
6. Poller watchdog → SIGTERM後の自動復旧（3回確認）
