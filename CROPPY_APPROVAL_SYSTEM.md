# 🦞 Croppy Auto-Approval System

**Status**: Phase 1-5 COMPLETE ✅

croppyが自動判断してGO/STOPを決定するシステム。DJの承認作業を90%削減。

---

## 📋 概要

### 目的
- Jarvisのフェーズ完了時、croppyが自動的にGO/STOP判断
- 安全な場合のみGO、少しでもリスクがあればSTOP
- 従量課金API不使用（callClaudeCLI経由 = Telegram転送）

### 判断基準

#### ✅ GO条件（すべて満たす場合のみ）
- テストがすべて通過している
- 実行時エラーが発生していない
- 従量課金APIを使用していない
- 仕様書のMUST要件を満たしている
- 既存テストが壊れていない
- 不可逆な操作を含まない
- 外部ユーザーへの影響がない
- Jarvisが判断前提サマリーを明示している

#### 🚫 STOP条件（1つでも該当したら即STOP）
- テスト失敗
- エラーあり
- 従量課金API使用
- 仕様と明確に不一致
- 不可逆な操作を含む
- 外部影響あり
- リスクフラグあり
- 判断に必要な情報が不足
- 少しでも迷いがある

---

## 🏗️ アーキテクチャ

### ファイル構成

```
src/
├── utils/
│   ├── croppy-approval.ts          # コア: askCroppyApproval()
│   └── croppy-integration.ts       # Jarvis統合ヘルパー
├── handlers/
│   ├── croppy-commands.ts          # Telegram コマンド
│   └── ai-router.ts                # callMemoryGateway() 追加
└── index.ts                        # /croppy コマンド登録

memory-gateway/
└── migrations/
    └── 0006_approval_log.sql       # DB スキーマ
```

### データフロー

```
Jarvis (Phase完了)
  → checkPhaseApproval() [croppy-integration.ts]
  → isAutoApprovalEnabled() チェック [croppy-commands.ts]
  → askCroppyApproval() [croppy-approval.ts]
  → callClaudeCLI() [ai-router.ts] (従量課金API不使用)
  → croppy判断: GO / STOP
  → DBログ保存 [approval_log]
  → Telegram通知
  → 戻り値: approved: boolean
```

---

## 📊 データベース設計

### approval_log テーブル
```sql
CREATE TABLE approval_log (
  log_id TEXT PRIMARY KEY,           -- ULID
  created_at TEXT NOT NULL,          -- ISO8601
  phase_name TEXT NOT NULL,          -- 例: "Phase 2: Implementation"
  jarvis_context TEXT NOT NULL,      -- Jarvisコンテキスト全文

  -- Input Summary
  is_experiment INTEGER NOT NULL,
  production_impact INTEGER NOT NULL,
  is_urgent INTEGER NOT NULL,
  implementation_summary TEXT NOT NULL,
  test_results TEXT NOT NULL,        -- 'pass' | 'fail'
  error_report TEXT,

  -- Croppy Decision
  approved INTEGER NOT NULL,         -- 0=STOP, 1=GO
  reason TEXT NOT NULL,
  raw_response TEXT NOT NULL,

  -- Performance
  execution_time_ms INTEGER NOT NULL,
  timeout INTEGER NOT NULL,          -- 0=OK, 1=Timeout
  error INTEGER NOT NULL             -- 0=OK, 1=Error
);
```

### approval_config テーブル
```sql
CREATE TABLE approval_config (
  config_key TEXT PRIMARY KEY,       -- 例: "global_enabled"
  config_value TEXT NOT NULL,        -- "0" or "1"
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL           -- 例: "DJ", "system"
);
```

### ビュー
- `approval_stats_daily`: 日次統計（GO/STOP件数、エラー、平均実行時間）
- `approval_recent`: 直近50件の判断履歴

---

## 🎮 Telegram コマンド

### `/croppy` - ヘルプ表示
基本的な使い方を表示

### `/croppy status` - 現在の状態と統計
```
🦞 Croppy Auto-Approval Status

状態: ✅ ENABLED

📊 本日の統計 (2026-02-04)
GO承認: 3/10 [███░░░░░░░]
STOP判定: 2
残りGO: 7
```

### `/croppy enable` - 自動承認を有効化
```
🦞 Croppy Auto-Approval: ENABLED

自動承認を有効化しました。
安全なフェーズ完了時は自動的にGOします。

本日の残りGO回数: 7/10

/croppy disable で無効化できます。
```

### `/croppy disable` - 自動承認を無効化
```
🦞 Croppy Auto-Approval: DISABLED

自動承認を無効化しました。
すべてのフェーズ完了時にDJの承認が必要になります。

/croppy enable で再有効化できます。
```

---

## 🔧 統合方法

### Jarvisからの呼び出し

```typescript
import { checkPhaseApproval } from './utils/croppy-integration';
import { ApprovalInput } from './utils/croppy-approval';

// フェーズ完了時
async function onPhaseComplete(ctx: Context) {
  // 1. 承認判断に必要な情報を収集
  const input: ApprovalInput = {
    phase_name: 'Phase 2: Implementation',
    jarvis_context: '実装が完了しました。\n- ファイルA.tsを編集\n- テストを追加',
    prerequisite_summary: {
      is_experiment: false,       // 実験的機能か
      production_impact: false,   // 本番影響あるか
      is_urgent: false,           // 緊急性
    },
    implementation_summary: '新機能XをファイルAに追加しました',
    test_results: 'pass',         // 'pass' | 'fail'
    error_report: null,           // エラーがある場合は文字列
  };

  // 2. croppy判断
  const result = await checkPhaseApproval(ctx, input);

  // 3. 結果に応じて処理
  if (result.approved) {
    // GO → 次のフェーズへ自動進行
    await proceedToNextPhase();
  } else {
    // STOP → DJの承認待ち
    await waitForDJApproval();
  }
}
```

---

## 🛡️ セーフティ機能

### 1. 1日10回制限
- GOは1日10回まで
- 超過後は自動的にSTOP → DJ確認
- 日付変更時（0:00 JST）に自動リセット

### 2. タイムアウト保護
- 15秒以内に応答なし → 自動STOP
- ログに `timeout=1` として記録

### 3. エラー時フェイルセーフ
- croppy呼び出しエラー → 自動STOP
- DB保存失敗 → 処理継続（ログは失うが判断は有効）

### 4. グローバルキルスイッチ
- `/croppy disable` で即座に無効化
- DB永続化（再起動しても維持）

### 5. 判断履歴の完全記録
- すべての判断をDBに保存
- 監査・分析・デバッグ用

---

## 📈 統計・分析

### 日次統計の取得
```sql
SELECT * FROM approval_stats_daily ORDER BY date DESC LIMIT 7;
```

### エラー率の計算
```sql
SELECT
  COUNT(*) as total,
  SUM(error) as errors,
  ROUND(100.0 * SUM(error) / COUNT(*), 2) as error_rate_percent
FROM approval_log
WHERE DATE(created_at) = DATE('now');
```

### 平均実行時間
```sql
SELECT
  AVG(execution_time_ms) as avg_ms,
  MIN(execution_time_ms) as min_ms,
  MAX(execution_time_ms) as max_ms
FROM approval_log
WHERE DATE(created_at) = DATE('now');
```

---

## ⚡ パフォーマンス

- **判断速度**: 平均 3-5秒（callClaudeCLI経由）
- **タイムアウト**: 15秒
- **DB書き込み**: 非同期（判断結果に影響しない）
- **Telegram通知**: 自動（GO/STOP両方）

---

## 🧪 テスト

### 手動テスト
```typescript
import { testCroppyApproval } from './utils/croppy-integration';

// Telegramで
await testCroppyApproval(ctx);
```

### 自動テスト（TODO）
- Phase 6 で実装予定
- ユニットテスト: askCroppyApproval()
- 統合テスト: checkPhaseApproval()

---

## 🚀 次のステップ

### Phase 6: Failsafe & Notification (TODO)
- [ ] DJへの通知メッセージ改善
- [ ] STOP時の詳細情報表示
- [ ] エラー時の再試行ロジック

### Phase 7: Tests (TODO)
- [ ] ユニットテスト作成
- [ ] 統合テスト作成
- [ ] エッジケーステスト

---

## 🔐 セキュリティ

### 従量課金API不使用を保証
- `callClaudeCLI()` 使用（Telegram転送 = 無料）
- `ANTHROPIC_API_KEY` は一切使用しない
- コード内で明示的に `callClaudeCLI` のみを使用

### DB認証
- `GATEWAY_API_KEY` で Memory Gateway にアクセス
- 内部認証のみ（外部公開なし）

---

## 📝 ログ例

### GO判断
```json
{
  "log_id": "01JGRP8X...",
  "created_at": "2026-02-04T10:23:45Z",
  "phase_name": "Phase 2: Implementation",
  "approved": 1,
  "reason": "テストパス、エラーなし",
  "execution_time_ms": 3421,
  "timeout": 0,
  "error": 0
}
```

### STOP判断
```json
{
  "log_id": "01JGRP9Y...",
  "created_at": "2026-02-04T10:25:12Z",
  "phase_name": "Phase 3: Testing",
  "approved": 0,
  "reason": "テスト失敗",
  "execution_time_ms": 2891,
  "timeout": 0,
  "error": 0
}
```

---

## 🐛 トラブルシューティング

### croppy が応答しない
- タイムアウト → 自動STOP
- ログ確認: `timeout=1`
- Claude CLI の接続状態を確認

### GO回数が増えない
- `/croppy status` で確認
- 1日10回上限に到達している可能性
- 翌日0:00に自動リセット

### 自動承認されない
- `/croppy status` で `DISABLED` になっていないか確認
- `/croppy enable` で有効化

---

**実装日**: 2026-02-04
**バージョン**: 1.0
**従量課金API使用**: ❌ なし（callClaudeCLI経由）
