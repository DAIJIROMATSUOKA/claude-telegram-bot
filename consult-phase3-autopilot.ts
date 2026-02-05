import { consultAICouncil } from './src/utils/ai-council-helper';

const question = `Phase 3: Autopilot Engine Core の実装方針について相談させてください。

## 背景
- Memory Gateway v1.1は完全実装済み（append/query/snapshot動作確認済み）
- Janitorも完全実装済み
- Phase 0-1は完了、Phase 2はスキップ可能

## Phase 3で実装済みの内容

### 1. **Autopilot Engine Core** (~/claude-telegram-bot/src/autopilot/engine.ts - 370行)
   - 7フェーズパイプライン: Trigger → Context → Plan → Review → Propose → Execute → Learn
   - プラグインレジストリシステム
   - 自動承認ロジック（confidence >= 0.8, impact = low）
   - 実行サマリー生成

### 2. **Context Manager** (~/claude-telegram-bot/src/autopilot/context-manager.ts - 190行)
   - Memory Gatewayからのスナップショット取得（常に）
   - Memory Queryの実行（必要に応じて）
   - Memory Appendでログ記録
   - タスク履歴追跡
   - 重複実行チェッカー

### 3. **Action Ledger** (~/claude-telegram-bot/src/utils/action-ledger.ts - 180行)
   - インメモリ重複排除
   - 時間ウィンドウキー生成（hourly/daily/weekly）
   - 自動クリーンアップ（1時間間隔）
   - TTL管理（デフォルト24時間）

### 4. **Approval UX** (~/claude-telegram-bot/src/autopilot/approval-ux.ts - 200行)
   - Telegramインラインキーボード
   - コールバック解析
   - タイムアウト処理（5分）
   - ステータス追跡（pending/approved/rejected/expired）

### 5. **初期プラグイン** (~/claude-telegram-bot/src/autopilot/plugins/)
   - predictive-task-generator.ts (170行): 時間ベースのパターン検出
   - stalled-task-recomposer.ts (170行): 2日以上停滞タスクの検出と分解提案
   - reverse-scheduler.ts (190行): デッドライン駆動タスク提案

## 質問

### 1. **アーキテクチャ設計の妥当性**
Engine CoreとAction Ledgerの責務分担は適切でしょうか？
- Engine: パイプライン実行、プラグイン管理
- Context Manager: Memory Gateway統合、コンテキスト管理
- Action Ledger: 重複排除、TTL管理
- Approval UX: ユーザー承認フロー

この分離は将来の拡張性を考えると妥当ですか？

### 2. **プラグイン設計の方向性**
現在のプラグインインターフェース:
\`\`\`typescript
interface AutopilotPlugin {
  name: string;
  detectTriggers(): Promise<AutopilotTask[]>;
  executeTask?(task: AutopilotTask): Promise<void>;
}
\`\`\`

以下のどのアプローチが最適でしょうか？
- A) イベント駆動（Memory Gatewayからのイベントに反応）
- B) ポーリング（定期的にトリガーチェック）
- C) 両対応（プラグインごとに選択可能）

現在はBのポーリングベースですが、将来的にイベント駆動も追加すべきですか？

### 3. **エラーハンドリング戦略**
リトライ戦略について意見をください：
- 指数バックオフ（1秒 → 2秒 → 4秒 → 8秒）？
- 最大リトライ回数（3回？5回？）？
- 永続的失敗の扱い（Memory Gatewayに記録？ユーザーに通知？）

現在はリトライ機能がありませんが、Phase 4で追加すべきでしょうか？

### 4. **実装の優先順位**
Phase 3.5（統合フェーズ）で以下のどれを優先すべきですか？
1. メインボットとの統合（コールバックハンドラー登録）
2. Cronトリガーの追加（03:00, 20:00 JST）
3. AI Council統合（低信頼度タスク用）
4. 学習ログ分析システム

## 現在の実装状態
- Phase 3コア実装: ✅ 完了（2,320行のコード + 600行のドキュメント）
- テストスイート: ✅ 実装済み
- 統合ガイド: ✅ 作成済み（INTEGRATION.md）
- 次のステップ: Phase 3.5（メインボットとの統合）

## 各AIへのお願い
- **クロッピー🦞**: アーキテクチャ設計の観点から評価してください
- **ジェミー💎**: プラグインシステムの拡張性について評価してください
- **チャッピー🧠**: エラーハンドリングと優先順位について助言してください

簡潔に（各AI 5-7行以内で）重要なポイントのみを指摘してください。`;

const result = await consultAICouncil(
  null,
  7488699341,
  question,
  { sendToUser: false, includePrefix: false }
);

console.log('🏛️ AI Council からの統合判断:\n');
console.log(result.advisorResponses);
console.log('\n📊 Summary:');
console.log(result.summary);
