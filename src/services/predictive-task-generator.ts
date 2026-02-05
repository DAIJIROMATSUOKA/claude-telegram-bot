/**
 * 予測的タスク生成サービス
 * AI_MEMORYの履歴から繰り返しパターンを学習し、タスクを自動生成
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { InlineKeyboard } from 'grammy';
import {
  predictTasks,
  formatPredictedTasks,
  type PredictedTask
} from '../utils/pattern-detector.js';

const execAsync = promisify(exec);

export class PredictiveTaskGenerator {
  private memoryCache: {
    content: string;
    timestamp: number;
  } | null = null;

  private readonly CACHE_TTL = 10 * 60 * 1000; // 10分

  /**
   * AI_MEMORYの内容を取得（キャッシュ付き）
   */
  private async fetchAIMemoryWithCache(forceRefresh = false): Promise<string> {
    const now = Date.now();

    if (!forceRefresh && this.memoryCache && (now - this.memoryCache.timestamp) < this.CACHE_TTL) {
      return this.memoryCache.content;
    }

    try {
      const { stdout } = await execAsync(
        'python3 /Users/daijiromatsuokam1/ai-memory-manager.py read',
        { timeout: 10000 }
      );

      this.memoryCache = { content: stdout, timestamp: now };
      return stdout;
    } catch (error) {
      console.error('[PredictiveTaskGenerator] Failed to fetch AI_MEMORY:', error);
      throw error;
    }
  }

  /**
   * 今日のタスクを取得
   */
  private extractTodayTasks(memoryContent: string): string[] {
    const lines = memoryContent.split('\n');
    const tasks: string[] = [];
    let inTodaySection = false;

    for (const line of lines) {
      if (line.includes('今日やること')) {
        inTodaySection = true;
        continue;
      }

      if (line.includes('明日やること') || line.trim().startsWith('---')) {
        inTodaySection = false;
        continue;
      }

      if (inTodaySection) {
        const taskMatch = line.match(/^-\s*(?:✅\s*)?(.+)$/);
        if (taskMatch && taskMatch[1]) {
          tasks.push(taskMatch[1].trim());
        }
      }
    }

    return tasks;
  }

  /**
   * タスクを予測
   */
  async generatePredictions(): Promise<PredictedTask[]> {
    try {
      console.log('[PredictiveTaskGenerator] Generating task predictions...');

      const memoryContent = await this.fetchAIMemoryWithCache();
      const todayTasks = this.extractTodayTasks(memoryContent);

      console.log(`[PredictiveTaskGenerator] Analyzing ${todayTasks.length} today's tasks`);

      const predictions = predictTasks(memoryContent, todayTasks);

      console.log(`[PredictiveTaskGenerator] Generated ${predictions.length} predictions`);

      return predictions;
    } catch (error) {
      console.error('[PredictiveTaskGenerator] Prediction failed:', error);
      return [];
    }
  }

  /**
   * 予測タスクをフォーマットして返す
   */
  async generatePredictionsMessage(): Promise<string> {
    const predictions = await this.generatePredictions();
    return formatPredictedTasks(predictions);
  }

  /**
   * インラインキーボード付きの予測タスクを生成
   */
  async generatePredictionsWithKeyboard(): Promise<{
    message: string;
    keyboard: InlineKeyboard | null;
    requestId: string;
  }> {
    const predictions = await this.generatePredictions();

    if (predictions.length === 0) {
      return { message: '', keyboard: null, requestId: '' };
    }

    const requestId = Date.now().toString();

    // Save predictions to temp file
    const predictionData = {
      predictions,
      timestamp: Date.now(),
      chat_id: null, // Will be set by caller
    };

    await Bun.write(
      `/tmp/predicted-tasks-${requestId}.json`,
      JSON.stringify(predictionData)
    );

    // Build message with numbered tasks
    let message = '🔮 *予測タスク（AI自動生成）*\n\n';
    message += '以下のタスクが必要になる可能性があります：\n\n';

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < Math.min(predictions.length, 5); i++) {
      const p = predictions[i];
      if (!p) continue;
      const confidenceEmoji = p.confidence >= 0.8 ? '🔥' : p.confidence >= 0.7 ? '⭐' : '💡';
      const confidencePercent = Math.round(p.confidence * 100);

      message += `${i + 1}. ${confidenceEmoji} *${p.content}* (確度: ${confidencePercent}%)\n`;
      message += `   理由: ${p.reason}\n\n`;

      // Add inline buttons for each task
      keyboard
        .text(`✅ ${i + 1}を承認`, `predict_task:approve:${requestId}:${i}`)
        .text(`❌ ${i + 1}を却下`, `predict_task:reject:${requestId}:${i}`)
        .row();
    }

    // Add "Approve All" and "Reject All" buttons
    keyboard
      .text('✅ すべて承認', `predict_task:approve_all:${requestId}`)
      .text('❌ すべて却下', `predict_task:reject_all:${requestId}`);

    return { message, keyboard, requestId };
  }

  /**
   * 予測タスクの詳細を取得
   */
  async getPredictionDetails(): Promise<{
    predictions: PredictedTask[];
    todayTasksCount: number;
    historyAnalyzed: boolean;
  }> {
    try {
      const memoryContent = await this.fetchAIMemoryWithCache();
      const todayTasks = this.extractTodayTasks(memoryContent);
      const predictions = predictTasks(memoryContent, todayTasks);

      return {
        predictions,
        todayTasksCount: todayTasks.length,
        historyAnalyzed: true
      };
    } catch (error) {
      return {
        predictions: [],
        todayTasksCount: 0,
        historyAnalyzed: false
      };
    }
  }

  /**
   * 手動テスト用
   */
  async test(): Promise<void> {
    console.log('=== Predictive Task Generator Test ===\n');

    const details = await this.getPredictionDetails();

    console.log(`Today's tasks count: ${details.todayTasksCount}`);
    console.log(`History analyzed: ${details.historyAnalyzed}`);
    console.log(`\nPredictions (${details.predictions.length}):\n`);

    for (const p of details.predictions) {
      console.log(`- ${p.content}`);
      console.log(`  Confidence: ${Math.round(p.confidence * 100)}%`);
      console.log(`  Reason: ${p.reason}`);
      console.log(`  Source: ${p.source}\n`);
    }

    const message = formatPredictedTasks(details.predictions);
    console.log('=== Formatted Message ===\n');
    console.log(message);
  }
}

// CLIから実行できるようにする
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new PredictiveTaskGenerator();

  generator.test().then(() => {
    console.log('Test completed');
    process.exit(0);
  }).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}
