/**
 * Smart AI Router - タスク種類に応じたAI自動選択
 * Phase: Proactive Context Switcher
 * ルールベースでタスク分類し、最適なAIを提案（強制ルーティングしない）
 */
import type { AIProvider } from '../handlers/ai-router';

export interface TaskClassification {
  taskType: string;
  suggestedProvider: AIProvider;
  confidence: number;
  reason: string;
}

const TASK_PATTERNS: Array<{
  taskType: string;
  provider: AIProvider;
  patterns: RegExp[];
  confidence: number;
  reason: string;
}> = [
  {
    taskType: 'code',
    provider: 'croppy',
    patterns: [
      /\b(review|レビュー|コードレビュー|code review)\b/i,
      /\b(bug|バグ|debug|デバッグ|refactor|リファクタ)\b/i,
    ],
    confidence: 0.8,
    reason: 'コードタスク → croppy: で試してみて',
  },
  {
    taskType: 'implementation',
    provider: 'jarvis',
    patterns: [
      /\b(実装して|作って|追加して|修正して|直して)\b/i,
      /\b(implement|create|add|fix|build)\b/i,
    ],
    confidence: 0.7,
    reason: '実装タスク → Jarvis（ファイル操作可）',
  },
  {
    taskType: 'translation',
    provider: 'gemini',
    patterns: [/\b(translate|翻訳|英訳|和訳)\b/i],
    confidence: 0.9,
    reason: '翻訳タスク → gemini: で試してみて',
  },
  {
    taskType: 'analysis',
    provider: 'council',
    patterns: [
      /\b(compare|比較|analyze|分析|evaluate|評価|メリット|デメリット)\b/i,
    ],
    confidence: 0.6,
    reason: '分析タスク → council: で多角的に',
  },
  {
    taskType: 'research',
    provider: 'gemini',
    patterns: [/\b(search|検索|調べて|探して|research)\b/i],
    confidence: 0.7,
    reason: 'リサーチ → gemini: で試してみて',
  },
];

/** メッセージからタスク種類を分類 */
export function classifyTask(message: string): TaskClassification | null {
  let best: TaskClassification | null = null;
  let bestConf = 0;
  for (const p of TASK_PATTERNS) {
    for (const regex of p.patterns) {
      if (regex.test(message) && p.confidence > bestConf) {
        bestConf = p.confidence;
        best = {
          taskType: p.taskType,
          suggestedProvider: p.provider,
          confidence: p.confidence,
          reason: p.reason,
        };
        break;
      }
    }
  }
  return best && best.confidence >= 0.6 ? best : null;
}

/** ルーティング提案（現在のプロバイダーと異なる場合のみ） */
export function getRoutingSuggestion(message: string, currentProvider: AIProvider): string | null {
  const c = classifyTask(message);
  if (!c || c.suggestedProvider === currentProvider || c.suggestedProvider === 'jarvis') return null;
  const prefix = c.suggestedProvider === 'council' ? 'council' :
                 c.suggestedProvider === 'croppy' ? 'croppy' :
                 c.suggestedProvider === 'gemini' ? 'gemini' :
                 c.suggestedProvider === 'gpt' ? 'gpt' : null;
  if (!prefix) return null;
  return `💡 ${c.reason}\n→ ${prefix}: ${message.substring(0, 30)}...`;
}
