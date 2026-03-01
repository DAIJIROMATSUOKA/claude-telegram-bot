# Obsidian CLI統合 Phase 2 — 設計仕様書
**ディベート日:** 2026-03-01
**参加AI:** Claude (Opus) × Gemini × ChatGPT
**モデレーター:** クロッピー🦞
**最終承認:** DJ

---

## [DECIDED] 確定事項一覧

### A) Inbox→自動実行ループ [Round 1全員一致]
**概要:** DJがObsidianに1行書く→JARVISが検知→実行→結果記録

**アーキテクチャ:**
- `00_Inbox/jarvis.md` をJARVIS専用インボックスとする
- LaunchAgent（5分間隔ポーリング）で変更検知
- `obsidian-cli read` で内容取得→ `claude -p` で実行
- 結果を `daily:append` で記録 + Telegram通知
- 処理済み行はアーカイブまたは削除

**設計原則:**
- Telegramを**置き換えず補完**する（急ぎ=Telegram、非同期=Obsidian inbox）
- fswatch不要。既存LaunchAgentパターンで実装
- 行ID（timestamp+hash）で冪等化
- `CONFIRM:` タグなし破壊操作は禁止

**安全設計（ChatGPT提案採用）:**
- 00_Inbox/JARVIS_state.md に処理済み台帳
- 重複実行防止: 行IDで既処理チェック

---

### C) 文脈ブリーフィング [Round 1全員一致]
**概要:** 朝のブリーフィングが過去daily noteを参照して文脈を持つ

**アーキテクチャ:**
- ブリーフィング生成時に `obsidian-cli read` で過去7日分daily noteを取得
- 未完了タスク抽出、繰り返しパターン検出、前日要約を織り込む
- 既存ブリーフィングスクリプトに5-10行追加で実装

**ノイズ対策（ChatGPT提案採用）:**
- タグ駆動: `#decision` `#risk` `#next` だけ拾う
- 上限行数固定

---

### D) ファイル配置 [Round 2 全員一致 + DJ裁定]

| ファイル | 現在の場所 | 移行先 | 理由 |
|---------|-----------|--------|------|
| M1.md | `autonomous/state/M1.md` | **変更なし** | 毎秒書換→iCloud同期コンフリクト致命的 |
| WIP.md | `autonomous/state/WIP.md` | `MyObsidian/90_System/JARVIS/WIP.md` | 低頻度更新→iPhoneから閲覧可能に（DJ裁定） |
| JARVIS-Journal/* | `Dropbox/.../JARVIS-Journal/` | `MyObsidian/90_System/JARVIS/Journal/` | 検索・バックリンク・モバイル閲覧 |
| croppy-notes.md | `10_Projects/croppy-notes.md` | **変更なし**（移行済み） | — |

**移行方法:** 物理移動のみ。シンボリックリンク不可（iCloudが`.icloud` evictionファイル生成するリスク）

---

## 却下された提案と理由

### B) Basesタスクダッシュボード → 後回し
- **理由:** Bases仕様がまだ安定していない。プラグイン依存リスク。基盤（A, C, D）完成後に再検討。
- **投票:** Claude(言及なし) / Gemini(後回し) / ChatGPT(優先3だが後回し合意)

### E) eval活用 → 現時点で不要
- **理由:** CLI標準コマンドで全要件を満たせる。evalは複雑性を増すだけ。
- **投票:** Claude(言及なし) / Gemini(後回し) / ChatGPT(不要と明言)

### M1.mdのObsidian統合 → 却下
- **理由:** Claude Codeが毎秒書き換え→iCloud `bird`デーモンが同期イベント多発→コンフリクトファイル(`M1 2.md`)生成→`.icloud` evictionで`cat M1.md`失敗→自律ループ死。
- **FA比喩（Claude）:** PLCのリアルタイム変数をMESデータベースに入れないのと同じ。
- **投票:** 全員一致で却下

### 全ファイル一元化 → 却下
- **理由:** 「全部一元化」ではなく「用途別最適化」が正解。制御系（M1.md）はローカル安定、知識系（Journal/WIP）はObsidianで活用。
- **Gemini修正:** Round 1では全面統合を主張→Round 2でClaude側に合流

---

## 実装フェーズ

### Phase 0: iCloud遅延検証（1日）
- iCloud vault上のファイル変更がM1ローカルに反映される時間を計測
- 5分ポーリングで十分かの確認

### Phase 1: D) ファイル移行（1日）
- JARVIS-Journal → `90_System/JARVIS/Journal/` 物理移動
- WIP.md → `90_System/JARVIS/WIP.md` 物理移動
- WIP.mdの読み書きパスをJARVIS/Claude Code側で更新
- 既存スクリプト（memory-sync.sh, generate-journal.sh）のパス更新

### Phase 2: C) 文脈ブリーフィング（1日）
- ブリーフィングスクリプトに `obsidian-cli read` 追加
- 過去7日分daily note取得→タグベース抽出→テンプレ追記

### Phase 3: A) Inbox自動実行ループ（1週間）
- `00_Inbox/jarvis.md` 作成
- LaunchAgent（5分ポーリング）設定
- 行パース→コマンド抽出→実行→結果記録→処理済み管理
- CONFIRM:ゲート実装

---

## ディベート記録

### Round 1: 全体アーキテクチャ
- **全員一致:** A) Inbox自動実行、C) 文脈ブリーフィング
- **論争:** D) M1.md/WIP.mdの扱い
- **合意:** B) Bases後回し、E) eval不要

### Round 2: D)深掘り — M1.md/WIP.md統合問題
- **全員一致:** M1.mdフラット維持、JARVIS-Journal vault移行、symlink不可
- **2:1分裂:** WIP.md（Claude/Geminiフラット vs ChatGPT Vault統合）
- **DJ裁定:** WIP.md → Vault統合（ChatGPT案採用）
