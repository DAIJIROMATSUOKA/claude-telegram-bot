# Phase 3: AI Council相談結果サマリー

**相談日**: 2026-02-03
**参加AI**: クロッピー🦞、チャッピー🧠
**ステータス**: ✅ Phase 3.5への進行を承認

---

## 📋 相談内容

Phase 3（Autopilot Engine Core）の実装が完了したため、以下の4点についてAI Councilに相談：

1. アーキテクチャ設計の妥当性
2. プラグイン設計の方向性
3. エラーハンドリング戦略
4. 実装の優先順位

---

## ✅ AI Councilの統合判断

### 1. アーキテクチャ: 適切 ✅

**クロッピー🦞の評価:**
- Engine、Context Manager、Action Ledger、Approval UXの責務分担は適切
- 将来の拡張性を考慮した良い設計
- Context ManagerとAction Ledger間のインターフェースを明示的にすると更に良い

**判断**: 現在のアーキテクチャでPhase 3.5を進めてOK

---

### 2. プラグイン設計: C) 両対応（Hybrid）を推奨

**クロッピー🦞の推奨:**

現在のポーリングベース（detectTriggers）を維持しつつ、Phase 4でイベント駆動（onEvent）を追加できるようにインターフェースを拡張すべき。

```typescript
interface AutopilotPlugin {
  name: string;
  mode: 'polling' | 'event' | 'hybrid';
  detectTriggers?(): Promise<AutopilotTask[]>;  // polling用
  onEvent?(event: MemoryEvent): Promise<AutopilotTask[]>;  // event用
  executeTask?(task: AutopilotTask): Promise<void>;
}
```

**判断**: Phase 3.5では既存のままでOK。Phase 4でイベント駆動対応を追加。

---

### 3. エラーハンドリング: Phase 3.5で必須 ⚠️

**クロッピー🦞 & チャッピー🧠の共通推奨:**

- **指数バックオフ**: 1秒 → 2秒 → 4秒 → 8秒（上限）
- **最大リトライ**: 3回
- **ジッター**: リトライタイミングのランダム化
- **永続的失敗**: Memory Gatewayに記録
- **ユーザー通知**: 重要度が高い場合のみ

**チャッピー🧠のコメント:**
> Phase 3.5時点は最低限のリトライ＆失敗記録だけでも価値大。Phase 4まで待つとデバッグが辛くなる。

**判断**: Phase 3.5でエラーハンドリングを必ず実装すべき（優先度: 高）

---

### 4. 実装の優先順位

**クロッピー🦞 & チャッピー🧠の共通推奨順序:**

```
1位: メインボットとの統合 ← 動かないと何も検証できない
2位: エラーハンドリング ← デバッグのために必須
3位: Cronトリガー ← 自動実行のコア機能
4位: AI Council統合 ← 低信頼度タスクの判断に必須
5位: 学習ログ分析 ← 運用後でOK（Phase 4へ延期）
```

**判断**: Phase 3.5では1-4を実装、5はPhase 4に延期

---

## 🎯 Phase 3.5の実装計画

### 必須タスク（優先度: 高）

1. **メインボットとの統合**
   - [ ] コールバックハンドラー登録（`src/handlers/callback.ts`に追加）
   - [ ] `/autopilot` コマンド追加
   - [ ] 環境変数設定（MEMORY_GATEWAY_URL）
   - [ ] ローカルテスト実行

2. **エラーハンドリング追加**
   - [ ] 指数バックオフ実装（1秒 → 2秒 → 4秒 → 8秒）
   - [ ] リトライ機能（最大3回）
   - [ ] ジッター追加
   - [ ] 失敗ログのMemory Gateway記録
   - [ ] 重要度に応じたユーザー通知

### 推奨タスク（優先度: 中）

3. **Cronトリガー追加**
   - [ ] 03:00 JST: 朝の計画提案（predictive-task-generator）
   - [ ] 20:00 JST: 夕方のレビュー提案（predictive-task-generator）
   - [ ] node-cron または同等のライブラリ導入

4. **AI Council統合**
   - [ ] 低信頼度タスク（confidence < 0.6）のAI Council相談
   - [ ] 相談結果をユーザーに提示
   - [ ] 相談結果をMemory Gatewayに記録

### Phase 4に延期（優先度: 低）

5. **学習ログ分析システム**
   - Memory Gatewayから実行ログを分析
   - パターン改善提案
   - プラグインの信頼度調整

6. **イベント駆動プラグイン対応**
   - `onEvent` メソッドの実装
   - Memory Gateway Webhookの実装
   - イベントルーティング

---

## 📊 AI Councilの総合評価

### Phase 3の設計: ✅ 優秀

- 責務分担が適切
- プラグインアーキテクチャが拡張性高い
- 安全性を考慮した設計（confidence-based approval, deduplication, timeout）

### 次のステップ: Phase 3.5（統合フェーズ）

**AI Council承認**: ✅ Phase 3.5へ進行してOK

**推奨アプローチ**: メインボット統合 → エラーハンドリング → Cron → AI Council の順で実装

---

## 💡 重要なポイント

### クロッピー🦞の強調ポイント
> Phase 3.5で入れるべき。Phase 4まで待つとデバッグが辛くなる。

### チャッピー🧠の強調ポイント
> 統合で価値が発生、Cronで実運用安定、AI Councilは品質向上、学習は後回しでOK。

---

## 🚀 次のアクション

DJに確認すべき事項：

1. **Phase 3.5の開始を承認しますか？**
2. **エラーハンドリングをPhase 3.5で実装する方針でOKですか？**
3. **Cronトリガーの時刻（03:00, 20:00 JST）は適切ですか？**

承認が得られ次第、Phase 3.5の実装を開始します。

---

**作成日**: 2026-02-03
**作成者**: Jarvis (AI Council相談結果をまとめ)
**ステータス**: DJの承認待ち
