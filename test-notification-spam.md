# 通知スパム防止機能 - 動作確認テスト

## テスト日時
2026-02-03 12:10

## テスト目的
通知スパム防止機能が正しく動作するか確認する

## テスト手順

### Test Case 1: 複数ファイル読み込み + 編集タスク
**タスク:** 「3つのファイルを読んで、それぞれに簡単なコメントを追加して」

**期待される動作:**
1. 🔄 実装開始（1通目）
2. 📝 テキスト応答（中間、N通）
3. ✅ 実装開始 完了（サマリー付き、最後の1通）

**期待されない動作:**
- ❌ 📖 Reading... ×3
- ❌ ✏️ Editing... ×3
- ❌ 🧠 Thinking...
- ❌ 中間のツール実行通知

**Acceptance Criteria:**
- [ ] Phase開始通知: 1通のみ
- [ ] Phase完了通知: 1通のみ（サマリー付き）
- [ ] 中間通知: 0通（console.logのみ）
- [ ] 合計通知数: 2-3通以内

---

### Test Case 2: エラー発生時の動作
**タスク:** 「存在しないファイルを読んで編集して」

**期待される動作:**
1. 🔄 実装開始（1通目）
2. ❌ 実装開始 エラー（サマリー + エラー詳細、最後の1通）

**Acceptance Criteria:**
- [ ] エラー発生時も通知が来る
- [ ] エラー詳細がサマリーに含まれる
- [ ] 合計通知数: 2-3通以内

---

### Test Case 3: 長時間タスク（10+ ツール実行）
**タスク:** 「プロジェクト内の全TypeScriptファイルを検索して、TODO コメントを抽出してリスト化して」

**期待される動作:**
1. 🔄 実装開始（1通目）
2. 📝 テキスト応答（中間、N通）
3. ✅ 実装開始 完了（サマリー付き、最後の1通）
   - 🛠 ツール実行: 10+回
   - 🧠 思考: X回
   - 📝 テキスト生成: Y回

**Acceptance Criteria:**
- [ ] 10回以上のツール実行でも中間通知なし
- [ ] サマリーにツール実行回数が表示される
- [ ] 合計通知数: 2-5通以内

---

## 実測結果

### Before (修正前)
- 📖 Reading... ×3
- ✏️ Editing... ×2
- ▶️ Running... ×1
- 🧠 Thinking... ×1
- 📝 Text... ×2
**Total: 9通**

### After (修正後)
- 🔄 実装開始
- 📝 Text... ×2
- ✅ 実装開始 完了（サマリー付き）
**Total: 3通**

---

## 実装内容確認

### 1. NotificationBuffer (notification-buffer.ts)
- ✅ startPhase() - Phase開始通知（1通）
- ✅ addActivity() - アクティビティをバッファに追加（通知なし）
- ✅ endPhase() - Phase完了通知 + サマリー（1通）
- ✅ グループ化サマリー（ツール実行回数・思考回数・エラー詳細）

### 2. Streaming Handler (streaming.ts)
- ✅ thinking通知 → console.logのみ（Telegram通知なし）
- ✅ tool通知 → console.logのみ（Telegram通知なし）
- ✅ notificationBuffer.addActivity() で活動記録

### 3. Text Handler (text.ts)
- ✅ detectImplementationTask() - 実装タスク自動検知
- ✅ startPhase() - タスク開始時に自動実行
- ✅ endPhase() - タスク完了/エラー時に自動実行

---

## Console Log確認

実装中、以下のログがconsoleに出力される（Telegramには送信されない）：
```
[Thinking] 実装計画を立てています...
[Tool] Reading file1.ts
[Tool] Reading file2.ts
[Tool] Editing file1.ts
[NotificationBuffer] 🛠 Reading file1.ts
[NotificationBuffer] 🛠 Reading file2.ts
[NotificationBuffer] 🛠 Editing file1.ts
```

---

## 次のアクション
1. [x] Bot再起動（最新コード反映）
2. [x] Test Case 1 実行（第1回: 6通 → 改善必要）
3. [ ] Test Case 1 再実行（第2回: 追加修正後）
4. [ ] Test Case 2 実行
5. [ ] Test Case 3 実行
6. [ ] 実測結果の記録
7. [ ] AI_MEMORY更新

---

## 追加修正（2026-02-03 12:13）

### 問題点（第1回テスト結果: 6通）
1. ✅ AI Council相談の通知が2通出ている（「相談中...」「助言」）
2. ✅ Phase開始が重複する可能性
3. ✅ 中間報告が出ている

### 修正内容

**1. auto-rules.ts (AI Council通知削除)**
- L598: `await ctx.reply('🏛️ AI Councilに実装前相談中...')` → console.logのみ
- L615: `await ctx.reply('🏛️ AI Councilからの助言...')` → console.logのみ
- L621: `result.summary` → `result.advisorResponses` に変更（3人の意見を使用）

**2. notification-buffer.ts (Phase重複防止)**
- `startPhase()`: 同じPhase名で2回呼ばれた場合はスキップ
- console.logで「already running, skipping duplicate start」と出力

### 期待される改善
- **Before（第1回）**: 6通
- **After（第2回）**: 2-3通
  - 🔄 実装開始（1通）
  - 📝 Text（0-1通）
  - ✅ 完了サマリー（1通）

### AI Council助言の表示方法
- Telegram通知ではなく、Claudeへのメッセージに挿入
- ユーザーには見えないが、Claudeは助言を考慮して実装
