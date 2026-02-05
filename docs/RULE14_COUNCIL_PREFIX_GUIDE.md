# Rule 14: AI Council council: Prefix Usage Guide

**Date:** 2026-02-04
**Status:** MANDATORY (System-level enforcement)
**Priority:** CRITICAL

---

## 📋 Overview

This guide explains how to use the `council:` prefix for AI Council consultations, replacing the previous document-based approach.

**AI Council Members:**
- 🦞 **クロッピー** (Claude Opus 4.5 via claude.ai)
- 💎 **ジェミー** (Gemini 2.0 Flash)
- 🧠 **チャッピー** (ChatGPT 4)

---

## 🔑 Rule 14: AI Council MUST USE council: PREFIX

### Required Method

**✅ CORRECT:**
```
council: Phase 3 Golden Test Frameworkの実装を開始します。設計上の懸念点を教えてください。

タスク: Golden Test Framework実装
アプローチ: 3-axis scoring (Severity 50%, Blast Radius 30%, Frequency 20%)
影響範囲: src/autopilot/golden-test-*.ts
```

**❌ INCORRECT (Old Method):**
```
1. Create: docs/ai-council-consultation-phase3.md
2. Wait 24 hours for responses
3. Create: docs/ai-council-responses-phase3.md
4. Manually distribute to each AI
```

---

## 🚨 Why This Rule Exists

### Problems with Old Method:
- ❌ Required manual file creation and distribution
- ❌ 24-hour waiting period
- ❌ Missed real-time collaboration benefits
- ❌ No automatic context integration
- ❌ Inefficient workflow

### Benefits of council: Prefix:
- ✅ **Real-time responses** - 3 AIs respond immediately
- ✅ **Automatic integration** - Responses added to conversation context
- ✅ **No file management** - No manual document creation
- ✅ **Faster decisions** - Minutes instead of hours
- ✅ **Better collaboration** - AIs can build on each other's responses

---

## 📝 Usage Examples

### Example 1: Pre-Implementation Consultation

**Scenario:** Starting Phase 3 Golden Test Framework implementation

**Message:**
```
council: Phase 3 Autopilot CI (Golden Test Framework)の実装を開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: Golden Test Framework実装
アプローチ:
- AccidentPatternExtractor: 過去の事故パターンを抽出
- TestSelectionEngine: 3-axis scoring (Severity 50%, Blast Radius 30%, Frequency 20%)
- GoldenTestEngine: テスト実行 + Kill Switch評価
- TestCoverageTracker: カバレッジ追跡

影響範囲:
- src/autopilot/golden-test-types.ts (新規)
- src/autopilot/golden-test-engine.ts (新規)
- src/autopilot/test-selection-engine.ts (新規)
- src/autopilot/accident-pattern-extractor.ts (新規)
- src/autopilot/test-coverage-tracker.ts (新規)

質問:
1. Golden Test選定基準（severity重視 vs frequency重視?）
2. Flaky test対策（retry回数・判定基準）
3. Kill Switch発動閾値（即座 vs 遅延?）

簡潔に（3-5行以内で）重要なポイントのみを指摘してください。
```

**Expected Response:**
- クロッピー🦞: Pragmatic engineering perspective
- ジェミー💎: Systems thinking and holistic view
- チャッピー🧠: Safety-first design and risk analysis
- **Jarvis:** Synthesizes responses and provides recommendation

---

### Example 2: Error Resolution Consultation

**Scenario:** D1 migration error during Memory Gateway deployment

**Message:**
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

**Expected Response:**
- クロッピー🦞: Likely root cause (binding name mismatch)
- ジェミー💎: Check wrangler.toml config structure
- チャッピー🧠: Verify D1 database initialization
- **Jarvis:** Provides concrete fix steps

---

### Example 3: Design Decision Consultation

**Scenario:** Choosing between implementation options

**Message:**
```
council: Memory Gateway の実装方針について助言をください。

状況: 既存実装と新仕様に差異がある
選択肢:
  A) 既存実装を活用して高速に進める（テーブル名・フィールド名は既存のまま）
  B) 新仕様通りに新しいテーブルを作成して移行

どの選択肢が最適か、またはより良い代替案があれば教えてください。
```

**Expected Response:**
- クロッピー🦞: Recommends Option A for speed, but notes tech debt
- ジェミー💎: Suggests hybrid approach (gradual migration)
- チャッピー🧠: Emphasizes backward compatibility and rollback plan
- **Jarvis:** Recommends Option A with clear migration plan documented

---

## 🎯 When to Use council: Prefix

### Mandatory Consultation Triggers

1. **Pre-Implementation (REQUIRED)**
   - Starting new feature/system implementation
   - Major changes to existing systems
   - Architectural decisions

2. **Error Resolution (REQUIRED)**
   - Errors occurred during implementation
   - Test failures
   - Unexpected behavior
   - Same error repeats 2+ times

3. **Low Confidence (RECOMMENDED)**
   - Confidence < 0.8 in implementation approach
   - Multiple valid options exist
   - Unfamiliar territory/new technologies

---

## 🚫 Skip Conditions

Only skip `council:` consultation when:

1. **User Explicitly Requests Skip**
   - "相談不要"
   - "直接実装"
   - Emergency situations with no time

2. **Trivial Changes**
   - Typo fixes
   - Comment additions
   - Log output additions
   - Code movement only

3. **Recent Consultation (< 10 minutes)**
   - Same task consulted within last 10 minutes
   - Auto-tracked via `consultationHistory`

---

## 🔄 Integration with Existing Systems

### Auto-Rules Integration

**File:** `src/utils/auto-rules.ts`

**Rule 9: Proactive AI Council Consultation**
- Detects implementation keywords
- Detects imperative patterns
- Automatically consults council
- Stores advice in context

**Detection Patterns:**
```typescript
const IMPLEMENTATION_KEYWORDS = [
  '実装', '開発', '作成', '構築', 'implement', 'develop', 'build', 'create'
];

const IMPERATIVE_PATTERNS = [
  /〜を(実装|作成|開発|構築)して/,
  /〜システムを/,
  /〜機能を追加/,
  /〜APIを/,
];
```

### AI Council Helper Integration

**File:** `src/utils/ai-council-helper.ts`

**Function:**
```typescript
export async function consultAICouncil(
  api: Api,
  chatId: number,
  question: string,
  options?: {
    sendToUser?: boolean;
    includePrefix?: boolean;
  }
): Promise<CouncilConsultationResult> {
  // 1. Send question to 3 AIs in parallel
  // 2. Collect responses with 30s timeout per AI
  // 3. Synthesize responses
  // 4. Return integrated advice
}
```

---

## 📊 Success Metrics

### Target Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Pre-implementation consultation rate | 100% | - |
| Error consultation rate (repeated errors) | 100% | - |
| Hand-back reduction | 80% | - |
| Implementation time reduction | 30% | - |

### Tracking

- `consultationHistory` Map in session
- Learning Log (Phase 4)
- AI_MEMORY records

---

## 🎓 Learning & Improvement

### Consultation Log Schema

```typescript
interface CouncilConsultationLog {
  task_id: string;
  consulted_at: string;
  question: string;
  advisors: {
    croppy: string;   // クロッピー's response
    gemmy: string;    // ジェミー's response
    chatty: string;   // チャッピー's response
  };
  decision: string;   // Final decision
  result: 'success' | 'partial' | 'failed';
  learning: string[]; // Key learnings
  reuse_score: number; // 0-1 (reusability of this advice)
}
```

### Weekly Review (Automated in Phase 5)

Every Sunday:
- Aggregate consultation count and success rate
- Extract frequently mentioned concerns
- Update rules and thresholds
- Improve question templates

---

## 🔧 Implementation Checklist

- [x] Rule 14 added to `docs/jarvis/rules/71-council-policy.md`
- [x] Rule 14 added to `AGENTS.md`
- [x] Implementation guide created (`docs/RULE14_COUNCIL_PREFIX_GUIDE.md`)
- [ ] Update `auto-rules.ts` to enforce council: prefix (if not already)
- [ ] Update `ai-council-helper.ts` to handle council: prefix (if not already)
- [ ] Test council: prefix with actual consultation
- [ ] Verify responses are properly integrated into context
- [ ] Document lessons learned from first consultation

---

## 🚀 Next Steps

1. **Test Rule 14 Implementation**
   - Send test consultation with `council:` prefix
   - Verify all 3 AIs respond
   - Confirm responses are integrated into context

2. **Update Auto-Rules (if needed)**
   - Ensure `auto-rules.ts` detects `council:` prefix
   - Verify automatic consultation triggers work

3. **Monitor Effectiveness**
   - Track consultation usage
   - Measure hand-back reduction
   - Iterate on question templates

---

## 📚 Related Documentation

- **AI Council Policy:** `docs/jarvis/rules/71-council-policy.md`
- **AI Council README:** `docs/AI-COUNCIL-README.md`
- **Auto-Rules:** `src/utils/auto-rules.ts`
- **AI Council Helper:** `src/utils/ai-council-helper.ts`

---

**Last Updated:** 2026-02-04
**Rule Owner:** Jarvis Autopilot System
**Review Frequency:** Monthly
