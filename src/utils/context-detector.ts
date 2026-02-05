/**
 * Context Detector - Detects DJ's current work mode from message patterns
 *
 * Work Modes:
 * - coding: Writing/editing code
 * - debugging: Investigating errors/bugs
 * - planning: Architecture/design discussions
 * - research: Information gathering
 * - chatting: Casual conversation
 * - urgent: Emergency/critical issues
 */

export type WorkMode = 'coding' | 'debugging' | 'planning' | 'research' | 'chatting' | 'urgent';

export interface DetectionResult {
  mode: WorkMode;
  confidence: number; // 0.0-1.0
  indicators: string[]; // What triggered this detection
}

/**
 * Detect work mode from message content
 */
export function detectWorkMode(message: string): DetectionResult {
  const lowerMessage = message.toLowerCase();

  // Score each mode
  const scores: Record<WorkMode, number> = {
    coding: 0,
    debugging: 0,
    planning: 0,
    research: 0,
    chatting: 0,
    urgent: 0,
  };

  const indicators: Record<WorkMode, string[]> = {
    coding: [],
    debugging: [],
    planning: [],
    research: [],
    chatting: [],
    urgent: [],
  };

  // === URGENT Mode Detection (highest priority) ===
  const urgentPatterns = [
    /緊急|urgent|critical|asap|今すぐ/i,
    /エラー.*発生|error.*occurred|crash|down|障害/i,
    /動かない|not working|broken|失敗.*し.*た/i,
  ];

  for (const pattern of urgentPatterns) {
    if (pattern.test(message)) {
      scores.urgent += 3;
      indicators.urgent.push(`Pattern: ${pattern.source}`);
    }
  }

  // === DEBUGGING Mode Detection ===
  const debuggingPatterns = [
    /エラー|error|exception|stack trace|bug|バグ/i,
    /なぜ.*動か|why.*not.*work|どうして.*失敗/i,
    /デバッグ|debug|trace|investigate|調査/i,
    /ログ|log|console|stderr|stdout/i,
    /テスト.*失敗|test.*fail|assertion|expect/i,
  ];

  for (const pattern of debuggingPatterns) {
    if (pattern.test(message)) {
      scores.debugging += 2;
      indicators.debugging.push(`Pattern: ${pattern.source}`);
    }
  }

  // === CODING Mode Detection ===
  const codingPatterns = [
    /実装|implement|コード|code|function|class|変数/i,
    /書.*[いく]|write|作.*[るろ]|create|追加|add/i,
    /修正|fix|変更|change|更新|update|edit/i,
    /リファクタ|refactor|最適化|optimize/i,
    /Phase \d+/i, // Phase番号があればコーディング中の可能性
  ];

  for (const pattern of codingPatterns) {
    if (pattern.test(message)) {
      scores.coding += 1.5;
      indicators.coding.push(`Pattern: ${pattern.source}`);
    }
  }

  // === PLANNING Mode Detection ===
  const planningPatterns = [
    /設計|design|architecture|アーキテクチャ/i,
    /計画|plan|roadmap|ロードマップ/i,
    /どう.*すれば|how to|方法|approach|戦略/i,
    /提案|propose|recommend|suggestion|アイデア/i,
    /council/i, // AI Council = 重要な意思決定
  ];

  for (const pattern of planningPatterns) {
    if (pattern.test(message)) {
      scores.planning += 2;
      indicators.planning.push(`Pattern: ${pattern.source}`);
    }
  }

  // === RESEARCH Mode Detection ===
  const researchPatterns = [
    /調べ|search|find|探.*[すし]|look for/i,
    /について.*教え|tell me about|explain|説明/i,
    /どんな|what|なに|which|どれ/i,
    /比較|compare|違い|difference/i,
    /ドキュメント|document|doc|仕様|spec/i,
  ];

  for (const pattern of researchPatterns) {
    if (pattern.test(message)) {
      scores.research += 1.5;
      indicators.research.push(`Pattern: ${pattern.source}`);
    }
  }

  // === CHATTING Mode Detection (default/fallback) ===
  const chattingPatterns = [
    /^(おはよう|こんにちは|こんばんは|hello|hi|hey|ping)/i,
    /ありがと|thanks|thank you|助かる/i,
    /どう.*思う|what do you think|意見/i,
    /^(.*[?？])$/, // Simple questions
  ];

  for (const pattern of chattingPatterns) {
    if (pattern.test(message)) {
      scores.chatting += 1;
      indicators.chatting.push(`Pattern: ${pattern.source}`);
    }
  }

  // Message length analysis
  if (message.length < 30) {
    scores.chatting += 0.5; // Short messages are likely casual
  }

  if (message.length > 200) {
    scores.coding += 0.5; // Long messages with detailed requirements
    scores.planning += 0.5;
  }

  // Code snippet detection
  if (/```|`[^`]+`/.test(message)) {
    scores.coding += 2;
    indicators.coding.push('Code snippet detected');
  }

  // Find mode with highest score
  let maxScore = 0;
  let detectedMode: WorkMode = 'chatting';

  for (const [mode, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedMode = mode as WorkMode;
    }
  }

  // Calculate confidence (normalize score to 0-1)
  const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
  const confidence = totalScore > 0 ? Math.min(maxScore / totalScore, 1.0) : 0.5;

  return {
    mode: detectedMode,
    confidence: Math.round(confidence * 100) / 100, // Round to 2 decimals
    indicators: indicators[detectedMode],
  };
}

/**
 * Get recommended AI for work mode
 */
export function getRecommendedAI(mode: WorkMode): 'jarvis' | 'croppy' | 'gemini' | 'gpt' {
  switch (mode) {
    case 'coding':
      return 'jarvis'; // Claude is best for coding

    case 'debugging':
      return 'gemini'; // Gemini excels at code analysis

    case 'planning':
      return 'croppy'; // Croppy for strategic thinking

    case 'research':
      return 'gemini'; // Gemini for search and analysis

    case 'urgent':
      return 'jarvis'; // Jarvis for fast responses

    case 'chatting':
    default:
      return 'jarvis'; // Default to Jarvis
  }
}

/**
 * Get emoji icon for work mode
 */
export function getWorkModeIcon(mode: WorkMode): string {
  switch (mode) {
    case 'coding': return '💻';
    case 'debugging': return '🐛';
    case 'planning': return '📋';
    case 'research': return '🔍';
    case 'urgent': return '🚨';
    case 'chatting': return '💬';
    default: return '🤖';
  }
}

/**
 * Get work mode display name
 */
export function getWorkModeDisplayName(mode: WorkMode): string {
  switch (mode) {
    case 'coding': return 'コーディング';
    case 'debugging': return 'デバッグ';
    case 'planning': return 'プランニング';
    case 'research': return 'リサーチ';
    case 'urgent': return '緊急対応';
    case 'chatting': return '会話';
    default: return '不明';
  }
}
