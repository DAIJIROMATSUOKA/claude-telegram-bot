# HANDOFF自動化仕様書
**作成日:** 2026-02-15
**ステータス:** Phase 1-2 設計完了 / Phase 3-5 概要のみ

---

## 1. 概要

### Goal（1文）
セッション引き継ぎ（HANDOFF）を手動Markdown作成からClaude Code Auto Memory + Hooksベースの自動永続化に移行し、DJの引き継ぎ工数をゼロにする。

### 背景
現状のHANDOFF運用は毎回30-60分のコストがかかる。claude.ai（🦞）→ 手動HANDOFF作成 → 新チャット → exec bridgeで読み込みの4ステップ。Claude Code 2.1のTasks + Auto Memory + Hooksで、この手動フローを自動化できる。

### 制約
- 従量課金API使用禁止（Max契約のCLI利用のみ）
- 既存のexec bridge + Pollerは安定稼働中。一気に全置き換えはしない
- M1 MAX（mothership）で実行

---

## 2. フェーズ分割

| Phase | 内容 | リスク | 前提条件 |
|---|---|---|---|
| **Phase 1** | M1にClaude Code CLIインストール + 動作確認 | 低 | なし |
| **Phase 2** | Auto Memory導入でcroppy-notes.md置き換え | 低 | Phase 1完了 |
| **Phase 3** | Stop hookでセッション終了時自動HANDOFF生成 | 中 | Phase 2完了 |
| **Phase 4** | Tasks + headless cronで夜間自律実行 | 中 | Phase 3完了 |
| **Phase 5** | exec bridge → Claude Code CLI完全移行 | 高 | Phase 4安定稼働 |

**Phase移行条件:** 各Phaseで1週間以上の安定稼働を確認後に次Phaseへ。

---

## 3. Phase 1: Claude Code CLIインストール + 動作確認

### ファイル責務
| ファイル/ディレクトリ | 役割 |
|---|---|
| `/usr/local/bin/claude` | Claude Code CLI本体 |
| `~/claude-telegram-bot/CLAUDE.md` | 既存マスター指示書（Claude Code共用） |
| `~/.claude/settings.json` | Claude Code設定（permissions, hooks等） |
| `~/.claude/projects/claude-telegram-bot/memory/` | Auto Memory格納先 |

### 主要タスク
1. **CLIインストール:** `npm install -g @anthropic-ai/claude-code`
2. **認証:** Max契約アカウントでログイン（`claude login`）
3. **動作確認:** `cd ~/claude-telegram-bot && claude -p "CLAUDE.mdを読んで、JARVISプロジェクトの概要を1文で説明して"`
4. **従量課金チェック:** APIキー直接使用ではなくMax契約CLIであることを確認
5. **headless動作確認:** `claude -p "ls src/ の結果を教えて" --output-format json`

### 完了条件
- [ ] `claude --version` でバージョン表示
- [ ] Max契約認証でログイン成功
- [ ] headless mode (`claude -p`) で応答取得
- [ ] 従量課金APIキー不使用を確認（.envにANTHROPIC_API_KEY無し）
- [ ] 既存Jarvis + Pollerに影響なし

### [DECIDED] 設計決定
- **Claude Code CLIはJarvisとは独立に動かす。** Jarvisプロセスに統合しない（Poller独立化と同じ思想）
- **CLAUDE.mdは既存ファイルを共用。** Claude Code用に別ファイルは作らない
- **M1のみに導入。** M3は当面不要（M1がmothership）

### [DECIDED] 却下案
- Jarvisのsrc/内にClaude Code連携コードを追加 → 共倒れリスク、却下
- Docker内でClaude Code実行 → M1のファイルシステムアクセスが必要、却下

---

## 4. Phase 2: Auto Memory導入

### ファイル責務
| ファイル/ディレクトリ | 役割 | 現状の対応物 |
|---|---|---|
| `~/.claude/projects/claude-telegram-bot/memory/MEMORY.md` | 自動記憶インデックス（200行上限） | croppy-notes.md |
| `~/.claude/projects/claude-telegram-bot/memory/architecture.md` | 設計決定の記録 | HANDOFF「設計原則」 |
| `~/.claude/projects/claude-telegram-bot/memory/lessons.md` | 教訓 | HANDOFF「学んだ教訓」 |
| `~/.claude/projects/claude-telegram-bot/memory/task-state.md` | タスク状態 | HANDOFF「残タスク」 |
| Dropbox croppy-notes.md | 引き続き使用（バックアップ） | — |

### 主要タスク
1. **Auto Memory有効化:** `CLAUDE_CODE_DISABLE_AUTO_MEMORY=0` を環境変数に設定
2. **初期MEMORY.md作成:** 既存croppy-notes.md + HANDOFF最新版の内容をMEMORY.mdに移植
3. **トピックファイル初期化:** architecture.md, lessons.md, task-state.mdを既存HANDOFFから抽出
4. **同期スクリプト作成:** MEMORY.md → croppy-notes.md への自動同期（cron、5分間隔）
5. **動作確認:** 新セッション開始時にMEMORY.mdの内容が自動ロードされることを確認

### 同期スクリプト設計（memory-sync.sh）
```bash
#!/bin/bash
# Auto Memory → croppy-notes.md 同期
SRC="$HOME/.claude/projects/claude-telegram-bot/memory/MEMORY.md"
DST="$HOME/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md"
if [ "$SRC" -nt "$DST" ]; then
  cp "$SRC" "$DST"
  echo "[memory-sync] $(date): synced" >> /tmp/memory-sync.log
fi
```

### 完了条件
- [ ] Auto Memoryディレクトリ自動作成を確認
- [ ] MEMORY.mdに既存状態を移植完了
- [ ] 新セッションでMEMORY.md内容が自動ロードされる
- [ ] 同期スクリプトがcron動作
- [ ] 既存croppy-notes.mdがバックアップとして維持される
- [ ] JARVIS Journal（23:55）との整合性確認

### [DECIDED] 設計決定
- **croppy-notes.mdは廃止しない。** Auto Memory → croppy-notes.md の一方向同期でバックアップ維持
- **MEMORY.mdは200行以内に収める。** 詳細はトピックファイルに分離（Claude Code公式推奨）
- **HANDOFF_YYYY-MM-DD.mdは当面併用。** Phase 3でStop hookが安定するまで手動HANDOFFも継続

### [DECIDED] 却下案
- croppy-notes.md → MEMORY.md の逆方向同期 → 🦞のclaude.ai書き込みとClaude Code書き込みが衝突する。一方向のみ
- MEMORY.mdをDropboxに直接置く → Claude Codeの規定パス（~/.claude/）外になるため不可

---

## 5. Phase 3-5 概要（詳細は着手時に作成）

### Phase 3: Stop hookでセッション終了時自動HANDOFF
- Stop hookでPythonスクリプト発火
- git diff + Tasks状態 + MEMORY.md → HANDOFF_auto.md を自動生成
- Dropbox JARVIS-Journalに保存
- Telegram通知

### Phase 4: Tasks + headless cronで夜間自律実行
- `CLAUDE_CODE_TASK_LIST_ID="jarvis-nightly"` でタスクリスト永続化
- cron 23:00に `claude -p "task-state.mdの未完了タスクを順番に実行" --dangerously-skip-permissions`
- Hooks（PostToolUse）でテスト自動実行 + 失敗時修正ループ
- 既存Darwin Engine（23:00-02:45）との統合

### Phase 5: exec bridge → Claude Code CLI完全移行
- claude.ai（🦞）からの指示をClaude Code CLIで直接実行
- exec bridge + Memory Gateway + Pollerを段階的に廃止
- 最終形: DJ → claude.ai → Claude Code CLI on M1 → 実行・永続化・引き継ぎすべて自動

---

## 6. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Claude Code CLIがMax契約で従量課金される | 🔴 致命的 | Phase 1で徹底確認。APIキー不使用を検証 |
| Auto MemoryがMEMORY.mdを壊す | 🟡 中 | croppy-notes.mdバックアップ + git管理 |
| Claude Code CLI更新で破壊的変更 | 🟡 中 | バージョン固定（npm install -g @anthropic-ai/claude-code@2.1.x） |
| 既存Jarvis + Pollerとの干渉 | 🟡 中 | プロセス分離。Claude CodeはJarvisをimportしない |
| headless mode夜間実行が暴走 | 🟡 中 | --allowedToolsで権限制限 + hookでガード |

---

## 7. 投票結果（ディベート/レビュー履歴）

| 日付 | 参加者 | 内容 |
|---|---|---|
| 2026-02-15 | 🦞 + ChatGPT | X情報取得ディベート中にClaude Code Tasks発見 |
| 2026-02-15 | 🦞 単独 | web_search調査 → Phase分割設計 |
| — | DJ承認待ち | Phase 1着手判断 |

---

## 8. 参考リンク

- [Claude Code Tasks - VentureBeat](https://venturebeat.com/orchestration/claude-codes-tasks-update-lets-agents-work-longer-and-coordinate-across)
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)
- [Claude Code Memory管理](https://code.claude.com/docs/en/memory)
- [Hooks完全ガイド](https://claudelog.com/mechanics/hooks/)
- [Shrivu Shankar - How I Use Every Feature](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- [Auto-handoff Stop hookパターン](https://psantanna.com/claude-code-my-workflow/workflow-guide.html)
