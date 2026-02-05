# 🦞 Croppy Workflow Integration

**Status**: INTEGRATED ✅

croppy自動承認がJarvisのワークフローに統合されました。

---

## 🔄 動作フロー

```
1. ユーザーメッセージ受信
   ↓
2. Jarvis (Claude) が処理・応答
   ↓
3. Phase完了検出 (phase-detector.ts)
   - "Phase X 完了"
   - "✅ Phase X"
   - "[Phase X] ✅"
   ↓
4. croppy自動承認判断
   - /croppy enable の場合のみ
   - 1日10回制限チェック
   - callClaudeCLI() で判断（無料）
   ↓
5. 判断結果
   ├─ GO → Telegram通知 → 次のタスクへ自動進行
   └─ STOP → Telegram通知 → DJ承認待ち
```

---

## 📁 統合されたファイル

### `/src/utils/phase-detector.ts` (NEW)
Phase完了を自動検出し、croppy承認をトリガー

**機能:**
- `detectPhaseCompletion()` - Phase完了パターンマッチング
- `extractImplementationSummary()` - 実装サマリー抽出
- `detectErrors()` - エラー検出
- `detectTestResults()` - テスト結果推定
- `detectPrerequisites()` - 前提条件推定
- `checkPhaseCompletionApproval()` - メイン統合関数

### `/src/handlers/text.ts` (MODIFIED)
メッセージ処理完了後にPhase完了チェックを追加

**変更点:**
```typescript
// 10. Check for phase completion and croppy approval
await checkPhaseCompletionApproval(ctx, response);
```

---

## 🎯 Phase完了検出パターン

以下のパターンでPhase完了を自動検出：

```typescript
/Phase\s+(\d+)\s*(完了|complete|done)/i
/✅\s*Phase\s+(\d+)/i
/フェーズ\s*(\d+)\s*(完了|終了)/i
/\[Phase\s+(\d+)\]\s*(完了|✅)/i
```

**検出例:**
- ✅ "Phase 1 完了"
- ✅ "✅ Phase 2"
- ✅ "[Phase 3] ✅"
- ✅ "フェーズ4完了"
- ❌ "Phase 1を開始します" (開始は検出しない)

---

## 🤖 自動判断の前提条件推定

croppy判断時に以下を自動推定：

### `is_experiment` (実験的フラグ)
キーワード検出: `実験`, `experiment`, `test`, `試験`

### `production_impact` (本番影響フラグ)
キーワード検出: `本番`, `production`, `prod`, `deploy`

### `is_urgent` (緊急性フラグ)
キーワード検出: `緊急`, `urgent`, `critical`, `hotfix`

---

## 🛡️ エラー検出

以下のパターンでエラーを検出 → 自動STOP:

```typescript
/❌.*?(error|エラー|失敗)/i
/Error:/i
/Failed:/i
/🚫/
```

---

## 📊 テスト結果推定

### FAIL判定（即STOP）
- `test.*?failed`
- `テスト.*?(失敗|エラー)`
- `❌.*?test`

### PASS判定（デフォルト）
- 上記パターンに該当しない場合

---

## 🎮 使い方

### 有効化
```
/croppy enable
```

croppy自動承認が有効になり、Phase完了時に自動判断します。

### 無効化
```
/croppy disable
```

croppy自動承認が無効になり、すべてのPhase完了時にDJ承認が必要になります。

### ステータス確認
```
/croppy status
```

現在の有効/無効状態と本日の統計を表示します。

---

## 🔍 動作例

### 例1: 自動GO

**Jarvis応答:**
```
Phase 2 完了しました。

実装内容:
- croppy-context.ts を作成
- DBテーブル追加
- テスト実行 → すべてパス

エラーなし。次のPhaseに進みます。
```

**croppy判断:**
```
🦞 Croppy Auto-Approval: GO

Phase: Phase 2
理由: テストパス、エラーなし、従量課金API不使用

次のフェーズに進みます...
```

**結果:** ✅ 自動的に次のPhaseへ進行

---

### 例2: 自動STOP

**Jarvis応答:**
```
Phase 3 完了しました。

実装内容:
- 本番DBへのマイグレーション実行

❌ エラー: DB接続タイムアウト
```

**croppy判断:**
```
🦞 Croppy Auto-Approval: STOP

Phase: Phase 3
理由: エラーが検出されました

⚠️ DJの承認が必要です。
続行する場合は「GO」と送信してください。
```

**結果:** 🛑 停止、DJ承認待ち

---

### 例3: 1日10回制限到達

**croppy判断:**
```
🦞 Croppy Auto-Approval: STOP

Phase: Phase 5
理由: 本日のGO上限到達（10/10）

⚠️ DJの承認が必要です。
明日0:00にリセットされます。
```

**結果:** 🛑 停止、DJ承認待ち

---

## 🔧 トラブルシューティング

### Phase完了が検出されない

**原因:**
- Phase完了メッセージが検出パターンと一致しない

**解決策:**
- Jarvisに「Phase X 完了」と明示的に書かせる
- または `/src/utils/phase-detector.ts` のパターンを追加

### croppy判断がされない

**確認:**
1. `/croppy status` で `ENABLED` になっているか
2. 1日10回制限に達していないか

**解決策:**
- `/croppy enable` で有効化
- 翌日0:00まで待つ（制限リセット）

### 誤判定が多い

**原因:**
- 自動推定が不正確

**解決策:**
- Jarvisに前提条件を明示させる
  - 「実験フェーズです」
  - 「本番影響なし」
  - 「テストすべて通過」

---

## 📈 統計・分析

### croppy判断の統計を見る
```sql
SELECT * FROM approval_stats_daily ORDER BY date DESC LIMIT 7;
```

### Phase完了検出の精度
```sql
SELECT
  phase_name,
  COUNT(*) as total,
  SUM(approved) as go_count,
  COUNT(*) - SUM(approved) as stop_count
FROM approval_log
GROUP BY phase_name
ORDER BY total DESC;
```

---

## ⚙️ カスタマイズ

### Phase完了パターンを追加

`/src/utils/phase-detector.ts` を編集：

```typescript
const PHASE_COMPLETION_PATTERNS = [
  /Phase\s+(\d+)\s*(完了|complete|done)/i,
  /✅\s*Phase\s+(\d+)/i,
  // 新しいパターンを追加
  /Phase\s+(\d+):\s*DONE/i,
];
```

### 前提条件判定を改善

```typescript
export function detectPrerequisites(response: string): {
  is_experiment: boolean;
  production_impact: boolean;
  is_urgent: boolean;
} {
  const prerequisites = {
    is_experiment: false,
    production_impact: false,
    is_urgent: false,
  };

  // カスタム判定ロジックを追加
  if (/your_custom_pattern/i.test(response)) {
    prerequisites.is_experiment = true;
  }

  return prerequisites;
}
```

---

## 🚀 今後の改善

### 予定されている機能

1. **学習機能**
   - croppy判断の精度を自動改善
   - 過去の判断から学習

2. **手動オーバーライド**
   - DJが「force GO」で強制進行
   - DJが「force STOP」で強制停止

3. **Phase完了通知の改善**
   - Jarvisに「croppy:判断中...」を表示させる
   - 判断結果をより詳細に表示

---

**実装日**: 2026-02-04
**バージョン**: 1.0
**従量課金API使用**: ❌ なし（callClaudeCLI経由）
