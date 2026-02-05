# 🦞 Croppy Context Sharing System

**Status**: ALL PHASES COMPLETE ✅

croppyがclaude.aiと同じように文脈を持って会話できるシステム。

---

## 📋 概要

### 目的
- croppy:呼び出し時に現在の状態と会話履歴を自動注入
- 「さっきの話」「先週のあれ」が通じるようになる
- 文脈を保持したまま自然な会話を実現

### 実装されたPhase

- ✅ **Phase 1**: DBテーブル作成（jarvis_context, jarvis_chat_history）
- ✅ **Phase 2**: 会話履歴の自動保存（user + assistant）
- ✅ **Phase 3**: jarvis_context 自動更新（task, phase, assumptions, decisions）
- ✅ **Phase 4**: croppy呼び出し時の文脈自動注入
- ✅ **Phase 5**: `croppy: debug` コマンド実装

---

## 🗄️ データベース設計

### jarvis_context テーブル
```sql
CREATE TABLE jarvis_context (
  user_id TEXT PRIMARY KEY,
  current_task TEXT,              -- 現在のタスク
  current_phase TEXT,             -- 現在のPhase
  current_assumption TEXT,        -- 前提条件
  important_decisions TEXT,       -- 重要な決定
  updated_at TEXT
);
```

**更新タイミング:**
- Phase開始/完了時
- タスク変更時
- 重要な決定時

### jarvis_chat_history テーブル
```sql
CREATE TABLE jarvis_chat_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT
);
```

**保存タイミング:**
- ユーザーメッセージ受信時（即座）
- アシスタント応答完了時（即座）

**保持期間:** 30日（古いデータは自動削除）

---

## 🔄 動作フロー

### croppy: 呼び出し時

```
1. ユーザー: "croppy: 今の進捗は？"
   ↓
2. text.ts: croppy: プレフィックス検出
   ↓
3. buildCroppyPrompt()
   ├─ getJarvisContext() → 現在の状態
   ├─ getChatHistory(10) → 直近10件の会話
   └─ getMemoryPack() → AI_MEMORY
   ↓
4. プロンプト構築:
   === 📋 現在の状態 ===
   現在のタスク: Darwin Engine v1.2.2
   現在のPhase: Phase 5
   ...

   === 💬 直近の会話（10件） ===
   1. [DJ] ...
   2. [Jarvis] ...
   ...

   === 🧠 AI_MEMORY ===
   ...

   === ❓ DJの質問 ===
   今の進捗は？
   ↓
5. callClaudeCLI() → Telegram転送（無料）
   ↓
6. croppy応答（文脈を理解した上での返答）
```

### 文脈の自動更新

```
1. Jarvis応答完了
   ↓
2. autoUpdateContext()
   ├─ extractCurrentTask() → タスク抽出
   ├─ extractCurrentPhase() → Phase抽出
   ├─ extractAssumptions() → 前提条件抽出
   └─ extractImportantDecisions() → 決定事項抽出
   ↓
3. updateJarvisContext() → DB更新
```

---

## 📁 ファイル構成

### 新規作成ファイル

```
src/utils/
├── chat-history.ts           # 会話履歴管理
├── jarvis-context.ts         # jarvis_context 管理
└── croppy-context.ts         # croppy文脈注入

migrations/
└── 0007_croppy_context.sql   # DBスキーマ
```

### 修正ファイル

```
src/handlers/
└── text.ts                   # croppy: 検出 & 文脈注入
```

---

## 🎮 使い方

### 通常のcroppy呼び出し（文脈あり）

```
croppy: 今の進捗は？
```

→ croppy は現在のタスク、Phase、会話履歴を把握して回答

### croppy: debug（文脈確認）

```
croppy: debug
```

→ 現在croppyに渡される文脈を表示

**出力例:**
```
📊 croppy文脈デバッグ

[jarvis_context]
現在のタスク: Darwin Engine v1.2.2 実装
現在のPhase: Phase 5: Testing
前提条件: 実験フェーズ、本番影響なし
重要な決定: 従量課金API使用禁止

[chat_history] 直近10件
1. [DJ] Darwin Engineの進捗は？
2. [Jarvis] Phase 5完了しました...
...

[AI_MEMORY]
（AI_MEMORYの内容）

[status]
- context: OK
- history: OK (10件)
- ai_memory: OK
```

---

## 🔧 API・関数一覧

### chat-history.ts

```typescript
// メッセージ保存
await saveChatMessage(userId, 'user', message);
await saveChatMessage(userId, 'assistant', response);

// 会話履歴取得
const history = await getChatHistory(userId, 10);

// 30日以前のデータ削除
await cleanupOldHistory();

// プロンプト用フォーマット
const formatted = formatChatHistoryForPrompt(history);
```

### jarvis-context.ts

```typescript
// コンテキスト取得
const context = await getJarvisContext(userId);

// コンテキスト更新（部分更新可能）
await updateJarvisContext(userId, {
  current_task: 'New Task',
  current_phase: 'Phase 2',
});

// 自動更新（応答から自動抽出）
await autoUpdateContext(userId, response);

// プロンプト用フォーマット
const formatted = formatContextForPrompt(context);
```

### croppy-context.ts

```typescript
// croppy用文脈取得（並列処理で高速）
const croppyContext = await getCroppyContext(userId);

// croppy用プロンプト構築
const prompt = await buildCroppyPrompt(originalPrompt, userId);

// debug出力生成
const debugOutput = await formatCroppyDebugOutput(userId);
```

---

## 🧪 自動抽出パターン

### タスク抽出

```typescript
// 検出パターン:
"タスク: Darwin Engine v1.2.2"
"Task: Implement feature X"
"作業中: Bug fix"
```

### Phase抽出

```typescript
// 検出パターン:
"Phase 1"
"Phase 2: Implementation"
"フェーズ3: テスト"
```

### 前提条件抽出

```typescript
// キーワード検出:
"実験" → "実験フェーズ"
"本番影響なし" → "本番影響なし"
"緊急" → "緊急対応"

// 明示的な記述:
"前提: 実験フェーズ、本番影響なし"
"Assumptions: test environment"
```

### 重要な決定抽出

```typescript
// キーワード検出:
"従量課金API使わない" → "従量課金API使用禁止"
"callClaudeCLI" → "Claude CLI経由（Telegram転送）使用"

// 明示的な記述:
"決定: 従量課金API禁止"
"Decision: Use free tier only"
```

---

## 🛡️ エラーハンドリング

### Degraded Mode（低下モード）

文脈取得に失敗しても処理は継続します：

```typescript
const croppyContext = await getCroppyContext(userId);
// エラー時:
// {
//   context: '（取得失敗）',
//   history: '（取得失敗）',
//   aiMemory: '（取得失敗）',
//   error: 'Database timeout'
// }
```

croppy応答の最初に警告が付きます：

```
⚠️ 注意: 一部の文脈取得に失敗しています。
この返答は限定的な前提に基づきます。

（以下croppy応答）
```

---

## ⚡ パフォーマンス

### 並列処理による高速化

```typescript
// 3つのDB取得を並列実行
const [context, history, aiMemory] = await Promise.all([
  getJarvisContext(userId),     // ~50ms
  getChatHistory(userId, 10),   // ~80ms
  getMemoryPack(userId),        // ~100ms
]);
// 合計: ~100ms（最も遅いもの）
```

### 30日削除の最適化

```typescript
// 1%の確率で実行（オーバーヘッド削減）
if (Math.random() < 0.01) {
  cleanupOldHistory().catch(err => console.error('Cleanup error:', err));
}
```

---

## 📊 統計・分析

### 会話履歴の統計

```sql
-- ユーザーごとのメッセージ数
SELECT user_id, COUNT(*) as message_count
FROM jarvis_chat_history
GROUP BY user_id;

-- 日別メッセージ数
SELECT DATE(timestamp) as date, COUNT(*) as count
FROM jarvis_chat_history
GROUP BY DATE(timestamp);
```

### コンテキスト更新の統計

```sql
-- 最後に更新されたコンテキスト
SELECT user_id, current_task, updated_at
FROM jarvis_context
ORDER BY updated_at DESC;
```

---

## 🧪 テスト方法

### 1. croppy: debug で文脈確認

```
croppy: debug
```

確認項目:
- ✅ jarvis_context が表示される
- ✅ chat_history 直近10件が表示される
- ✅ AI_MEMORY が表示される
- ✅ status が全てOK

### 2. 文脈を活用した会話

```
[DJ] croppy: 現在のタスクは？
[croppy] 現在のタスクは「Darwin Engine v1.2.2 実装」です。

[DJ] croppy: 今どのPhase？
[croppy] 現在Phase 5: Testingです。

[DJ] croppy: さっき何やった？
[croppy] さっき（直近の会話履歴から）Phase 4を完了しました。
```

### 3. 自動更新の確認

```
[DJ] Phase 6を開始します。タスク: croppy文脈共有機能
[Jarvis] Phase 6開始しました...

[DJ] croppy: debug
→ current_phase が "Phase 6" に更新されている ✅
→ current_task が "croppy文脈共有機能" に更新されている ✅
```

---

## 🚨 注意事項

### 従量課金API不使用

croppy呼び出しは全て **callClaudeCLI()** 経由（Telegram転送）:
- ✅ ANTHROPIC_API_KEY 不使用
- ✅ OPENAI_API_KEY 不使用
- ✅ 完全無料

### プライバシー

- 会話履歴は30日で自動削除
- ユーザーIDごとに分離
- センシティブ情報は自動redaction（別機能）

---

## 🔄 今後の改善（未実装）

### 予定されている機能

1. **/recall 検索機能**
   - 過去の会話をキーワード検索
   - 例: `/recall Darwin Engine`

2. **AI_MEMORYキャッシュ（5分）**
   - 頻繁なAI_MEMORY取得の最適化

3. **importance による要約保存**
   - 重要度の低い会話は要約して保存
   - ストレージ効率化

4. **文脈の手動編集**
   - `/context edit` で手動更新
   - 誤検出の修正

---

**実装日**: 2026-02-04
**バージョン**: 1.0
**従量課金API使用**: ❌ なし（callClaudeCLI経由）
**DB Tables**: jarvis_context, jarvis_chat_history
**保持期間**: 30日
