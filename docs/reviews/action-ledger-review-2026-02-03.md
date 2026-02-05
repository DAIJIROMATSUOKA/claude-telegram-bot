# Action Ledger v1.1 + Autopilot Engine v1 設計レビュー

**Review Date:** 2026-02-03
**Reviewer:** Jarvis (Claude Opus 4.5)
**Task-ID:** AUTOPILOTxMEMORY_v1_2026-02-03

---

## 📋 レビュー概要

既存実装の Action Ledger v1.1 (328行) と Autopilot Engine v1 (530行) について、以下の観点で設計レビューを実施。

**レビュー観点:**
1. Deduplication戦略の妥当性
2. Retry戦略の妥当性
3. Autopilot Engine統合品質
4. 潜在的問題点の特定

---

## ✅ 1. Deduplication戦略の評価

### 実装内容
- **TTL:** 24時間 (default)
- **Storage:** In-memory Map
- **Time-window keys:** hourly/daily/weekly サポート
- **Auto-cleanup:** 1時間ごと

### ✅ 良い点
1. **TTL 24時間は適切** - Autopilotの日次タスクに対して十分
2. **Time-window keysの実装は正しい** - ISO週番号も適切
3. **Auto-cleanup** - メモリリークを防ぐ設計

### ⚠️ 懸念点・改善提案

#### 🔴 Critical: In-memory ledgerの永続化なし
**問題:**
- Bot再起動で全てのdedupe履歴が消失
- 再起動直後に重複タスクが実行される可能性

**推奨:**
Memory Gatewayへの永続化を追加
```typescript
// scope: private/jarvis/action_ledger
async record(dedupeKey: string, metadata?: any, ttl?: number): Promise<string> {
  const id = `ledger_${ulid()}`;
  const entry: LedgerEntry = { ... };

  this.ledger.set(dedupeKey, entry);

  // Memory Gateway に永続化
  await fetch(`${MEMORY_GATEWAY_URL}/v1/memory/append`, {
    method: 'POST',
    body: JSON.stringify({
      scope: 'private/jarvis/action_ledger',
      dedupe_key: dedupeKey,
      type: 'ledger_entry',
      content: JSON.stringify(entry),
      tags: ['action_ledger', 'autopilot'],
    }),
  });

  return id;
}

// 起動時に復元
async restore(): Promise<void> {
  const response = await fetch(`${MEMORY_GATEWAY_URL}/v1/memory/query?scope=private/jarvis/action_ledger`);
  const data = await response.json();

  for (const event of data.events) {
    const entry = JSON.parse(event.content);
    this.ledger.set(entry.dedupe_key, entry);
  }
}
```

#### 🟡 Medium: 競合状態のリスク
**問題:**
- `isDuplicate()` → `record()` 間に race condition が存在
- 並行実行時に同じタスクが複数回実行される可能性

**シナリオ:**
1. Task A が `isDuplicate()` チェック → false
2. Task B が `isDuplicate()` チェック → false (Aがまだrecordされていない)
3. Task A と Task B が両方とも実行される

**推奨:**
Atomic operation を提供
```typescript
async recordIfNotDuplicate(
  dedupeKey: string,
  metadata?: any,
  ttl?: number
): Promise<{ recorded: boolean; id?: string }> {
  if (this.ledger.has(dedupeKey)) {
    const entry = this.ledger.get(dedupeKey)!;
    const now = Date.now();
    const executedAt = new Date(entry.executed_at).getTime();
    const age = now - executedAt;

    if (age <= entry.ttl) {
      return { recorded: false }; // Duplicate
    }
  }

  const id = await this.record(dedupeKey, metadata, ttl);
  return { recorded: true, id };
}
```

**Autopilot Engine側の修正:**
```typescript
// Before (engine.ts:151-158)
const isDuplicate = await this.actionLedger.isDuplicate(...);
if (isDuplicate) { continue; }
// ... generate proposal ...

// After
const { recorded, id } = await this.actionLedger.recordIfNotDuplicate(...);
if (!recorded) { continue; }
// ... generate proposal (already recorded) ...
```

#### 🟢 Minor: Cleanup intervalの管理
**問題:**
- `setInterval()` を constructor で開始すると、テスト時にintervalが残る

**推奨:**
`destroy()` メソッドを追加
```typescript
private cleanupInterval?: NodeJS.Timeout;

destroy(): void {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
  }
  console.log('[ActionLedger] Destroyed cleanup interval');
}
```

---

## ✅ 2. Retry戦略の評価

### 実装内容
- **Exponential backoff:** 1s → 2s → 4s → 8s
- **Jitter:** ±20%
- **Max retries:** 3回
- **Scheduling:** setTimeout()

### ✅ 良い点
1. **Exponential backoff は適切** - ベストプラクティス準拠
2. **Jitter 20% は十分** - Thundering herd問題を緩和
3. **Max retries 3回は妥当** - 過度なリトライを防ぐ

### ⚠️ 懸念点・改善提案

#### 🟡 Medium: setTimeout() の管理不足
**問題:**
- `retryTask()` で setTimeout() を再帰的に呼び出すが、Bot再起動時にtimeoutが残る
- メモリリークの可能性

**推奨:**
timeout IDを保存して、destroy時にクリア
```typescript
private retryTimeouts: Map<string, NodeJS.Timeout> = new Map();

async retryTask(proposal: AutopilotProposal, dedupeKey: string): Promise<void> {
  // ...
  const timeoutId = setTimeout(() => {
    this.retryTask(proposal, dedupeKey).catch(...);
  }, retryInfo.retryAfter);

  this.retryTimeouts.set(dedupeKey, timeoutId);
}

destroy(): void {
  // Clear all retry timeouts
  for (const [key, timeoutId] of this.retryTimeouts.entries()) {
    clearTimeout(timeoutId);
  }
  this.retryTimeouts.clear();
}
```

#### ✅ Good: Retry失敗時のMemory Gateway記録
**良い点:**
- Permanent failure時に `shared/autopilot_failures` に記録（engine.ts:335-342）
- importance: 9 で高優先度マーキング

**改善提案:**
Retry中の一時的失敗もログに記録（デバッグ用）
```typescript
// engine.ts:304-308の後に追加
await this.contextManager.appendMemory({
  scope: 'shared/autopilot_log',
  type: 'retry_attempt',
  title: `Retry ${retryCount}/3: ${proposal.task.title}`,
  content: `Error: ${errorMsg}\nNext retry in ${retryDelay}ms`,
  importance: 5,
  tags: ['autopilot', 'retry'],
});
```

---

## ✅ 3. Autopilot Engine統合品質

### 実装内容
- **Phase 3 (Plan):** `isDuplicate()` でスキップ判定（151-158行）
- **Phase 6 (Execute):** `record()` で重複防止（279行）
- **Retry統合:** `recordFailure()` と `retryTask()` 完全実装（304-405行）

### ✅ 良い点
1. **適切な統合タイミング** - Phase 3で事前チェック、Phase 6で記録
2. **Error handling は堅牢** - try-catch + individual error tracking
3. **AI Council統合済み** - confidence < 0.8 で自動諮問（196-228行）

### ⚠️ 懸念点・改善提案

#### 🟡 Medium: dedupe keyの生成方法
**現状:**
```typescript
const dedupeKey = `autopilot:${trigger.type}:${trigger.title}`;
```

**問題:**
- titleが動的に変わる場合、同じタスクを別物と判定
- 例: "Evening review check" vs "Evening review check (delayed)"

**推奨:**
より安定したkeyを使用
```typescript
// Option 1: Plugin名 + タスクタイプ + 日付
const dedupeKey = ActionLedger.generateTimeWindowKey(
  trigger.source_plugin,
  trigger.type,
  'daily'
);
// Result: "predictive-task-generator:predictive:2026-02-03"

// Option 2: タスクのhash値
const crypto = await import('crypto');
const taskSignature = JSON.stringify({
  plugin: trigger.source_plugin,
  type: trigger.type,
  reason: trigger.reason,
});
const hash = crypto.createHash('sha256').update(taskSignature).digest('hex').slice(0, 16);
const dedupeKey = `autopilot:${trigger.type}:${hash}`;
```

#### 🟢 Minor: Retryロジックの分散
**問題:**
- engine.ts内でretryロジックが分散（320-405行）
- コードの重複

**推奨:**
ActionLedger側に `executeWithRetry()` ヘルパーを追加
```typescript
// action-ledger.ts
async executeWithRetry<T>(
  dedupeKey: string,
  fn: () => Promise<T>,
  options?: {
    onRetry?: (retryCount: number, error: string, retryAfter: number) => void;
    onFailure?: (error: string) => void;
  }
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const result = await fn();
    await this.resetRetryCount(dedupeKey);
    return { success: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const retryInfo = await this.recordFailure(dedupeKey, errorMsg);

    if (retryInfo.shouldRetry) {
      const retryCount = await this.getRetryCount(dedupeKey);
      options?.onRetry?.(retryCount, errorMsg, retryInfo.retryAfter!);

      // Schedule retry
      setTimeout(() => {
        this.executeWithRetry(dedupeKey, fn, options);
      }, retryInfo.retryAfter);

      return { success: false, error: errorMsg };
    } else {
      options?.onFailure?.(errorMsg);
      return { success: false, error: errorMsg };
    }
  }
}
```

**engine.ts での使用例:**
```typescript
const result = await this.actionLedger.executeWithRetry(
  dedupeKey,
  () => plugin.executeTask(proposal.task),
  {
    onRetry: (retryCount, error, retryAfter) => {
      this.bot.sendMessage(
        this.chatId,
        `⚠️ Task failed: ${proposal.task.title}\nRetrying (${retryCount}/3) in ${Math.round(retryAfter / 1000)}s...`
      );
    },
    onFailure: (error) => {
      this.bot.sendMessage(
        this.chatId,
        `❌ Task permanently failed: ${proposal.task.title}\nMax retries exceeded.`
      );
    },
  }
);
```

---

## 🔍 4. 潜在的問題点の特定

### 🔴 Critical Issues
**なし** - 致命的な問題は検出されませんでした

### 🟡 Medium Issues
1. **In-memory ledgerの永続化なし** - Bot再起動で履歴消失
2. **競合状態のリスク** - `isDuplicate()` と `record()` のrace condition
3. **setTimeout()の管理不足** - メモリリーク・再起動時の残留timeout

### 🟢 Minor Issues
1. **dedupe keyの生成方法** - titleの動的変更に弱い
2. **Cleanup intervalの管理** - destroy()メソッドなし
3. **Retry中の一時失敗ログなし** - デバッグ時に不便

---

## 📊 総合評価

| 観点 | 評価 | 備考 |
|------|------|------|
| **Deduplication戦略** | 8/10 | TTL・Time-window keysは適切。永続化とrace condition対策が必要 |
| **Retry戦略** | 9/10 | Exponential backoff + Jitterは優秀。setTimeout管理のみ改善 |
| **Autopilot統合** | 9/10 | 適切な統合タイミング。dedupe key生成のみ改善余地 |
| **エラーハンドリング** | 9/10 | 堅牢な設計。Retry中のログ追加が望ましい |
| **コード品質** | 8/10 | 適切な型定義・コメント。リファクタリングで9/10到達可能 |
| **全体設計** | **8.5/10** | 実用的で堅牢。永続化とrace condition対策で9.5/10に到達可能 |

---

## 🎯 推奨改善策（優先度順）

### Priority 1: 必須改善（Phase 3.5で実装）
1. ✅ **Memory Gateway永続化** - Bot再起動対策
   - `record()` 時に Memory Gateway に append
   - 起動時に `restore()` で復元
   - Impact: **High** - 再起動時の重複実行を防止

2. ✅ **`recordIfNotDuplicate()` atomic operation** - Race condition対策
   - isDuplicate + record を1つのメソッドに統合
   - Autopilot Engine側も修正
   - Impact: **High** - 並行実行時の重複を防止

### Priority 2: 推奨改善（Phase 4で実装）
3. 🔄 **`destroy()` メソッド追加** - リソース管理
   - Cleanup interval + retry timeouts クリア
   - テスト時のメモリリーク防止
   - Impact: **Medium** - テスト品質向上

4. 🔄 **dedupe key生成の改善** - 安定性向上
   - Plugin名 + hash値の併用
   - Time-window keys との統合
   - Impact: **Medium** - 誤判定を減少

### Priority 3: 任意改善（Phase 5以降）
5. 📝 **Retry中の一時失敗ログ** - デバッグ支援
   - Memory Gateway に retry_attempt として記録
   - Impact: **Low** - デバッグ時に便利

6. 📝 **`executeWithRetry()` ヘルパー** - コードの簡潔化
   - ActionLedger側にretryロジックを統合
   - engine.ts のコード量を削減
   - Impact: **Low** - 可読性向上

---

## 📝 結論

**Action Ledger v1.1 + Autopilot Engine v1 は実用レベルの高品質な実装です。**

### ✅ 強み
- Deduplication・Retry戦略は業界標準に準拠
- Autopilot Engineとの統合は適切
- エラーハンドリングは堅牢
- AI Council統合も完了

### ⚠️ 改善が必要な点
- In-memory ledgerの永続化（Priority 1）
- Race condition対策（Priority 1）
- setTimeout管理（Priority 2）

### 🎯 次のステップ
1. **Phase 3.5**: Priority 1の必須改善を実装
2. **Phase 4**: Priority 2の推奨改善を実装
3. **Phase 5**: Priority 3の任意改善を検討

**推定実装時間:**
- Priority 1: 2-3時間
- Priority 2: 1-2時間
- Priority 3: 1時間

**総合評価: 8.5/10** → Priority 1実装後 **9.5/10** 到達可能

---

**Reviewed by:** Jarvis🤖 (Claude Opus 4.5)
**Review completed:** 2026-02-03 10:23 JST
