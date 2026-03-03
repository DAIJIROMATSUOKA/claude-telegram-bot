
# Telegram Inbox Zero — 仕様書
**Status:** DECIDED (2026-03-03)
**Phase:** 全判断承認済み → 実装準備

---

## 決定事項一覧

### [DECIDED] 判断1: ニュースの流れ → C案
- News→直接Obsidianデイリーノート(##📰News) + Telegram要約1通(朝/夕)
- 却下A: 全件Telegram→ノイズでInbox Zero不可能
- 却下B: Obsidianのみ→DJが見逃すリスク

### [DECIDED] 判断2: Obsidianデイリーノート構造 → セクション分離
```markdown
# YYYY-MM-DD
## 📋 Tasks
## 📰 News
## 💬 Telegram Log
```

### [DECIDED] 判断3: Gmail通知量制御 → D案改良
- category:primary → 個別通知(インラインボタン付き)
- promotions/social/updates → GAS自動アーカイブ
- forums/残り → 朝夕ダイジェスト
- 却下: 全件個別(201通未読の現実→ノイズ地獄)

### [DECIDED] 判断4: 削除UX → アクション=自動削除
- アクション実行成功 → Telegramメッセージ自動削除
- スヌーズボタン: 1h/3h/明日朝 → 削除+再通知
- OUT送信確認: 5秒後自動削除
- DJ送信指示: bot側で削除
- 却下: 明示的「完了」ボタン(冗長、アクションが完了そのもの)

### [DECIDED] 判断5: OUTアーキテクチャ → 引用リプライ=返信 + コマンド=新規
- 通知への引用リプライ → そのチャネルへの返信
- /gmail, /line, /slack, /cal, /todo, /x → 新規作成
- D1マッピング: telegram_msg_id → {source, source_id, metadata}
- 却下: 全てコマンド方式(引用リプライのほうが自然)

### [DECIDED] 判断6: Apple系 → 受信通知のみPhase 1
- M1スリープなし前提で進行
- Messages受信→Telegram通知(AppleScript/Shortcuts)
- 送信・留守電は実験後
- 却下: 初期から全機能(安定性未検証)

### [DECIDED] 判断7: Obsidianアーカイブ → 削除トリガー+深夜バッチ
- deleteMessage前にObsidianデイリーノートへappend
- 深夜バッチ: 未削除メッセージ検出→翌朝Inbox先頭に再通知
- 却下A: リアルタイム全件書き込み(重複)
- 却下B: バッチのみ(削除済みメッセージが取得できない)

---

## アーキテクチャ

### データフロー
```
[Gmail] --GAS--> [Telegram] <--引用リプライ--> [Grammy Bot] --GAS--> [Gmail送信]
[LINE]  --CF Worker--> [Telegram] <--引用リプライ--> [Grammy Bot] --LINE Push--> [LINEグループ]
[Slack] --Events API--> [Telegram] <--引用リプライ--> [Grammy Bot] --Slack API--> [Slack]
[Apple] --AppleScript--> [Telegram]
[Grammy Bot] --deleteMessage前--> [Obsidian Daily Note]
```

### D1テーブル: message_mappings
```sql
CREATE TABLE message_mappings (
  telegram_msg_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  source TEXT NOT NULL,           -- gmail|line|slack|apple|calendar|reminder
  source_id TEXT NOT NULL,        -- thread_id|group_id|channel_id
  source_detail TEXT,             -- JSON: from, subject, etc
  created_at TEXT DEFAULT (datetime('now')),
  snoozed_until TEXT              -- スヌーズ再通知時刻
);
```

### D1テーブル: telegram_archive
```sql
CREATE TABLE telegram_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_msg_id INTEGER,
  chat_id INTEGER,
  direction TEXT NOT NULL,        -- in|out
  source TEXT,
  content TEXT NOT NULL,          -- メッセージ本文
  action_taken TEXT,              -- archive|delete|reply|snooze
  archived_at TEXT DEFAULT (datetime('now'))
);
```

### Telegramメッセージフォーマット
```
📧 井上太郎 <inoue@example.com>
𝗧𝗲𝗿𝗮𝗱𝗮見学日程の件

テラダ見学の日程ですが4/2で...
(本文プレビュー最大200文字)

[📖全文] [↩️返信] [📦アーカイブ] [🗑削除] [⏰後で]
```
- ソースアイコン: 📧Gmail 💬LINE 🔔Slack 📱Apple 📅Cal
- 件名/タイトル: Unicode Bold (𝗕𝗼𝗹𝗱)で視認性UP
- ボタンは最小限、アクション=削除

### ファイル責務
| ファイル | 責務 |
|---------|------|
| src/handlers/inbox.ts | 📥IN: 外部→Telegram通知の受信・表示 |
| src/handlers/outbox.ts | 📤OUT: Telegram→外部への送信・実行 |
| src/handlers/archive.ts | 🗄アーカイブ: 削除前Obsidian保存+深夜バッチ |
| src/services/gmail-bridge.ts | Gmail操作(GAS Web App経由) |
| src/services/line-bridge.ts | LINE操作(Push API) |
| src/services/slack-bridge.ts | Slack操作(Web API) |
| src/services/obsidian-writer.ts | Obsidianデイリーノート書き込み |
| src/services/snooze.ts | スヌーズ管理(D1+cron再通知) |
| workers/line-webhook/ | CF Worker: LINE Webhook→Telegram転送 |
| scripts/gmail-telegram-notifier.gs | GAS: Gmail→Telegram通知 |

### 外部依存（DJ手動必要）
1. LINE公式アカウント作成 + Messaging API有効化 + グループ招待
2. GAS: Telegram Bot Token をスクリプトプロパティに追加
3. Slack: Events API設定(DM/thread subscription)

---

## 実装順序（一気に実装、フォールバック設計）

全機能を独立モジュールで実装。1つ失敗しても他が動く。

| # | 内容 | 依存 |
|---|------|------|
| 1 | Grammy Bot再起動+notify-dj.sh復元 | なし |
| 2 | D1テーブル作成(message_mappings, telegram_archive) | なし |
| 3 | archive.ts: 削除前Obsidian保存 | D1 |
| 4 | inbox.ts: Gmail通知受信+ボタン表示 | GAS改修 |
| 5 | outbox.ts: 引用リプライ→Gmail返信 | D1マッピング |
| 6 | Gmail操作(アーカイブ/削除)+自動メッセージ削除 | GAS |
| 7 | snooze.ts: スヌーズ+再通知 | D1 |
| 8 | LINE Webhook Worker + inbox.ts LINE通知 | DJ:LINE公式作成 |
| 9 | LINE返信(引用リプライ→Push) | D1マッピング |
| 10 | Slack転送+返信 | DJ:Events API設定 |
| 11 | 深夜バッチ(未処理検出→再通知) | D1 |
| 12 | Apple Messages受信通知 | M1 AppleScript |

---

## 従量課金チェック
- Telegram Bot API: 完全無料 ✅
- GAS: 無料 ✅
- CF Worker: 無料枠内 ✅
- LINE公式ライトプラン: 月5,000円固定 ✅
- Slack API: 無料枠 ✅
- D1: 無料枠内 ✅
