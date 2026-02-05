# Operator OS v1 - Architecture Design

**Version**: 1.0
**Date**: 2026-02-04
**Status**: Phase 0.2 - Design Complete

---

## 🎯 Core Goals

1. **Control Tower**: 1つのピン留めメッセージ（個人DM）をeditMessageTextで更新
2. **Notification Budget**: 最大2通（開始+完了のみ）
3. **Work Memory**: /whyコマンドで「何をしたか」説明

---

## 🏗️ Architecture Overview

```
User Message
    ↓
Operator OS Entry
    ↓
┌─────────────────────────────────────┐
│ Control Tower Service               │
│ - 1つのピン留めメッセージ管理         │
│ - editMessageText（通知0）           │
│ - 状態遷移追跡                        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Task Execution                      │
│ - NotificationBuffer統合             │
│ - Work Memory記録                    │
└─────────────────────────────────────┘
    ↓
Final Notification（通知1）
```

---

## 📊 Component Design

### 1️⃣ Control Tower Service

**責務:**
- 個人DM（DJ専用）にピン留めメッセージを1つ維持
- editMessageTextで更新（新規通知なし）
- タスク状態の追跡と表示

**Message Format:**
```
🎛️ **Control Tower**
Last Update: <!date^{ts}^{date_short} {time}|{fallback}>

📋 Current Task
Status: [queued|running|blocked|done|failed|canceled]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 Reading file.ts
✏️ Editing...
▶️ Running tests...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Progress: [████████░░] 80%

/why - Show work memory
/stop - Cancel task
```

**Key Features:**
- Slack-style timestamp formatting: `<!date^{ts}^{date_short} {time}|fallback>`
- Real-time progress updates (no new notifications)
- Interactive commands via inline buttons
- Secrets filtering: `[REDACTED]` for sensitive data

---

### 2️⃣ State Machine

**State Definitions:**

| State | Description | Next States | Notification |
|-------|-------------|-------------|--------------|
| `queued` | タスク待機中 | running | None |
| `running` | 実行中 | done, blocked, failed | Start (1通) |
| `blocked` | 依存待ち or ユーザー承認待ち | running, canceled | None |
| `done` | 完了 | - | End (1通) |
| `failed` | エラー終了 | queued (retry) | End (1通) |
| `canceled` | キャンセル | - | End (1通) |

**State Transition Rules:**
```typescript
const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  queued: ['running'],
  running: ['done', 'blocked', 'failed', 'canceled'],
  blocked: ['running', 'canceled'],
  done: [],
  failed: ['queued'], // Retry only
  canceled: [],
};
```

**Blocked State Triggers:**
- User approval required (Autopilot)
- External dependency not ready
- Resource unavailable (M3 offline)

**Blocked State Resolution:**
- Manual approval: User clicks inline button
- Dependency resolved: Auto-resume
- Timeout: Auto-cancel after 10 minutes

---

### 3️⃣ Update Control

**Throttling Strategy:**

```typescript
class ControlTowerThrottle {
  private lastUpdateTs: number = 0;
  private pendingUpdates: string[] = [];
  private readonly MIN_INTERVAL_MS = 5000; // 5 seconds

  async update(message: string): Promise<void> {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTs;

    if (timeSinceLastUpdate < this.MIN_INTERVAL_MS) {
      // Queue update
      this.pendingUpdates.push(message);
      return;
    }

    // Flush pending updates + new message
    const batch = [...this.pendingUpdates, message];
    this.pendingUpdates = [];

    await this.flushBatch(batch);
    this.lastUpdateTs = now;
  }

  private async flushBatch(messages: string[]): Promise<void> {
    // Combine messages and update Control Tower
    const combined = messages.join('\n');
    await controlTower.editMessage(combined);
  }
}
```

**Benefits:**
- Reduces Telegram API calls (rate limit prevention)
- Batches rapid updates
- Maintains UX responsiveness (5s is acceptable)

**Drawbacks (AI Council concerns):**
- 5s delay for critical updates
  - **Mitigation**: Priority flag for urgent updates (bypass throttle)

---

### 4️⃣ Secrets & Retention

**Secrets Filtering:**

```typescript
const SENSITIVE_PATTERNS = [
  /ANTHROPIC_API_KEY=.*/g,
  /TELEGRAM_BOT_TOKEN=.*/g,
  /sk-ant-api[0-9]+-[A-Za-z0-9_-]+/g, // Anthropic API key pattern
  /\d{10}:AA[A-Za-z0-9_-]{35}/g,      // Telegram token pattern
];

function sanitize(text: string): string {
  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}
```

**Retention Policy:**
- **Control Tower Message**: Permanent (pinned in DM)
- **Work Memory Records**: 7 days (auto-delete via cron)
- **Activity Logs**: 7 days (auto-delete via cron)

**Cleanup Cron:**
```sql
-- Delete records older than 7 days
DELETE FROM work_memory
WHERE created_at < NOW() - INTERVAL '7 days';
```

---

### 5️⃣ Recovery Procedures

**message_id Corruption Detection:**

```typescript
async function detectCorruption(): Promise<boolean> {
  try {
    // Try to edit the pinned message
    await bot.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      'Health check'
    );
    return false; // No corruption
  } catch (error) {
    if (error.message.includes('message_not_found')) {
      return true; // Corruption detected
    }
    throw error; // Other error
  }
}
```

**Auto-Recovery Flow:**

```
1. Detect corruption (message_not_found)
    ↓
2. Create new pinned message
    ↓
3. Update DB with new message_id
    ↓
4. Unpin old message (if exists)
    ↓
5. Pin new message
    ↓
6. Log recovery event
```

**Recovery Implementation:**

```typescript
async function recoverControlTower(): Promise<void> {
  console.warn('[ControlTower] message_id corrupted, recovering...');

  // Create new pinned message
  const newMessage = await bot.telegram.sendMessage(
    chatId,
    '🎛️ **Control Tower** (Recovered)\n\nInitializing...'
  );

  // Update DB
  await db.update('control_tower', {
    message_id: newMessage.message_id,
    rev: db.raw('rev + 1'), // Increment rev for optimistic lock
    recovered_at: new Date(),
  });

  // Pin new message
  await bot.telegram.pinChatMessage(chatId, newMessage.message_id);

  // Unpin old (if possible)
  try {
    await bot.telegram.unpinChatMessage(chatId, oldMessageId);
  } catch {
    // Ignore if old message already gone
  }

  console.info('[ControlTower] Recovery complete');
}
```

---

### 6️⃣ Concurrency Control

**Optimistic Locking with `rev`:**

```typescript
interface ControlTowerRecord {
  message_id: number;
  chat_id: number;
  content: string;
  rev: number;          // Revision number for optimistic lock
  updated_at: Date;
}

async function updateWithOptimisticLock(
  newContent: string,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Read current rev
      const current = await db.query<ControlTowerRecord>(
        'SELECT * FROM control_tower WHERE chat_id = $1',
        [chatId]
      );

      if (!current) {
        throw new Error('Control Tower record not found');
      }

      // Update with rev check
      const result = await db.execute(
        `UPDATE control_tower
         SET content = $1, rev = rev + 1, updated_at = NOW()
         WHERE chat_id = $2 AND rev = $3
         RETURNING rev`,
        [newContent, chatId, current.rev]
      );

      if (result.rowCount === 0) {
        // Conflict detected, retry
        console.warn(`[ControlTower] Optimistic lock conflict (attempt ${attempt}/${maxRetries})`);
        await sleep(100 * attempt); // Exponential backoff
        continue;
      }

      // Success, update Telegram
      await bot.telegram.editMessageText(
        chatId,
        current.message_id,
        undefined,
        newContent
      );

      return; // Success

    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Failed to update after ${maxRetries} attempts: ${error}`);
      }
    }
  }
}
```

**Conflict Resolution:**
- Retry with exponential backoff: 100ms → 200ms → 300ms
- Max 3 retries
- Final failure: Log error + notify user

**AI Council Concern (クロッピー):**
> 無限ループ防止に最大リトライ回数（3回程度）を設定すべき

✅ **Implemented**: Max 3 retries with exponential backoff

---

## 🗄️ Database Schema (Preview)

```sql
-- Control Tower state
CREATE TABLE control_tower (
  chat_id BIGINT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'blocked', 'done', 'failed', 'canceled')),
  rev INTEGER NOT NULL DEFAULT 1, -- Optimistic lock
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  recovered_at TIMESTAMP -- Last recovery timestamp
);

-- Work Memory (retention: 7 days)
CREATE TABLE work_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  task_id TEXT NOT NULL,
  activity_type TEXT NOT NULL, -- 'tool' | 'thinking' | 'text' | 'error'
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for cleanup cron
CREATE INDEX idx_work_memory_created_at ON work_memory(created_at);
```

---

## 🔄 Integration Points

### Existing NotificationBuffer

**Current Implementation:**
- `src/utils/notification-buffer.ts`
- Phase-based notifications (start + end)
- Activity buffering (no notifications)

**Integration Strategy:**
- Replace `ctx.reply()` → `controlTower.update()`
- Keep phase-based logic
- Add Work Memory recording

**Migration Path:**
```typescript
// Before
await ctx.reply('🔄 Phase started');
notificationBuffer.addActivity('tool', 'Reading...');
await ctx.reply('✅ Phase completed');

// After
await controlTower.startTask('Phase started'); // Notification 1
controlTower.update('🔄 Reading...'); // editMessageText (no notification)
await controlTower.finishTask('Phase completed'); // Notification 2
```

---

## 🚧 AI Council Concerns & Mitigations

### 1. DM Pin Control (ジェミー💎)

**Concern**:
> DMのピン留めはプラットフォームAPIで直接制御が難しい場合が多い

**Investigation Required:**
- Telegram Bot API: `pinChatMessage` works in DMs ✅
- Verify with test implementation

**Mitigation:**
- Manual pin as fallback
- Store `pinned: boolean` flag in DB
- Warn user if auto-pin fails

---

### 2. State Transition Rules (ジェミー💎)

**Concern**:
> 定義された状態間の遷移ルール（どの状態からどの状態へ移行可能か）を明確にする必要がある

✅ **Implemented**: `VALID_TRANSITIONS` mapping (see Section 2️⃣)

---

### 3. Throttling UX Impact (ジェミー💎)

**Concern**:
> スロットリングは情報伝達のリアルタイム性を損なう可能性

**Mitigation:**
- Priority flag for urgent updates
- 5s is acceptable for non-critical updates
- Emergency updates bypass throttle

```typescript
async function updateUrgent(message: string): Promise<void> {
  // Bypass throttle for critical updates
  await controlTower.editMessage(message);
  this.lastUpdateTs = Date.now();
}
```

---

### 4. Retention Compliance (ジェミー💎)

**Concern**:
> `retention 7日間` が法的・監査要件を満たしているか確認が必要

**Justification:**
- Work Memory is operational data (not audit logs)
- Audit logs stored separately (90 days retention)
- 7 days sufficient for debugging

---

### 5. Optimistic Lock Performance (ジェミー💎)

**Concern**:
> 楽観ロックは競合が多い環境でリトライが増加し、性能ボトルネックとなる可能性

**Mitigation:**
- Single-user system (DJ only)
- Low contention expected
- Max 3 retries prevents infinite loops
- Exponential backoff (100ms → 200ms → 300ms)

---

## 📝 Next Steps (Phase 0.3)

1. **DB Schema Finalization**
   - Supabase table creation
   - Migration scripts
   - Indexes for performance

2. **Control Tower Service Implementation**
   - TypeScript class definition
   - Telegram API integration
   - Optimistic locking

3. **/why Command Implementation**
   - Work Memory query
   - Markdown formatting
   - Inline button for details

---

## 🎓 Design Principles

1. **Single Source of Truth**: Control Tower message is the SSOT for current state
2. **Zero-Notification Updates**: All intermediate updates via editMessageText
3. **Graceful Degradation**: Manual fallbacks for automation failures
4. **Security First**: Secrets filtering at all layers
5. **Observability**: All state changes logged for debugging

---

**Design approved by AI Council:**
- 🦞 クロッピー: Optimistic lock + recovery flow 承認
- 💎 ジェミー: State transitions + throttling mitigation 承認
- 🧠 チャッピー: Secrets policy + schema design 承認

**Ready for Phase 0.3: DB Schema Implementation**
