# Inbox Triage Agent 仕様書
**作成日:** 2026-03-12
**目的:** Telegramに届く全Inbox通知を🦞が自動判断→アクション実行→Inbox Zero達成

---

## 概要

Jarvisが送るInbox通知(Gmail/LINE/iMessage/Slack/System)を🦞Workerに自動転送。
🦞が判断→JSON応答→Jarvisが機械的に実行。

**DJの操作: 通知を見るだけ。問題あれば取消ボタン。**

---

## アーキテクチャ

```
Gmail/LINE/iMessage/Slack/System
  → Jarvis notification handler (既存)
  → Telegram通知送信 (既存)
  → triageQueue.enqueue() ← NEW
  → Worker空き待ち
  → [J-WORKER-N] inject (triage prompt + message)
  → 🦞判断 → JSON応答
  → Jarvis parseTriageResponse()
  → action実行 (archive/delete/reply/obsidian/bug_fix)
  → Telegram確認通知 (ボタン付き)
```

---

## トリアージJSON仕様

🦞が返すフォーマット:
```json
{
  "action": "archive|delete|reply|obsidian|bug_fix|ignore|escalate",
  "confidence": 0.0-1.0,
  "reason": "判断理由(1行)",
  "draft": "返信下書き(action=replyのみ)",
  "obsidian_summary": "記録内容(action=obsidianのみ)"
}
```

### アクション定義
| action | 実行者 | 内容 |
|--------|--------|------|
| archive | Jarvis | Gmail→GAS archive / 他→Telegram通知削除 |
| delete | Jarvis | Gmail→GAS trash / 他→Telegram通知削除 |
| reply | DJ承認 | 下書き表示→[送信][修正][却下]ボタン |
| obsidian | Jarvis | obsidian-writer.ts経由で記録 |
| bug_fix | 🦞 | exec bridge経由で自己修復(JSON返却不要) |
| ignore | Jarvis | 何もしない(通知はそのまま残す) |
| escalate | Jarvis | 「🦞判断不能」としてDJに明示通知 |

---

## キュー設計

### inbox-triage.ts (新規サービス)

```typescript
interface TriageItem {
  id: string;
  telegramMsgId: number;
  chatId: number;
  source: 'gmail' | 'line' | 'imessage' | 'slack' | 'system';
  sourceId?: string;       // gmail_id等
  senderName: string;
  subject?: string;
  body: string;
  enqueuedAt: number;
}

const queue: TriageItem[] = [];
let processing = false;
```

### バッファリング（同一送信者30秒ルール）
- 同一source+senderNameから30秒以内の連続メッセージ → 1つにまとめてinject
- タイマー: 最初のメッセージから30秒後 or 別送信者のメッセージが来たら即flush

### Worker空き確認
- `check-status` で READY 判定 → inject
- 両Worker BUSY → キュー待機（1秒間隔で再チェック）
- 3分待ってもBUSY → escalate (DJに通知)

### inject カウンター考慮
- 既存: 25往復で警告、30でhandoff
- triage 1通 = 1往復 → 30通でhandoff発生
- handoff中はキュー一時停止 → 完了後再開

---

## confidence閾値とフェーズ

### Phase 1: 候補表示のみ（初期2週間）
- 全アクション: DJ確認ボタン付きで表示
- 自動実行なし
- DJの承認/却下を inbox_actions に記録 → 学習データ

### Phase 2: 高confidence自動実行
- confidence ≥ 0.9 + action∈{archive,delete,ignore} → 自動実行
- reply/obsidian/bug_fix → 常にDJ確認
- 閾値は inbox_actions の承認率から自動調整(将来)

### Phase 3: ほぼ全自動
- Phase 2の承認率95%超 → 閾値を0.8に下げる
- reply下書きの承認率が高ければ自動送信も検討

---

## Telegram通知UI

### 自動実行時
```
🦞 📦アーカイブ済み
Amazon セール情報
理由: プロモーションメール
[❌取消]
```

### DJ確認時
```
🦞 ✏️返信下書き (confidence: 0.7)
宛先: 田中さん (LINE)
---
お世話になっております。M1311は3月末出荷予定です。
---
[📤送信] [✏️修正] [❌却下]
```

### bug_fix時
```
🦞 🔧自動修復中...
Poller heartbeat stale → プロセス再起動
(🦞がexec bridgeで直接対応)
```

---

## hook point (既存コード改修箇所)

### Gmail通知送信後
- GAS webhook handler or notification formatter
- `triageQueue.enqueue({ source: 'gmail', sourceId: gmail_id, ... })`

### LINE通知送信後
- LINE webhook handler
- `triageQueue.enqueue({ source: 'line', senderName, body })`

### iMessage通知送信後
- iMessage bridge handler
- `triageQueue.enqueue({ source: 'imessage', senderName, body })`

### System通知
- Poller/Watchdog/Scout等のエラー通知
- `triageQueue.enqueue({ source: 'system', body })`

---

## Worker Project Instructions 追記

```
## Inbox Triage Mode
メッセージが「[TRIAGE]」で始まる場合:
1. メッセージ内容を読んで判断
2. 以下のJSON形式**のみ**で応答（前置き・説明不要）
{
  "action": "archive|delete|reply|obsidian|bug_fix|ignore|escalate",
  "confidence": 0.0-1.0,
  "reason": "判断理由(1行)",
  "draft": "返信下書き(action=replyのみ)",
  "obsidian_summary": "記録内容(action=obsidianのみ)"
}

判断基準:
- プロモ/広告/ニュースレター → archive
- スパム/不要通知 → delete
- 案件関連/重要情報 → obsidian (M番号検出したらobsidian_summaryに含める)
- 質問/依頼への返信が必要 → reply (draftに下書き)
- システムエラー/バグ → bug_fix (自分でexec bridge修復)
- 判断できない → escalate
```

---

## 新規ファイル
| ファイル | 役割 |
|---------|------|
| src/services/inbox-triage.ts | キュー管理+トリアージ実行+応答パース+アクション実行 |
| docs/inbox-triage-spec.md | この仕様書 |

## 改修ファイル
| ファイル | 変更内容 |
|---------|---------|
| src/handlers/inbox.ts | 通知送信後にtriageQueue.enqueue()追加 |
| src/handlers/text.ts | triage確認ボタンのcallback処理 |
| docs/worker-project-instructions.md | Triage Mode追記 |
| docs/FEATURE-CATALOG.md | 機能追記 |

---

## 安全装置
- /tmp/triage-stop → トリアージ一時停止（通知転送は継続）
- Phase 1では全アクション候補表示のみ
- reply送信は常にDJ承認必須（Phase 3以降も）
- bug_fixは🦞が直接実行するが、結果は必ず通知
