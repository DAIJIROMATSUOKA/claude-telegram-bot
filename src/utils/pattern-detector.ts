/**
 * パターン検出ユーティリティ
 * AI_MEMORYの履歴からタスクの繰り返しパターンを検出
 */

export interface TaskPattern {
  pattern: string;
  frequency: number;
  lastOccurrence: Date;
  nextPredicted?: Date;
  confidence: number; // 0-1
  context?: string;
}

export interface PredictedTask {
  content: string;
  reason: string;
  confidence: number;
  source: 'time-based' | 'frequency-based' | 'dependency-based';
}

/**
 * 曜日ベースのパターン検出
 */
export function detectWeeklyPatterns(historyText: string): PredictedTask[] {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=日曜, 1=月曜, ...
  const predictions: PredictedTask[] = [];

  // 月曜日のパターン
  if (dayOfWeek === 1) {
    if (historyText.includes('週報') || historyText.includes('週次レポート')) {
      predictions.push({
        content: '週報作成',
        reason: '毎週月曜日に週報を作成しています',
        confidence: 0.8,
        source: 'time-based'
      });
    }
  }

  // 金曜日のパターン
  if (dayOfWeek === 5) {
    if (historyText.includes('週次') || historyText.includes('週報')) {
      predictions.push({
        content: '週次レポート準備',
        reason: '金曜日に次週の準備をすることが多いです',
        confidence: 0.7,
        source: 'time-based'
      });
    }
  }

  return predictions;
}

/**
 * 月次パターン検出
 */
export function detectMonthlyPatterns(historyText: string): PredictedTask[] {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const predictions: PredictedTask[] = [];

  // 月初（1-7日）のパターン
  if (dayOfMonth <= 7) {
    if (historyText.includes('月報') || historyText.includes('月次')) {
      predictions.push({
        content: '月報作成',
        reason: '毎月初旬に月報を作成しています',
        confidence: 0.85,
        source: 'time-based'
      });
    }
  }

  // 月末（25日以降）のパターン
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  if (dayOfMonth >= lastDayOfMonth - 5) {
    if (historyText.includes('請求') || historyText.includes('締め')) {
      predictions.push({
        content: '月末締め処理',
        reason: '月末に締め処理を行っています',
        confidence: 0.8,
        source: 'time-based'
      });
    }
  }

  return predictions;
}

/**
 * 頻出キーワードからのタスク予測
 */
export function detectFrequencyPatterns(historyText: string): PredictedTask[] {
  const predictions: PredictedTask[] = [];

  // キーワードの出現頻度をカウント
  const keywords = [
    { word: 'ヤガイ', tasks: ['ヤガイ案件の進捗確認', 'ヤガイ打ち合わせ準備'] },
    { word: 'プリマ', tasks: ['プリマ食品対応', 'プリマ案件確認'] },
    { word: '美山', tasks: ['美山Web会議準備'] },
    { word: '図面', tasks: ['図面レビュー', '図面修正'] },
    { word: '設計', tasks: ['設計レビュー', '設計検証'] },
    { word: '見積', tasks: ['見積書作成', '見積確認'] },
  ];

  for (const { word, tasks } of keywords) {
    const regex = new RegExp(word, 'g');
    const matches = historyText.match(regex);

    if (matches && matches.length >= 3) {
      // 3回以上出現したら関連タスクを予測
      const frequency = matches.length;
      const confidence = Math.min(0.9, 0.5 + (frequency * 0.1));

      predictions.push({
        content: tasks[0],
        reason: `「${word}」が${frequency}回出現しています`,
        confidence,
        source: 'frequency-based'
      });
    }
  }

  return predictions;
}

/**
 * 依存関係パターン検出
 */
export function detectDependencyPatterns(
  todayTasks: string[],
  historyText: string
): PredictedTask[] {
  const predictions: PredictedTask[] = [];

  // 設計 → 図面 のパターン
  if (todayTasks.some(task => task.includes('設計'))) {
    if (historyText.includes('設計') && historyText.includes('図面')) {
      predictions.push({
        content: '設計図面の作成',
        reason: '設計タスクの後には図面作成が続く傾向があります',
        confidence: 0.75,
        source: 'dependency-based'
      });
    }
  }

  // 見積 → 発注 のパターン
  if (todayTasks.some(task => task.includes('見積'))) {
    if (historyText.includes('見積') && historyText.includes('発注')) {
      predictions.push({
        content: '見積承認後の発注準備',
        reason: '見積の後には発注手続きが続く傾向があります',
        confidence: 0.7,
        source: 'dependency-based'
      });
    }
  }

  // 打ち合わせ → 議事録 のパターン
  if (todayTasks.some(task => task.includes('会議') || task.includes('打ち合わせ'))) {
    predictions.push({
      content: '議事録作成',
      reason: '会議の後には議事録作成が必要です',
      confidence: 0.8,
      source: 'dependency-based'
    });
  }

  return predictions;
}

/**
 * すべてのパターン検出を統合
 */
export function predictTasks(
  historyText: string,
  todayTasks: string[] = []
): PredictedTask[] {
  const predictions: PredictedTask[] = [];

  // 各種パターン検出を実行
  predictions.push(...detectWeeklyPatterns(historyText));
  predictions.push(...detectMonthlyPatterns(historyText));
  predictions.push(...detectFrequencyPatterns(historyText));
  predictions.push(...detectDependencyPatterns(todayTasks, historyText));

  // 重複を除去（同じcontentのタスクは最も信頼度の高いものを残す）
  const uniquePredictions = new Map<string, PredictedTask>();

  for (const prediction of predictions) {
    const existing = uniquePredictions.get(prediction.content);
    if (!existing || prediction.confidence > existing.confidence) {
      uniquePredictions.set(prediction.content, prediction);
    }
  }

  // 信頼度でソート（高い順）
  const result = Array.from(uniquePredictions.values())
    .sort((a, b) => b.confidence - a.confidence);

  // 信頼度0.6以上のみ返す
  return result.filter(p => p.confidence >= 0.6);
}

/**
 * 予測タスクのフォーマット
 */
export function formatPredictedTasks(predictions: PredictedTask[]): string {
  if (predictions.length === 0) {
    return '';
  }

  let message = '🔮 *予測タスク（AI自動生成）*\n\n';
  message += '以下のタスクが必要になる可能性があります：\n\n';

  for (let i = 0; i < Math.min(predictions.length, 5); i++) {
    const p = predictions[i];
    const confidenceEmoji = p.confidence >= 0.8 ? '🔥' : p.confidence >= 0.7 ? '⭐' : '💡';
    const confidencePercent = Math.round(p.confidence * 100);

    message += `${confidenceEmoji} *${p.content}* (確度: ${confidencePercent}%)\n`;
    message += `   理由: ${p.reason}\n\n`;
  }

  message += '承認する場合は「予測タスクを追加」と返信してください。\n';

  return message;
}
