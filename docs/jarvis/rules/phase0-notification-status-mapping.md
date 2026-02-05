# Phase 0: 現状通知箇所の全列挙 + ステータスマッピング

**作成日:** 2026-02-04
**Phase:** Phase 0 - 現状把握
**STOP CONDITION:** 固定statusマッピング完了

---

## 1. 現状の通知箇所（全26箇所）

```
src/autopilot/plugins/weekly-review.ts
src/autopilot/engine.ts
src/autopilot/golden-test-seed-data.ts
src/utils/ci-notifications.ts
src/autopilot/types.ts
src/tests/phase1-integration-test.ts
src/utils/execution-router.ts
src/mesh/mesh-registry.ts
src/services/proactive-secretary.ts
src/utils/m3-agent-client.ts
src/jobs/autopilot-cron.ts
src/autopilot/plugins/evening-review.ts
src/autopilot/plugins/morning-briefing.ts
src/handlers/auto-rules.ts
src/handlers/text.ts
src/utils/notification-buffer.ts
src/index.ts
src/autopilot/test-autopilot.ts
src/autopilot/approval-ux.ts
src/utils/ai-council-helper.ts
src/handlers/callback.ts
src/features/ai_council/telegramSend.ts
src/handlers/document.ts
src/handlers/photo.ts
src/handlers/voice.ts
src/session.ts
```

---

## 2. 既存の通知状態（現状）

### 2.1 streaming.ts の StatusCallback

| statusType | 説明 | 用途 |
|-----------|------|------|
| `thinking` | LLMの思考中 | Claude APIのthinking phase |
| `tool` | ツール実行中 | Read/Edit/Bash等の実行 |
| `text` | テキスト応答 | Claude APIのテキスト生成 |
| `segment_end` | セグメント終了 | ストリーミングの区切り |
| `done` | ストリーミング完了 | 全応答完了 |

### 2.2 NotificationBuffer の PhaseActivity.type

| type | icon | 説明 |
|------|------|------|
| `tool` | 🛠 | ツール実行 |
| `thinking` | 🧠 | 思考 |
| `text` | 📝 | テキスト生成 |
| `error` | ⚠️ | エラー |

---

## 3. 固定ステータスへのマッピング（統一仕様）

**設計原則:**
- D1テーブルの `status` カラムは **TEXT型の固定enum**
- 既存の状態を全て統一ステータスにマップ
- 新規状態の追加は禁止（既存状態のみ使用）

### 3.1 固定ステータス定義（jarvis_control_tower.status）

```sql
CREATE TABLE jarvis_control_tower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'idle',           -- アイドル状態
    'thinking',       -- LLM思考中
    'planning',       -- プラン生成中
    'executing',      -- アクション実行中
    'waiting_approval', -- ユーザー承認待ち
    'completed',      -- 完了
    'error'           -- エラー
  )),
  phase TEXT,         -- 任意のphase名（例: "Phase 3: Implementation"）
  current_action TEXT, -- 現在のアクション（例: "Reading file.ts"）
  started_at INTEGER NOT NULL, -- UNIX timestamp
  updated_at INTEGER NOT NULL,
  metadata TEXT,      -- JSON形式の追加情報
  UNIQUE(session_id)
);
```

### 3.2 マッピングルール

| 既存の状態 | 固定status | 理由 |
|-----------|-----------|------|
| streaming.ts: `thinking` | `thinking` | そのまま |
| streaming.ts: `tool` | `executing` | ツール実行中 |
| streaming.ts: `text` | `executing` | テキスト生成も実行の一部 |
| streaming.ts: `segment_end` | `executing` | まだストリーミング中 |
| streaming.ts: `done` | `completed` | 完了 |
| NotificationBuffer: `tool` | `executing` | ツール実行中 |
| NotificationBuffer: `thinking` | `thinking` | そのまま |
| NotificationBuffer: `text` | `executing` | テキスト生成中 |
| NotificationBuffer: `error` | `error` | エラー |
| Autopilot: approval待ち | `waiting_approval` | 承認待ち |
| Autopilot: planning | `planning` | プラン生成中 |
| 初期状態 | `idle` | 何もしていない |

---

## 4. D1テーブル設計（3テーブル）

### 4.1 jarvis_control_tower（現在の状態）

```sql
CREATE TABLE jarvis_control_tower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'idle',
    'thinking',
    'planning',
    'executing',
    'waiting_approval',
    'completed',
    'error'
  )),
  phase TEXT,
  current_action TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  UNIQUE(session_id)
);

CREATE INDEX idx_control_tower_session ON jarvis_control_tower(session_id);
CREATE INDEX idx_control_tower_status ON jarvis_control_tower(status);
```

### 4.2 jarvis_action_trace（履歴）

```sql
CREATE TABLE jarvis_action_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- "tool", "thinking", "text", "error", etc.
  action_name TEXT,          -- "Read", "Edit", "Bash", etc.
  status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  metadata TEXT,
  FOREIGN KEY(session_id) REFERENCES jarvis_control_tower(session_id)
);

CREATE INDEX idx_action_trace_session ON jarvis_action_trace(session_id);
CREATE INDEX idx_action_trace_type ON jarvis_action_trace(action_type);
CREATE INDEX idx_action_trace_status ON jarvis_action_trace(status);
```

### 4.3 jarvis_settings（設定）

```sql
CREATE TABLE jarvis_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- デフォルト設定
INSERT INTO jarvis_settings (key, value, updated_at) VALUES
  ('notification_buffer_enabled', 'true', strftime('%s', 'now')),
  ('phase_notifications_enabled', 'true', strftime('%s', 'now')),
  ('spam_prevention_threshold', '10', strftime('%s', 'now'));
```

---

## 5. Phase 0 STOP CONDITION チェック

- ✅ 現状の通知箇所を全列挙（26箇所）
- ✅ 既存の「状態」を固定statusにマップ
- ✅ D1テーブル設計（3テーブル）

**次のステップ: Phase 1開始承認待ち**

---

## 6. 既存実装との統合ポイント

### 6.1 streaming.ts の修正

```typescript
// Before:
if (statusType === "thinking") {
  notificationBuffer.addActivity("thinking", preview);
}

// After:
if (statusType === "thinking") {
  await updateControlTower(sessionId, "thinking", phaseName, preview);
  await traceAction(sessionId, "thinking", preview);
}
```

### 6.2 notification-buffer.ts の修正

```typescript
// Before:
async startPhase(ctx: Context, phaseName: string): Promise<void> {
  this.currentPhase = phaseName;
  await ctx.reply(`🔄 ${phaseName}`);
}

// After:
async startPhase(ctx: Context, phaseName: string): Promise<void> {
  const sessionId = getSessionId(ctx);
  this.currentPhase = phaseName;

  // D1に記録
  await updateControlTower(sessionId, "planning", phaseName, null);

  // 通知送信
  await ctx.reply(`🔄 ${phaseName}`);
}
```

---

## 7. 既存機能の保持

- ✅ NotificationBuffer は削除せず、D1統合
- ✅ spam prevention（10通以上連続通知禁止）は維持
- ✅ Phase通知（開始1通 + 完了1通）は維持
- ✅ streaming.ts の status callback は維持

---

**Phase 0完了 - ユーザー承認待ち**
