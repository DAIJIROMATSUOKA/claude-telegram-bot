# Scout Agent 仕様書
# v1.0 — 自律的タスク発見 + Telegram提案

---

## 概要

Claude Codeが毎朝コードベース・システム状態を巡回し、改善点をTelegramに番号付きリストで送信。
DJが番号で返信 → 即実行。

### DJ運用イメージ
```
06:30 Telegram通知: 🔭 Scout Report
  1. session-bridge.ts テストなし
  2. TS error 2件
  3. 未使用export 3件
DJ: "1 2"
→ Claude Codeが自動でテスト追加 + TSエラー修正 → 完了通知
```

---

## フェーズ分割

### Phase 1: スキャン + レポート（読み取り専用）
- コード健康診断（TS errors, テストカバレッジ, dead exports, git要約）
- Telegram送信
- launchd 06:30起動
- **タスクなし検出:** task-state.mdに未完了なし → nightlyもスキップ

### Phase 2: 番号返信 → 自動実行
- JARVIS側に /scout reply handler追加
- 番号 → task-state.mdに登録 or 即実行
- 実行結果をTelegram通知

### Phase 3: ビジネスデータ統合
- Access DB (MLDatabase.accdb) 読み取り
- 見積件数、未回収案件、プロジェクト経過日数
- Morning Briefingとの統合

### Phase 4: システム監視 + アイデア生成
- ディスク残量、OAuthトークン期限、プロセス異常
- 依存パッケージ更新検出
- 新しい自動化提案（MCP連携等）

---

## ファイル責務（Phase 1）

| ファイル | 責務 |
|---------|------|
| scripts/scout-agent.sh | launchd entrypoint. Claude Code起動 + Telegram送信 |
| scripts/scout-scan.md | Claude Codeへのスキャンプロンプト（CLAUDE.md的役割） |
| com.jarvis.scout.plist | launchd agent（毎朝06:30） |

### 設計判断
- scout-agent.sh はjarvis-nightly.shと同構造（実績あり）
- スキャンロジックはClaude Codeのプロンプトに集約（コード不要）
- レポート形式はTelegram互換テキスト（HTML不要）
- 1回のClaude Code呼び出しで全スキャン完了（ループ不要）

---

## Phase 1 完了条件
1. `scripts/scout-agent.sh` が Claude Code を呼び出してスキャン実行
2. スキャン結果が Telegram に番号付きで送信される
3. launchd で毎朝 06:30 に自動起動
4. task-state.md が全完了なら nightly をスキップする修正も含む
5. DJ が M1 ターミナルで手動実行してレポートが届くことを確認

---

## 絶対守るルール
- 従量課金API使用禁止（Claude CLI Max subscription のみ）
- scout-agent.sh 単体で完結（JARVISプロセスに依存しない）
- 失敗してもDJの朝の作業をブロックしない（best-effort）
