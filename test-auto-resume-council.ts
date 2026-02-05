#!/usr/bin/env bun

/**
 * Auto-Resume System Design Council
 */

import { askCouncil } from './src/utils/ai-council-helper';

const question = `
# 自動復帰システム設計相談

## 現在の問題点

**無駄なやりとり:**
1. DJ: 「状況は？」
2. Jarvis: 長文の状況説明
3. DJ: 「下記の実装状況の確認」
4. Jarvis: 再度確認して実装再開

**理想の動作:**
無反応 → 自動復帰 → 実装自動再開

---

## 提案: Interrupt Recovery System v2

### コンセプト
「DJが一定時間無反応なら、前回の作業を自動検出して再開提案」

### 検出シナリオ

#### Scenario 1: 実装中断
- **検出**: 最後のメッセージが「了解しました！〇〇を実装します！」
- **状態**: 実装開始宣言したが、その後無反応
- **自動復帰**: 「〇〇の実装を再開しますか？」

#### Scenario 2: Council相談中断
- **検出**: 最後が「council:」で始まるメッセージ
- **状態**: Councilに質問したまま放置
- **自動復帰**: Council結果を要約して「実装を始めますか？」

#### Scenario 3: Phase途中
- **検出**: jarvis_context に current_phase が残っている
- **状態**: Phase 2/5 で中断
- **自動復帰**: 「Phase 3から再開しますか？」

#### Scenario 4: エラー発生後
- **検出**: 最後のメッセージがエラーログ
- **状態**: エラー対処せず放置
- **自動復帰**: 「エラーの修正を続けますか？」

---

## 実装アイデア

### 1. Context Snapshot System
**保存タイミング:**
- 実装開始宣言時
- Phase移行時
- Council相談時
- エラー発生時

**保存内容:**
\`\`\`typescript
{
  session_id: string,
  task_description: string, // "Proactive Context Switcherの実装"
  current_phase: string,    // "Phase 2: メインボット統合"
  next_action: string,      // "message-handler.tsにcontext-detectorを追加"
  context_summary: string,  // 簡潔な状況説明
  interrupted_at: timestamp,
  auto_resume_eligible: boolean,
}
\`\`\`

### 2. Auto-Resume Trigger
**トリガー条件:**
- DJからのメッセージが30分以上ない
- 最後のJarvis応答が「実装開始」「Phase開始」「Council相談」のいずれか
- interrupt_snapshot テーブルに未復旧レコードあり

**動作:**
\`\`\`typescript
// 30分後に自動送信
if (timeSinceLastMessage > 30min && hasUnresumedTask) {
  const snapshot = await getLatestSnapshot(userId);
  await bot.sendMessage(chatId,
    "💡 中断された作業があります\\n\\n" +
    \`📋 タスク: \${snapshot.task_description}\\n\` +
    \`📍 現在: \${snapshot.current_phase}\\n\` +
    \`➡️ 次: \${snapshot.next_action}\\n\\n\` +
    "再開しますか？",
    { reply_markup: inlineKeyboard([
      [{ text: "✅ 再開", callback_data: "resume_yes" }],
      [{ text: "❌ 破棄", callback_data: "resume_no" }],
    ])}
  );
}
\`\`\`

### 3. Smart Detection Patterns

**Pattern 1: 実装宣言検出**
\`\`\`typescript
const implementationPatterns = [
  /了解.*実装します/,
  /では.*始めます/,
  /Phase \\d+.*開始/,
  /実装を続行/,
];
\`\`\`

**Pattern 2: Council相談検出**
\`\`\`typescript
if (message.startsWith('council:')) {
  await saveSnapshot({
    task: "Council相談中",
    next_action: "Council結果を踏まえて実装",
  });
}
\`\`\`

**Pattern 3: Phase検出**
\`\`\`typescript
const phaseMatch = response.match(/Phase (\\d+)\\/(\\d+)/);
if (phaseMatch) {
  await saveSnapshot({
    current_phase: \`Phase \${phaseMatch[1]}\`,
    total_phases: phaseMatch[2],
  });
}
\`\`\`

---

## 質問

### Q1: トリガータイミング
30分後の自動復帰提案は適切？
- 短すぎる？(15分？)
- 長すぎる？(1時間？)
- 時間帯で変える？(深夜は翌朝まで待つ)

### Q2: 検出精度
どこまで自動検出すべき？
- 保守的: 明確な実装宣言のみ
- 積極的: 会話の流れから推測
- ハイブリッド: Confidence-based

### Q3: UI/UX
自動復帰提案の最適な方法は？
- Inline keyboard (✅再開 / ❌破棄)
- テキストのみ (「resume」で再開)
- サイレント (自動で再開、ログのみ)

### Q4: 既存システムとの統合
- Autopilot Engineとの関係は？
- jarvis_contextとinterrupt_snapshotの使い分けは？
- Proactive Context Switcherとの連携は？

### Q5: エラーハンドリング
誤検知の対処は？
- 実装していないのに「再開しますか？」が出たら？
- 複数の中断タスクがあったら？
- 本当に終わったタスクを判別する方法は？

各エージェントの視点から、このシステムの設計を評価してください！
`;

console.log('🏛️ Consulting AI Council about Auto-Resume System...\n');

async function main() {
  try {
    const result = await askCouncil(question);
    console.log('\n✅ Council Consultation Complete\n');
    console.log('📊 Council Response:\n');
    console.log(result);
  } catch (error) {
    console.error('❌ Council consultation failed:', error);
    process.exit(1);
  }
}

main();
