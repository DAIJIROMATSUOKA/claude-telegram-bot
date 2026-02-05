/**
 * プロアクティブAI秘書サービス
 * タスクを監視し、自動的にリマインドや提案を行う
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { InlineKeyboard } from 'grammy';
import {
  parseTasksFromMemory,
  analyzeTasks,
  formatTaskAnalysis,
  formatEveningReview,
  mergeWithRunningTasks,
  type Task
} from '../utils/task-analyzer.js';
import { PredictiveTaskGenerator } from './predictive-task-generator.js';

const execAsync = promisify(exec);

export class ProactiveSecretary {
  private telegramBotToken: string;
  private telegramChatId: string;

  constructor(botToken: string, chatId: string) {
    this.telegramBotToken = botToken;
    this.telegramChatId = chatId;
  }

  /**
   * AI_MEMORYの内容を取得
   */
  private async fetchAIMemory(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        '/opt/homebrew/bin/python3 ~/ai-memory-manager.py read'
      );
      return stdout;
    } catch (error) {
      console.error('Failed to fetch AI_MEMORY:', error);
      throw error;
    }
  }

  /**
   * Telegramにメッセージを送信
   */
  private async sendTelegramMessage(message: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;

      // まずMarkdownで試行
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      // Markdownでエラーが出た場合はプレーンテキストで再試行
      if (!response.ok) {
        console.warn('[ProactiveSecretary] Markdown parsing failed, retrying with plain text');
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: this.telegramChatId,
            text: message,
          }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
      throw error;
    }
  }

  /**
   * インラインキーボード付きのメッセージを送信
   */
  private async sendTelegramMessageWithKeyboard(
    message: string,
    keyboard: InlineKeyboard
  ): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text: message,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send Telegram message with keyboard:', error);
      throw error;
    }
  }

  /**
   * 朝のブリーフィング
   */
  async morningBriefing(): Promise<void> {
    try {
      console.log('[ProactiveSecretary] Starting morning briefing...');

      const memoryContent = await this.fetchAIMemory();
      const { todayTasks, tomorrowTasks } = parseTasksFromMemory(memoryContent);

      // 計測中タスクをマージ
      const mergedTodayTasks = await mergeWithRunningTasks(todayTasks);

      const analysis = analyzeTasks(mergedTodayTasks);
      let message = this.formatMorningMessage(analysis, mergedTodayTasks, tomorrowTasks);

      // メインメッセージを送信
      await this.sendTelegramMessage(message);

      // 予測タスク生成を追加（インラインキーボード付き）
      try {
        const generator = new PredictiveTaskGenerator();
        const { message: predictionsMessage, keyboard, requestId } =
          await generator.generatePredictionsWithKeyboard();

        if (predictionsMessage && keyboard) {
          // Update prediction file with chat_id
          const predictionFile = `/tmp/predicted-tasks-${requestId}.json`;
          const data = JSON.parse(await Bun.file(predictionFile).text());
          data.chat_id = this.telegramChatId;
          await Bun.write(predictionFile, JSON.stringify(data));

          // Send predictions with keyboard
          await this.sendTelegramMessageWithKeyboard(predictionsMessage, keyboard);
          console.log('[ProactiveSecretary] Predictions sent with keyboard');
        }
      } catch (predictionError) {
        console.error('[ProactiveSecretary] Prediction generation failed:', predictionError);
        // 予測タスク生成に失敗してもブリーフィングは続行
      }

      console.log('[ProactiveSecretary] Morning briefing sent successfully');
    } catch (error) {
      console.error('[ProactiveSecretary] Morning briefing failed:', error);
      // エラーを通知
      await this.sendTelegramMessage(
        '⚠️ 朝のブリーフィング生成中にエラーが発生しました。'
      );
    }
  }

  /**
   * 夜の振り返り
   */
  async eveningReview(): Promise<void> {
    try {
      console.log('[ProactiveSecretary] Starting evening review...');

      const memoryContent = await this.fetchAIMemory();
      const { todayTasks, tomorrowTasks } = parseTasksFromMemory(memoryContent);

      // 計測中タスクをマージ
      const mergedTodayTasks = await mergeWithRunningTasks(todayTasks);

      const analysis = analyzeTasks(mergedTodayTasks);
      const message = formatEveningReview(analysis, tomorrowTasks);

      await this.sendTelegramMessage(message);

      console.log('[ProactiveSecretary] Evening review sent successfully');
    } catch (error) {
      console.error('[ProactiveSecretary] Evening review failed:', error);
      await this.sendTelegramMessage(
        '⚠️ 夜の振り返り生成中にエラーが発生しました。'
      );
    }
  }

  /**
   * リアルタイム監視（定期的に呼び出される）
   */
  async realtimeMonitor(): Promise<void> {
    try {
      const memoryContent = await this.fetchAIMemory();
      const { todayTasks } = parseTasksFromMemory(memoryContent);

      // 計測中タスクをマージ
      const mergedTodayTasks = await mergeWithRunningTasks(todayTasks);

      const analysis = analyzeTasks(mergedTodayTasks);

      // 緊急アラートのみ送信
      if (analysis.staleTasks.length > 0) {
        const urgentTasks = analysis.staleTasks.filter(t => t.daysElapsed && t.daysElapsed >= 5);

        if (urgentTasks.length > 0) {
          let message = '🚨 **緊急アラート！**\n\n';
          message += '5日以上放置されているタスクがあります：\n\n';

          for (const task of urgentTasks) {
            message += `• ${task.content} (${task.daysElapsed}日経過)\n`;
          }

          await this.sendTelegramMessage(message);
        }
      }
    } catch (error) {
      console.error('[ProactiveSecretary] Realtime monitor failed:', error);
      // リアルタイム監視のエラーは静かに失敗させる
    }
  }

  /**
   * 朝のメッセージをフォーマット
   */
  private formatMorningMessage(
    analysis: any,
    todayTasks: Task[],
    tomorrowTasks: Task[]
  ): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    let message = '━━━━━━━━━━━━━━━━━━\n';
    message += `☀️ **おはようございます！**\n`;
    message += `${dateStr}\n`;
    message += '━━━━━━━━━━━━━━━━━━\n\n';

    // 今日のタスク概要
    const pendingToday = todayTasks.filter(t => !t.completed);
    const completedToday = todayTasks.filter(t => t.completed);

    if (pendingToday.length === 0 && completedToday.length > 0) {
      message += '🎉 今日のタスクはすべて完了しています！\n\n';
    } else if (pendingToday.length === 0) {
      message += '📝 今日のタスクはまだ登録されていません\n\n';
    } else {
      message += `📋 **今日のタスク** (${pendingToday.length}件)\n`;
      message += '─────────────────\n';

      // 高優先度タスクを強調
      const highPriority = pendingToday.filter(t => t.priority === 'high');
      const mediumPriority = pendingToday.filter(t => t.priority === 'medium');
      const lowPriority = pendingToday.filter(t => t.priority === 'low');

      if (highPriority.length > 0) {
        message += `\n🔥 **優先度: 高** (${highPriority.length}件)\n`;
        for (const task of highPriority) {
          message += `  • ${task.content}\n`;
        }
      }

      if (mediumPriority.length > 0 && mediumPriority.length <= 3) {
        message += `\n⚡ **優先度: 中** (${mediumPriority.length}件)\n`;
        for (const task of mediumPriority) {
          message += `  • ${task.content}\n`;
        }
      } else if (mediumPriority.length > 3) {
        message += `\n⚡ **優先度: 中** (${mediumPriority.length}件)\n`;
      }

      if (lowPriority.length > 0 && lowPriority.length <= 2) {
        message += `\n📝 **優先度: 低** (${lowPriority.length}件)\n`;
        for (const task of lowPriority) {
          message += `  • ${task.content}\n`;
        }
      } else if (lowPriority.length > 2) {
        message += `\n📝 **優先度: 低** (${lowPriority.length}件)\n`;
      }

      message += '\n';
    }

    // 3日以上経過タスクの警告
    if (analysis.staleTasks.length > 0) {
      message += '━━━━━━━━━━━━━━━━━━\n\n';
      message += `⚠️ **要注意！ 長期放置タスク** (${analysis.staleTasks.length}件)\n`;
      message += '─────────────────\n';
      for (const task of analysis.staleTasks.slice(0, 3)) {
        message += `  • ${task.content}\n`;
        message += `    📅 ${task.daysElapsed}日経過\n`;
      }
      message += '\n';
    }

    message += '━━━━━━━━━━━━━━━━━━\n';
    message += '💪 今日も頑張りましょう！';

    return message;
  }

  /**
   * 手動実行用のテスト関数
   */
  async testMorningBriefing(): Promise<void> {
    console.log('=== Morning Briefing Test ===');
    await this.morningBriefing();
  }

  async testEveningReview(): Promise<void> {
    console.log('=== Evening Review Test ===');
    await this.eveningReview();
  }
}

// CLIから実行できるようにする
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || 'morning';

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
    process.exit(1);
  }

  const secretary = new ProactiveSecretary(botToken, chatId);

  if (mode === 'morning') {
    secretary.morningBriefing().then(() => {
      console.log('Morning briefing completed');
      process.exit(0);
    }).catch(error => {
      console.error('Morning briefing failed:', error);
      process.exit(1);
    });
  } else if (mode === 'evening') {
    secretary.eveningReview().then(() => {
      console.log('Evening review completed');
      process.exit(0);
    }).catch(error => {
      console.error('Evening review failed:', error);
      process.exit(1);
    });
  } else if (mode === 'monitor') {
    secretary.realtimeMonitor().then(() => {
      console.log('Realtime monitor completed');
      process.exit(0);
    }).catch(error => {
      console.error('Realtime monitor failed:', error);
      process.exit(1);
    });
  } else {
    console.error('Unknown mode. Use: morning, evening, or monitor');
    process.exit(1);
  }
}
