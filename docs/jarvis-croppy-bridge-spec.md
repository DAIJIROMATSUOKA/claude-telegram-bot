# Jarvis→Croppy Bridge 仕様書（夜間現場監督システム）
**作成日:** 2026-03-04
**ディベート:** Gemini × ChatGPT × 🦞 3AI評議会
**PoC:** 2026-03-04 全テスト合格（同時応答・E2E双方向通信）

---

## 概要

JarvisがM1のosascript経由でChrome上のclaude.aiタブにテキストを投入し、🦞（クロッピー）を能動的に起動する仕組み。🦞はclaude.ai専用ツール（Gmail MCP, Google Drive, Slack, memory, web search）で作業し、結果をexec bridge経由でM1に返す。

**DJの操作: Telegramに1行投げるだけ。**

---

## アーキテクチャ

```
DJ (Telegram)
  | 1行指示
Jarvis (Grammy Bot, M1)
  | osascript -> Chrome JS injection
🦞 Tab [J-WORKER-1] (claude.ai, Project固定)
  | bash_tool -> exec.sh
Gateway (CF Worker)
  | poll
Poller (M1)
  | execute
M1 -> notify-dj.sh -> Telegram -> DJ
```

### 双方向通信（PoC実証済み）
- **Jarvis→🦞:** osascript → Chrome tab JS → ProseMirror insertText + Enter keydown
- **🦞→M1:** exec bridge (Gateway → Poller)
- **M1→DJ:** notify-dj.sh → Telegram

---

## DECIDED（3AI全員一致 + DJ承認）

### Q1: タブ構成 → A案・2タブ固定
- **Tab [J-WORKER-1]:** メイン作業用（Gmail MCP, Drive, コード, 調査等）
- **Tab [J-WORKER-2]:** 予備/並列作業用
- ルーティングはJarvis側で判断（タスク種別→タブ割当）
- 3タブ以上は過剰（DJ1人運用）

### Q2: 起動戦略 → C案・ハイブリッド
- **夜間（22:00-08:00）:** 常時タブ開放 + caffeinate
- **日中:** オンデマンド（Jarvisが必要時にのみ使用）
- LaunchAgent `com.jarvis.nightshift` で caffeinate 制御

### Q3: コンテキスト管理 → A案・Project固定
- 各タブに専用Claude Project（instructions + memory）
- 定期ローテーション不要（auto-compactに任せる）
- 障害時のみ新チャット切替（復旧フローの一環）

### Q4: セキュリティ → A+C（Telegram制限 + Project制限）
- TELEGRAM_ALLOWED_USERSで入口制限（既存）
- Project instructionsで🦞の行動範囲を定義
- **外部送信（メール/Slack）: 自動実行OK**（DJ承認不要）
- **削除/移動: 自動実行OK**（DJ承認不要）
- ホワイトリスト/二段階コミットは不要（DJ判断）

### Q5: 障害復旧 → タイトルマーキング + caffeinate + 自動復旧
- タブタイトルに `[J-WORKER-N]` を注入（識別+生死確認）
- 夜間 caffeinate でM1スリープ防止
- タブ消滅検知 → 自動再生成 + Project URL再オープン
- 🦞無応答 → タイムアウト → DJ通知 + リトライ

### Q6: 日中共存 → タイトルベースタブ特定
- osascriptはタイトルに `[J-WORKER` を含むタブのみ操作
- DJのアクティブチャットには絶対に触らない
- 専用Chromeプロファイルは不要（MCP再設定コスト大）

---

## 実装設計

### 1. タブマネージャ（scripts/croppy-tab-manager.sh）

機能:
- list: [J-WORKER]タブ一覧取得
- health: 各タブの生死・BUSY/READY確認
- inject W:T "message": 指定タブにメッセージ投入
- open URL: 新タブでclaude.ai Project URLを開く
- mark W:T "label": タブタイトルにラベル注入
- recover: 消滅タブを自動再生成

**タブ特定ロジック:**
osascript内でtab title contains "[J-WORKER" → 操作対象。それ以外 → 絶対にスキップ。

**タイトルマーキング（JS injection）:**
```javascript
document.title = '[J-WORKER-1] ' + document.title.replace(/\[J-WORKER-\d+\]\s*/g, '');
```

### 2. ディスパッチャ（src/handlers/croppy-bridge.ts）

Telegram `/bridge` コマンド or 自動トリガー → タブ選択 → メッセージ投入

フロー:
1. タブ健全性チェック（croppy-tab-manager.sh health）
2. READYタブを選択（全BUSY→復旧試行）
3. Worker用プロンプトを構築してタブに投入
4. DJ通知「🦞 Worker N に投入完了」

### 3. Worker Project Instructions テンプレート

```
# 🦞 Jarvis Worker Mode

あなたはJarvis AIアシスタントのWorkerです。
Jarvisから自動投入されるタスクを実行します。

## ルール
1. タスクを受け取ったら即座に実行開始
2. 作業完了後、必ず exec bridge で結果をM1に返す
3. 最後に notify-dj.sh でTelegram通知
4. エラー時も必ず通知（成功/失敗を明確に）
5. 外部送信（メール/Slack）は許可されている。DJ承認不要
6. 不明点があればTelegram経由でDJに質問（notify-dj.shで）

## 利用可能ツール
- Gmail MCP（メール読取/送信/アーカイブ）
- Google Drive（ファイル検索/読取）
- Slack MCP（メッセージ読取/送信）
- Web Search（調査/最新情報取得）
- exec bridge（M1コマンド実行）
- Memory（過去の会話記録）

## 禁止事項
- DJの明示的指示なしに大量メール送信しない
- git push --force 禁止
- rm -rf 系の破壊コマンド禁止
```

### 4. Nightshift LaunchAgent（com.jarvis.nightshift）

scripts/nightshift.sh:
- 22:00: caffeinate -dims 開始 + PID保存
- 22:00: Chrome Project URLオープン + タイトルマーキング
- 08:00: caffeinate停止 + タブクローズ（任意）
- ディスプレイスリープは許可（-d省略可）、システムスリープ禁止（-i -m -s）

### 5. ヘルスチェック（com.jarvis.croppy-health）

60秒間隔で:
1. `[J-WORKER]` タブ存在確認
2. 各タブの READY/BUSY 状態確認（Stop Responseボタン有無）
3. 消滅検知 → 自動復旧（URL再オープン + マーキング）→ Telegram通知
4. Chrome自体のクラッシュ検知 → Chrome再起動 → タブ再生成

---

## ファイル一覧

| ファイル | 役割 |
|---------|------|
| scripts/croppy-tab-manager.sh | タブ操作（list/health/inject/open/mark/recover） |
| scripts/nightshift.sh | 夜間caffeinate + タブ起動/停止 |
| src/handlers/croppy-bridge.ts | Telegramコマンド + 自動ディスパッチ |
| com.jarvis.nightshift.plist | 夜間スケジュール（22:00-08:00） |
| com.jarvis.croppy-health.plist | ヘルスチェック（60秒間隔） |
| docs/jarvis-croppy-bridge-spec.md | この仕様書 |

---

## 自動トリガー（将来拡張）

Jarvisが🦞を自動起動するトリガー:
1. **Scout異常検知** → 🦞にDrive/Gmail調査を依頼
2. **Gmail重要メール** → 🦞に返信ドラフト作成を依頼
3. **LINE顧客問い合わせ** → 🦞に技術回答を依頼
4. **cron定期タスク** → 🦞に日次レポート作成を依頼

---

## 却下案と理由

| 案 | 理由 |
|----|------|
| 3+タブ構成 | DJ1人運用で管理コスト過剰 |
| 司令塔タブ（GPT案） | ルーティングはJarvisの責務。🦞に🦞を指揮させるのは循環参照 |
| 動的ルーティング（B案単独） | Jarvis側ロジック複雑、デバッグ困難 |
| 専用Chromeプロファイル | MCP再設定コスト、ログイン管理が増える |
| 二段階コミット | DJ判断: 全自動でいい。承認フロー不要 |
| JSON出力プロトコル | claude.aiの🦞はJSON出力に不向き、exec bridge結果で十分 |
| 定期ローテーション | auto-compactで十分、障害時のみ新チャット |
| シングルタブ+キュー（C案） | 並列性の利点が消える |

---

## PoC結果（2026-03-04）

| テスト | 結果 |
|--------|------|
| 非アクティブタブへのJS実行 | PASS |
| テキスト投入+送信（単発） | PASS |
| 2タブ同時投入+同時応答 | PASS（Max Plan同時制限なし） |
| E2E: Jarvis→🦞→exec bridge→M1ファイル | PASS |
| 複雑メッセージのエスケープ | 要改善（特殊文字処理） |
