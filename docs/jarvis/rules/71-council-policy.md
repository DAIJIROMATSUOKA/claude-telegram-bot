# 71-council-policy.md — AI Council Consultation Policy

**Version:** 1.0
**Last Updated:** 2026-02-03
**Priority:** CRITICAL (System-level enforcement)

---

## 📋 Overview

This policy defines **mandatory** AI Council consultation requirements to prevent errors, ensure quality, and leverage collective intelligence.

**AI Council Members:**
- 🦞 クロッピー (Claude Opus 4.5 via claude.ai)
- 💎 ジェミー (Gemini 2.0 Flash)
- 🧠 チャッピー (ChatGPT 4)

---

## 🔑 Rule 14: AI Council MUST USE council: PREFIX

**Status:** MANDATORY (System-level enforcement)

### Consultation Method

**✅ REQUIRED:**
- Use `council:` prefix in Telegram message
- Send message directly to get real-time responses from 3 AIs
- Format: `council: [your question]`

**❌ PROHIBITED:**
- Creating documents and "waiting for responses"
- Sending individual files to each AI
- 24-hour waiting period
- Document-based consultation approach

### Why This Rule Exists

The previous document-based consultation method was inefficient:
- Required manual file creation and distribution
- Needed 24-hour waiting period
- Missed real-time collaboration benefits

The `council:` prefix approach is:
- ✅ Real-time responses (3 AIs respond immediately)
- ✅ Automatic integration into conversation context
- ✅ No manual file management
- ✅ Faster decision-making

---

## 🚨 MANDATORY Consultation Triggers

### 1. 実装開始前（REQUIRED）

**When:**
- 新しい機能・システムの実装を開始する前
- 既存システムへの重大な変更を加える前
- アーキテクチャ上の判断が必要な時

**Question Format:**
```
council: この実装を開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: [実装内容]
アプローチ: [予定している設計・方針]
影響範囲: [変更されるファイル・システム]

簡潔に（3-5行以内で）重要なポイントのみを指摘してください。
```

**Why Mandatory:**
- 設計ミスの早期発見
- より良い代替案の発見
- 見落としがちな懸念点の指摘
- 実装後の手戻りを防止

---

### 2. エラー・不具合発生時（REQUIRED）

**When:**
- 実装中にエラーが発生した時
- テストが失敗した時
- 予期しない動作が発生した時
- 2回以上同じエラーが繰り返す時

**Question Format:**
```
council: 以下のエラーが発生しました。解決方法を教えてください。

エラー内容: [エラーメッセージ]
発生箇所: [ファイル・関数名]
試したこと: [既に試した対処]
環境: [関連する設定・バージョン]

根本原因と推奨される解決策を教えてください。
```

**Why Mandatory:**
- エラーの根本原因分析
- より安全な解決策の選択
- 同じエラーの再発防止
- デバッグ時間の短縮

---

### 3. Confidence < 0.8 の場合（STRONGLY RECOMMENDED）

**When:**
- 実装方針に自信が持てない時
- 複数の選択肢があり判断に迷う時
- 未知の領域・新しい技術を使う時

**Question Format:**
```
council: 以下の判断について助言をください。

状況: [現在の状況]
選択肢:
  A) [選択肢A]
  B) [選択肢B]
  C) [選択肢C]

どの選択肢が最適か、またはより良い代替案があれば教えてください。
```

---

## ✅ Consultation Process

### 1. Trigger Detection
- auto-rules.ts の `handlePreImplementationConsultation()` が自動検出
- または手動で `council:` プレフィックスを使用

### 2. Question Preparation
- **最小限の情報**で質問（TRUNCATION耐性）
- Pinned Snapshot（要点のみ）
- 計画（Plan）の要約
- 変更差分（diff予定/影響範囲）

### 3. Council Response Collection
- 3つのAIに並行で質問送信
- 各AIの応答を収集
- タイムアウト: 30秒/AI

### 4. Response Integration
- Jarvis が3つの応答を統合
- 共通する懸念点の抽出
- 最終判断を提示

### 5. Decision Record
- AI Council の助言を AI_MEMORY に記録
- 実装判断の根拠として保持
- Learning Log に追加（Phase 4）

---

## 🚫 Consultation Skip Conditions

以下の場合のみ、相談をスキップ可能：

1. **明示的なスキップ指示**
   - ユーザーが「相談不要」「直接実装」と指示
   - 緊急対応で時間がない場合

2. **軽微な変更**
   - タイポ修正
   - コメント追加
   - ログ出力追加
   - 既存ロジックの移動のみ

3. **Recent Consultation (10分以内)**
   - 同じタスクで10分以内に既に相談済み
   - `consultationHistory` で自動判定

---

## 🎯 Confidence Score Calculation

```typescript
interface ConfidenceScore {
  score: number;        // 0.0 - 1.0
  impact: number;       // 0.0 - 1.0 (変更の影響度)
  complexity: number;   // 0.0 - 1.0 (実装の複雑度)
  novelty: number;      // 0.0 - 1.0 (新規性)
}

// Consultation required if:
// - impact >= 0.7 && score < 0.7
// - score < 0.5
// - novelty >= 0.8
```

**Impact Factors:**
- Gateway本番変更: 0.9
- Bot本番変更: 0.7
- 新規エンドポイント追加: 0.8
- 既存ロジック変更: 0.6
- 新規ファイル追加: 0.4
- テスト追加: 0.2

---

## 📝 Examples

### Example 1: 実装開始前

```
council: Autopilot Engine v1 の実装を開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: Autopilot Engine Core実装
アプローチ:
- Pipeline: Trigger→Context→Plan→Review→Propose→Execute→Learn
- Context Manager: Snapshot常時 + Query必要時のみ
- Approval UX: Telegramカード + インラインボタン
- Action Ledger: 全副作用をdedupeして二重実行防止

影響範囲:
- ~/claude-telegram-bot/src/autopilot/engine.ts (新規)
- ~/claude-telegram-bot/src/utils/action-ledger.ts (新規)
- auto-rules.ts (拡張)

簡潔に（3-5行以内で）重要なポイントのみを指摘してください。
```

### Example 2: エラー発生時

```
council: D1マイグレーション実行中にエラーが発生しました。解決方法を教えてください。

エラー内容: "Cannot read properties of undefined (reading 'prepare')"
発生箇所: ~/memory-gateway/src/janitor.ts:128
試したこと:
- env.STORAGE → env.DB に変更
- wrangler.toml の binding名確認

環境: Cloudflare Workers + D1

根本原因と推奨される解決策を教えてください。
```

### Example 3: 選択肢の判断

```
council: Memory Gateway の実装方針について助言をください。

状況: 既存実装と新仕様に差異がある
選択肢:
  A) 既存実装を活用して高速に進める（テーブル名・フィールド名は既存のまま）
  B) 新仕様通りに新しいテーブルを作成して移行

どの選択肢が最適か、またはより良い代替案があれば教えてください。
```

---

## 🔄 Integration with Existing Systems

### auto-rules.ts Integration

Rule 9: Proactive AI Council Consultation
- 実装系キーワード検出
- 命令形パターン検出
- 自動で council に相談
- 助言を context に保存

### Confidence Router (Phase 4)

```typescript
async function shouldConsultCouncil(
  task: Task,
  confidence: ConfidenceScore
): Promise<boolean> {
  // Mandatory triggers
  if (task.isImplementation && !task.hasConsulted) return true;
  if (task.hasError && task.errorCount >= 2) return true;

  // Confidence-based
  if (confidence.impact >= 0.7 && confidence.score < 0.7) return true;
  if (confidence.score < 0.5) return true;
  if (confidence.novelty >= 0.8) return true;

  return false;
}
```

---

## 📊 Success Metrics

**Target:**
- 実装前相談率: 100% (for major implementations)
- エラー時相談率: 100% (for repeated errors)
- 手戻り削減率: 80%
- 実装時間短縮: 30% (by avoiding mistakes)

**Tracking:**
- `consultationHistory` Map
- Learning Log (Phase 4)
- AI_MEMORY 記録

---

## 🎓 Learning & Improvement

### Learning Log Schema

```typescript
interface CouncilConsultationLog {
  task_id: string;
  consulted_at: string;
  question: string;
  advisors: {
    croppy: string;
    gemmy: string;
    chatty: string;
  };
  decision: string;
  result: 'success' | 'partial' | 'failed';
  learning: string[];
  reuse_score: number; // 0-1
}
```

### Weekly Review

毎週日曜日に：
- 相談回数・成功率を集計
- 頻出する懸念点を抽出
- ルール・閾値を更新
- テンプレートを改善

---

## 🚀 Implementation Status

- [x] Rule 13 in AGENTS.md
- [x] Rule 14: council: prefix usage (2026-02-04)
- [x] docs/jarvis/rules/71-council-policy.md
- [x] auto-rules.ts Rule 9 (Proactive consultation)
- [ ] Confidence Router (Phase 4)
- [ ] Learning Log (Phase 4)
- [ ] Weekly Review automation (Phase 5)

---

**Next Steps:**
1. Enforce Rule 14 (council: prefix) in all AI Council consultations
2. Monitor consultation effectiveness
3. Iterate on question templates
4. Build Confidence Router (Phase 4)
5. Automate Learning Log (Phase 4)
