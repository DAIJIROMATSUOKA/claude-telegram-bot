# claude.ai 案件別AIオーケストレーション 設計仕様書

**作成日:** 2026-03-14
**ディベート参加:** Claude (Opus 4.6) / Gemini / ChatGPT
**ステータス:** 設計確定、実装前

---

## 1. 概要

claude.ai Internal APIを使い、案件ごとにclaude.aiチャットを自動作成・運用する。
全情報（Gmail/LINE/iMessage/Telegram）がInboxを経由して適切なチャットに自動振り分けされ、
各案件チャットがその案件の全文脈を保持する。

**DJの大原則:** 「Telegramへの最初の投稿以外は何もしない」

---

## 2. 設計決定（ディベート確定 7項目）

### 【決定1】レート制限回避は不可能
- **結論:** 全経路（Web UI / CLI / Chrome操作 / Python script）が同一アカウントquotaを消費。別プールは存在しない
- **全会一致:** 3/3
- **現実的対策:** Sonnet/Haikuで済むタスクをOpusに流さない。Inboxルーティング・定型判断はSonnet、設計判断のみOpus
- **却下案:** Claude→Jarvis(CLI)→Claude中継（逆に2回分消費）、Chrome UI操作経路（同じcompletion API）

### 【決定2】ACCESS DBは専用チャット不要
- **結論:** MCPツール/サービスとして各案件チャットから直接呼ぶ
- **全会一致:** 3/3
- **実装方式:** 案件チャット初回起動時にACCESSからスナップショット注入（customer, MNo, quote rev, dates, BOM/status, open risks）。以降は差分更新のみ
- **却下案:** ACCESS専用チャット分離（ホップ追加でコンテキスト分断、チャット間依存が脆弱）

### 【決定3】最大の脆弱点は非公開API + sessionKey依存
- **結論:** Anthropic側の仕様変更一発で全系統停止。SLAゼロ
- **全会一致:** 3/3
- **緩和策:**
  - chatlog-api.pyで5分毎にObsidianミラー（コンテキスト喪失ゼロ）
  - sessionKey失効時→Telegram即通知→手動復旧2分
  - Jarvisのローカルキュー（API死亡時にメッセージをバッファ、復旧後に再送）
- **受容:** 非公式APIのリスクは承知の上で利用。公式APIが従量課金のみである限り代替なし

### 【決定4】Inboxルーティングはハイブリッド
- **結論:** コード先行（高確信ルール）→ Claude fallback（曖昧なもの）
- **全会一致:** 3/3（Round 2で収束）
- **コード層（0コスト・0レイテンシ）:**
  - M番号regex（obsidian-writer.ts既存）→ 該当案件チャットへ直行
  - 送信元アドレス→顧客マッピング（既知クライアントのメール→案件）
  - 明示的コマンド（`/ask M1319 ...`）→ 直行
  - 返信スレッド継続 / 直近チャットaffinity
  - 安全/納期キーワード → 強制レビューパス
- **Claude層（Sonnet使用、Opus禁止）:**
  - コード層で判定不能な残りのみ
  - confidence score付きで判断
  - 全ルーティング判断を監査ログに記録（コード層も含む）
- **却下案:** Claude-first一任（quota浪費。1日50通中30通はregexで捌ける）

### 【決定5】DJ Cloneはspec文書 + 判断ログ二層構造
- **結論:** 長期チャットではなく、バージョン管理されたファイルが正本
- **全会一致:** 3/3（Round 2で収束）
- **構造:**
  - `DJ-SPEC.md` — 現時点の判断基準（月1更新、git管理）
    - 例: 「見積は粗利35%以下なら断る」「伊藤ハム案件は最優先」
    - claude.ai Project Knowledgeとして全チャットに注入
  - `DJ-DECISIONS.ndjson` — 個別判断ログ（append-only）
    - 形式: `{date, context, decision, reason, rejected_alternatives}`
    - specに昇格させるべきパターンの原料
  - チャットは作業面（DJとの会話でspec更新案を議論）、正本はファイル
- **設計原則:** 「明文化できないならまだAIに委任できない」（Claude指摘）
- **却下案:** 長期チャット一本（自己矛盾が蓄積、3ヶ月前の判断が新しい判断を汚染）

### 【決定6】夜間ログは外部保存 + 要約のみ投稿
- **結論:** 全ログ→Obsidian直書き、チャットにはチェックポイント要約のみ
- **全会一致:** 3/3（Round 2で収束）
- **分割:**
  - **外部（Obsidian）:** 実行ログ、ツール出力、diff、エラー、メトリクス
    - パス: `nightly-forge/YYYY-MM-DD.md`
  - **チャット投稿（5行以内）:** 計画、実行アクション、変更内容、ルールチェック結果、次アクション
- **Nightly Forgeエントリポイント:** DESIGN-RULES.md読み込みをハードコード（読まずに着手禁止をコードレベルで強制）
- **チェックポイント構造（ChatGPT提案）:**
  1. goal and constraints loaded
  2. actions taken
  3. changes made
  4. rule checks passed/failed
  5. next resume point
- **却下案:** 全ログをチャットに残す（chatlog mirrorと二重保存、quota浪費、コンテキスト肥大化）

### 【決定7】auto-handoffは最優先実装
- **結論:** トークン上限到達 = 記憶喪失 = 最悪の障害パターン
- **Claude独自指摘（他2社も暗に同意）**
- **実装方針:** トークン使用量を監視 → 閾値到達で自動要約 → 新チャット作成 → extracted_contentで文脈引き継ぎ
- **依存:** usage API（確認済み）、チャット作成API（確認済み）、extracted_content（確認済み）

---

## 3. アーキテクチャ

```
[情報源]                    [Jarvis (M1)]              [claude.ai]
Gmail ─┐                   ┌─ コード層 ───────┐
LINE ──┤→ Telegram Bot ──→│  M番号regex      │→ 案件チャット (M1317, M1319...)
iMsg ──┤    (Grammy)       │  送信元マッピング │→ 汎用チャット検索→投稿
Tel ───┘                   │  コマンド解析     │→ Inboxチャット (Claude判断)
                           └──────────────────┘
                                  ↕ exec bridge
                           [M1 ローカル]
                            Access DB (mdb-tools / PowerShell)
                            Dropbox 案件フォルダ
                            Obsidian ミラー
```

### レイヤー構成

| レイヤー | 責務 | 知性 |
|----------|------|------|
| Telegram (DJ面) | 入力受付・結果表示 | なし |
| Jarvis (実行層) | ルーティング・API転送・コマンド実行 | コード判断のみ |
| claude.ai (思考層) | 案件理解・意思決定・文脈蓄積 | AI |
| Obsidian (記録層) | 全ログ・チャットミラー・判断ログ | なし |
| Access DB (データ層) | 構造化業務データ | なし |

### チャット種別

| チャット | モデル | 用途 |
|----------|--------|------|
| Inbox | Sonnet | 曖昧メッセージのルーティング判断 |
| 案件別 (M1317等) | Opus | 案件の全文脈保持・設計判断 |
| DJ Clone → DJ-SPEC.md | — | ファイルとして管理（チャット不要） |
| Nightly | Sonnet (基本) / Opus (設計変更時) | 夜間自律改善 |

---

## 4. ファイル責務

| ファイル | 場所 | 役割 |
|----------|------|------|
| `src/handlers/orchestrator.ts` | 新規 | Inboxルーティングコード層 + claude.ai API呼び出し |
| `src/utils/claude-ai-client.ts` | 新規 | claude.ai Internal API クライアント（認証・CRUD・completion・upload） |
| `src/utils/project-chat-manager.ts` | 新規 | 案件UUID↔チャットUUIDマッピング管理 |
| `src/utils/auto-handoff.ts` | 新規 | トークン監視 → 自動要約 → 新チャット引き継ぎ |
| `DJ-SPEC.md` | docs/ | DJ判断基準の正本 |
| `DJ-DECISIONS.ndjson` | docs/ | 判断ログ（append-only） |
| `nightly-forge/YYYY-MM-DD.md` | Obsidian | Nightly実行ログ |

---

## 5. 主要機能一覧

| # | 機能 | 依存 |
|---|------|------|
| F1 | claude-ai-client（API抽象化） | sessionKey, webapp-chat-api skill |
| F2 | 案件チャット自動作成 + UUIDマッピング | F1, Access DB |
| F3 | 案件チャット初回コンテキスト注入（フォルダ+ACCESS） | F1, F2, mdb-tools |
| F4 | コード層ルーティング（M番号/送信元/コマンド） | obsidian-writer.ts既存拡張 |
| F5 | Claude層ルーティング（Sonnet, Inbox経由） | F1 |
| F6 | 監査ログ（全ルーティング判断記録） | croppy-notes or 専用ファイル |
| F7 | auto-handoff（トークン監視→引き継ぎ） | F1, usage API |
| F8 | Nightly Forge v2（外部ログ+要約投稿） | F1, F7, DESIGN-RULES.md |
| F9 | DJ-SPEC.md / DJ-DECISIONS.ndjson 管理 | Project docs API |

---

## 6. 実装方針

DESIGN-RULES §3に従い、**一気実装 + フォールバック設計**。

- 各機能を独立させ、1つ失敗しても他が動く構造
- F1（APIクライアント）が基盤。これが最初
- F2-F6は全てF1に依存するが互いに独立
- F7（auto-handoff）はF1確定後に実装
- F8（Nightly v2）はF1-F7全て安定後

**フォールバック:**
- claude.ai API死亡時 → Jarvisがローカルキューにバッファ、Telegram通知
- sessionKey失効 → chatlog mirrorで文脈保全、手動復旧後にキュー再送
- 案件チャット未作成 → Inboxチャットにフォールバック投稿

---

## 7. リスクと緩和策

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| Anthropic API変更 | 全系統停止 | Obsidianミラーで文脈保全、キュー化で再送 |
| sessionKey失効 | 一時的に投稿不能 | 5分ポーリング延命、403→即通知、復旧2分 |
| Opusクォータ枯渇 | 案件チャット応答停止 | ルーティングはSonnet、usage API監視 |
| トークン上限 | 記憶喪失 | auto-handoff（最優先実装） |
| 誤ルーティング | 案件情報が別チャットに流出 | 監査ログ + Nightly検出 |

---

## 8. 未決事項（Round 2送り → 実装フェーズで判断）

- ミスミ請求書→ACCESS自動追記フロー
- ファイル監視（請求書フォルダ）
- Telegram投稿削除のAI判断
- DXF→STEP専用チャット要否
- フォルダ構造ルール化
- 週次レポート自動生成
- Chrome tab管理廃止タイミング
