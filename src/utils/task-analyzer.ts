/**
 * タスク分析ユーティリティ
 * AI_MEMORYからタスクを解析し、優先度や状態を判定
 */

export interface Task {
  content: string;
  completed: boolean;
  date?: string;
  priority: 'high' | 'medium' | 'low';
  daysElapsed?: number;
  category?: string;
}

export interface TaskAnalysis {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  highPriorityTasks: Task[];
  overdueTasks: Task[];
  staleTasks: Task[]; // 3日以上経過
  tomorrowTasks: Task[];
}

/**
 * AI_MEMORYの内容からタスクを抽出
 */
export function parseTasksFromMemory(memoryContent: string): {
  todayTasks: Task[];
  tomorrowTasks: Task[];
} {
  const lines = memoryContent.split('\n');
  const todayTasks: Task[] = [];
  const tomorrowTasks: Task[] = [];

  let currentSection: 'today' | 'tomorrow' | 'none' = 'none';
  let currentDate = '';

  for (const line of lines) {
    // セクション判定
    if (line.includes('今日やること')) {
      currentSection = 'today';
      // 日付抽出（例: 2026-02-02）
      const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch && dateMatch[0]) {
        currentDate = dateMatch[0];
      }
      continue;
    }

    if (line.includes('明日やること')) {
      currentSection = 'tomorrow';
      // 日付抽出
      const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch && dateMatch[0]) {
        currentDate = dateMatch[0];
      }
      continue;
    }

    // 区切り線でセクション終了
    if (line.trim().startsWith('---')) {
      currentSection = 'none';
      continue;
    }

    // タスク行の解析（"- " または "- ✅ "で始まる）
    const taskMatch = line.match(/^-\s*(✅\s*)?(.+)$/);
    if (taskMatch && currentSection !== 'none') {
      const completed = !!taskMatch[1];
      const content = taskMatch[2]!.trim();

      if (!content) continue;

      const task: Task = {
        content,
        completed,
        date: currentDate || undefined,
        priority: determinePriority(content),
      };

      if (currentSection === 'today') {
        todayTasks.push(task);
      } else if (currentSection === 'tomorrow') {
        tomorrowTasks.push(task);
      }
    }
  }

  // 重複排除（同じcontentのタスクは最初の1件のみ残す）
  const dedup = (tasks: Task[]): Task[] => {
    const seen = new Set<string>();
    return tasks.filter(t => {
      if (seen.has(t.content)) return false;
      seen.add(t.content);
      return true;
    });
  };

  return { todayTasks: dedup(todayTasks), tomorrowTasks: dedup(tomorrowTasks) };
}

/**
 * タスクの優先度を判定
 */
function determinePriority(taskContent: string): 'high' | 'medium' | 'low' {
  const content = taskContent.toLowerCase();

  // 高優先度キーワード
  const highPriorityKeywords = [
    '緊急', '至急', '重要', '締切', '期限',
    '会議', 'web会議', 'ミーティング',
    '対応', '連絡', 'メール返信',
    '図面', '設計', '見積'
  ];

  // 低優先度キーワード
  const lowPriorityKeywords = [
    '検討', '確認', '整理', 'レビュー'
  ];

  for (const keyword of highPriorityKeywords) {
    if (content.includes(keyword)) {
      return 'high';
    }
  }

  for (const keyword of lowPriorityKeywords) {
    if (content.includes(keyword)) {
      return 'low';
    }
  }

  return 'medium';
}

/**
 * タスクの経過日数を計算
 */
export function calculateDaysElapsed(taskDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parts = taskDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(p => isNaN(p))) {
    return 0; // 不正な日付の場合は0を返す
  }

  const [year, month, day] = parts;
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * タスクリストを分析
 */
export function analyzeTasks(tasks: Task[]): TaskAnalysis {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const pendingTasks = totalTasks - completedTasks;

  const highPriorityTasks = tasks.filter(
    t => !t.completed && t.priority === 'high'
  );

  const overdueTasks: Task[] = [];
  const staleTasks: Task[] = [];

  for (const task of tasks) {
    if (task.completed || !task.date) continue;

    const daysElapsed = calculateDaysElapsed(task.date);
    task.daysElapsed = daysElapsed;

    if (daysElapsed >= 3) {
      staleTasks.push(task);
    }

    if (daysElapsed > 0) {
      overdueTasks.push(task);
    }
  }

  return {
    totalTasks,
    completedTasks,
    pendingTasks,
    highPriorityTasks,
    overdueTasks,
    staleTasks,
    tomorrowTasks: []
  };
}

/**
 * 進捗バーを生成
 */
function generateProgressBar(completed: number, total: number): string {
  if (total === 0) return '░░░░░░░░░░ 0%';

  const percentage = Math.round((completed / total) * 100);
  const filledBlocks = Math.round(percentage / 10);
  const emptyBlocks = 10 - filledBlocks;

  const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  return `${bar} ${percentage}%`;
}

/**
 * タスク分析結果をフォーマット
 */
export function formatTaskAnalysis(
  analysis: TaskAnalysis,
  tomorrowTasks: Task[]
): string {
  let message = '━━━━━━━━━━━━━━━━━━\n';
  message += '📊 **タスク分析レポート**\n';
  message += '━━━━━━━━━━━━━━━━━━\n\n';

  // 進捗概要
  const progressBar = generateProgressBar(analysis.completedTasks, analysis.totalTasks);
  message += `📈 **進捗状況**\n`;
  message += `${progressBar}\n`;
  message += `✅ 完了: ${analysis.completedTasks}件 / 📋 総数: ${analysis.totalTasks}件\n`;
  message += `⏳ 未完了: ${analysis.pendingTasks}件\n\n`;

  message += '━━━━━━━━━━━━━━━━━━\n\n';

  // 高優先度タスク
  if (analysis.highPriorityTasks.length > 0) {
    message += `🔥 **高優先度タスク** (${analysis.highPriorityTasks.length}件)\n`;
    message += '─────────────────\n';
    for (const task of analysis.highPriorityTasks) {
      message += `  • ${task.content}\n`;
    }
    message += '\n';
  }

  // 3日以上経過タスク（警告）
  if (analysis.staleTasks.length > 0) {
    message += `⚠️ **要注意！ 長期放置タスク** (${analysis.staleTasks.length}件)\n`;
    message += '─────────────────\n';
    for (const task of analysis.staleTasks) {
      message += `  • ${task.content}\n`;
      message += `    📅 ${task.daysElapsed}日経過\n`;
    }
    message += '\n';
  }

  // 明日のタスク
  if (tomorrowTasks.length > 0) {
    message += `📅 **明日の予定** (${tomorrowTasks.length}件)\n`;
    message += '─────────────────\n';
    for (const task of tomorrowTasks) {
      const priorityEmoji = task.priority === 'high' ? '🔥' : task.priority === 'medium' ? '⚡' : '📝';
      message += `  ${priorityEmoji} ${task.content}\n`;
    }
    message += '\n';
  }

  message += '━━━━━━━━━━━━━━━━━━\n';

  return message;
}

/**
 * 夜の振り返りメッセージを生成
 */
export function formatEveningReview(
  analysis: TaskAnalysis,
  tomorrowTasks: Task[]
): string {
  let message = '━━━━━━━━━━━━━━━━━━\n';
  message += '🌙 **今日の振り返り**\n';
  message += '━━━━━━━━━━━━━━━━━━\n\n';

  // 進捗バー
  const progressBar = generateProgressBar(analysis.completedTasks, analysis.totalTasks);
  message += `📊 **本日の進捗**\n`;
  message += `${progressBar}\n\n`;

  // 今日の成果
  if (analysis.completedTasks > 0) {
    message += `✅ **完了したタスク: ${analysis.completedTasks}件**\n`;
    message += '🎉 お疲れ様でした！\n\n';
  } else {
    message += `⏳ 完了タスクなし\n\n`;
  }

  // 未完了タスク
  if (analysis.pendingTasks > 0) {
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    message += `📋 **未完了タスク: ${analysis.pendingTasks}件**\n\n`;

    if (analysis.staleTasks.length > 0) {
      message += `⚠️ **要注意！ 長期放置タスク**\n`;
      message += '─────────────────\n';
      for (const task of analysis.staleTasks.slice(0, 5)) {
        message += `  • ${task.content}\n`;
        message += `    📅 ${task.daysElapsed}日経過\n`;
      }
      message += '\n';
    }
  }

  // 明日の準備
  if (tomorrowTasks.length > 0) {
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    message += `📅 **明日の準備はOK？**\n`;
    message += '─────────────────\n';

    const highPriorityTomorrow = tomorrowTasks.filter(t => t.priority === 'high');

    if (highPriorityTomorrow.length > 0) {
      message += `🔥 **特に重要なタスク**\n`;
      for (const task of highPriorityTomorrow) {
        message += `  • ${task.content}\n`;
      }

      const others = tomorrowTasks.filter(t => t.priority !== 'high');
      if (others.length > 0) {
        message += `\n📝 **その他のタスク**\n`;
        for (const task of others.slice(0, 3)) {
          const emoji = task.priority === 'medium' ? '⚡' : '📝';
          message += `  ${emoji} ${task.content}\n`;
        }
      }
    } else {
      for (const task of tomorrowTasks.slice(0, 5)) {
        const emoji = task.priority === 'medium' ? '⚡' : '📝';
        message += `  ${emoji} ${task.content}\n`;
      }
    }
    message += '\n';
  }

  message += '━━━━━━━━━━━━━━━━━━\n';

  return message;
}

/**
 * タスク計測中のタスクを取得（.task-tracker.jsonから）
 */
export async function getRunningTasks(): Promise<Array<{ name: string; startTime: string }>> {
  try {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const trackerPath = path.join(os.homedir(), '.task-tracker.json');
    const content = await fs.readFile(trackerPath, 'utf-8');
    const data = JSON.parse(content);

    return Object.entries(data).map(([name, startTime]) => ({
      name,
      startTime: startTime as string
    }));
  } catch (error) {
    // ファイルが存在しない、または読み取りエラーの場合は空配列を返す
    return [];
  }
}

/**
 * 計測中タスクを含めたタスクリストをマージ
 */
export async function mergeWithRunningTasks(tasks: Task[]): Promise<Task[]> {
  const runningTasks = await getRunningTasks();

  // 既存のタスクリストをコピー
  const mergedTasks = [...tasks];

  // 計測中のタスクで、まだリストにないものを追加
  for (const running of runningTasks) {
    const exists = tasks.some(t => t.content === running.name);

    if (!exists) {
      mergedTasks.push({
        content: `⏱️ ${running.name}`,
        completed: false,
        priority: determinePriority(running.name),
        category: 'running'
      });
    }
  }

  return mergedTasks;
}
