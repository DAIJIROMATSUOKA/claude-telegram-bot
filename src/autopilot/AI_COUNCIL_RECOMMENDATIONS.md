# AI Council 統合判断 - Phase 3: Autopilot Engine Core

**相談日時**: 2026-02-03
**参加AI**: クロッピー🦞（Claude）、チャッピー🧠（GPT Codex）、ジェミー💎（Gemini - レート制限でスキップ）

---

## 1. アーキテクチャ設計の妥当性 ✅

### クロッピー🦞の評価

責務分担は**適切**です。特に良い点：

- **Engine**: オーケストレーション専念（7フェーズは適切な粒度）
- **Context Manager**: Memory Gateway抽象化（将来のバックエンド変更に強い）
- **Action Ledger**: 独立した重複排除（他コンポーネントから再利用可能）
- **Approval UX**: UIロジック分離（将来Slack/Discord対応時に差し替え容易）

#### 改善提案
Context ManagerとAction Ledger間に軽い依存があるなら、明示的なインターフェースで切り離すとさらに良い。

### 統合判断
**現在のアーキテクチャは適切。Phase 3.5ではそのまま進めてOK。**

---

## 2. プラグイン設計の方向性

### クロッピー🦞の推奨: **C) 両対応（Hybrid）**

将来のMemory Gateway拡張（Webhook、pub/sub）を考慮し、以下のインターフェースを推奨：

```typescript
interface AutopilotPlugin {
  name: string;
  mode: 'polling' | 'event' | 'hybrid';
  detectTriggers?(): Promise<AutopilotTask[]>;  // polling用
  onEvent?(event: MemoryEvent): Promise<AutopilotTask[]>;  // event用
  executeTask?(task: AutopilotTask): Promise<void>;
}
```

#### 理由
- Memory Gatewayに将来Webhookやpub/sub追加時、プラグイン側の変更が最小限で済む
- 既存のポーリングベースプラグインは `mode: 'polling'` として動作継続
- 新しいイベント駆動プラグインは `mode: 'event'` として追加可能

### 統合判断
**Phase 4でイベント駆動対応を追加するため、インターフェースに `mode` と `onEvent` を追加すべき。**
**Phase 3.5では既存の `detectTriggers` のみで問題なし。**

---

## 3. エラーハンドリング戦略

### クロッピー🦞の推奨

- **指数バックオフ**: 1秒 → 2秒 → 4秒（上限8秒で十分）
- **最大リトライ**: **3回**（Telegram APIの制限も考慮）
- **永続的失敗**: Memory Gatewayに記録 + 重要度highならユーザー通知

**Phase 3.5で入れるべき。Phase 4まで待つとデバッグが辛くなる。**

### チャッピー🧠の助言

- リトライは必要：指数バックオフ＋ジッター、最大3回で十分（外部API/一時障害想定）
- 永続的失敗はMemory Gatewayに記録し、ユーザー通知は"影響大/期限近い"のみ
- Phase 3.5時点は**最低限のリトライ＆失敗記録だけでも価値大**

### 統合判断
**Phase 3.5で以下を実装すべき:**
1. 指数バックオフ: `1秒 → 2秒 → 4秒 → 8秒（上限）`
2. 最大リトライ: **3回**
3. ジッター追加（リトライタイミングのランダム化）
4. 永続的失敗の記録（Memory Gateway）
5. 重要度が高い場合のみユーザー通知

**実装優先度: 高（Phase 3.5で必須）**

---

## 4. 実装の優先順位

### クロッピー🦞の推奨順序

```
1位: メインボットとの統合 ← 動かないと何も検証できない
2位: Cronトリガー ← 自動実行のコア機能
3位: AI Council統合 ← 低信頼度タスクの判断に必須
4位: 学習ログ分析 ← 運用後でOK
```

### チャッピー🧠の推奨順序

```
1位: メインボット統合 → 価値が発生
2位: Cron追加 → 実運用安定
3位: AI Council → 品質向上
4位: 学習ログ → 後回しでOK
```

### 統合判断: Phase 3.5の実装順序

#### Phase 3.5（統合フェーズ） - 優先度順

1. **メインボットとの統合**（必須）
   - コールバックハンドラー登録
   - `/autopilot` コマンド追加
   - 環境変数設定（MEMORY_GATEWAY_URL）
   - ローカルテスト実行

2. **エラーハンドリング追加**（必須）
   - 指数バックオフ実装
   - リトライ機能（最大3回）
   - 失敗ログのMemory Gateway記録

3. **Cronトリガー追加**（推奨）
   - 03:00 JST: 朝の計画提案
   - 20:00 JST: 夕方のレビュー提案

4. **AI Council統合**（推奨）
   - 低信頼度タスク（confidence < 0.6）のAI Council相談
   - 相談結果をユーザーに提示

5. **学習ログ分析**（Phase 4に延期）
   - 実行ログの分析
   - パターン改善提案

---

## 5. 総合判断

### Phase 3の設計評価: ✅ 優秀

- 責務分担が適切
- プラグインアーキテクチャが拡張性高い
- 安全性を考慮した設計（confidence-based approval, deduplication, timeout）

### Phase 3.5で実装すべき内容（優先度順）

1. **メインボット統合**（必須）
2. **エラーハンドリング**（必須）
3. **Cronトリガー**（推奨）
4. **AI Council統合**（推奨）

### Phase 4に延期してOK

- 学習ログ分析システム
- イベント駆動プラグイン対応（インターフェースのみPhase 3.5で準備）
- 高度なプラグイン（会議準備、メール返信など）

---

## 6. 次のアクション

### DJへの推奨事項

1. **Phase 3.5の開始を承認**してください
2. 以下の順序で実装を進めます：
   - [x] Phase 3コア実装完了
   - [ ] メインボット統合
   - [ ] エラーハンドリング追加
   - [ ] Cronトリガー追加
   - [ ] AI Council統合
   - [ ] 本番環境デプロイ

3. **AI Councilの判断に従い、Phase 3.5を開始する準備完了です！**

---

## 7. 補足: Gemini API制限について

ジェミー💎（Gemini）はレート制限（20 requests/day）に到達したため、今回の相談には参加できませんでした。

**今後の対策:**
- Gemini APIの使用を控えめにする
- 重要な相談のみGeminiを含める
- または、Gemini API Pro版への移行を検討

---

**結論**: Phase 3の設計は堅実。次はメインボット統合→Cron→リトライ機能の順で進めるべき。

**AI Council承認**: ✅ Phase 3.5へ進行してOK
