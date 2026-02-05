/**
 * Implementation Declaration Detector
 *
 * Detects when Jarvis declares it will start implementation
 *
 * @module implementation-detector
 */

// ============================================================================
// Types
// ============================================================================

export interface DetectionResult {
  detected: boolean;
  taskDescription: string | null;
  phase: string | null;
  priority: 'normal' | 'urgent';
  confidence: number; // 0.0-1.0
}

// ============================================================================
// Detection Patterns
// ============================================================================

/**
 * Detect implementation start declaration
 *
 * Pattern examples:
 * - "了解しました！Proactive Context Switcherを実装します！"
 * - "では、Context Detection機能を実装していきます。"
 * - "Phase 1: Context Detection実装"
 *
 * @param message - Jarvis's response message
 * @returns Detection result
 */
export function detectImplementationStart(message: string): DetectionResult {
  let detected = false;
  let taskDescription: string | null = null;
  let phase: string | null = null;
  let priority: 'normal' | 'urgent' = 'normal';
  let confidence = 0.0;

  // Pattern 1: 「了解しました！〇〇を実装します！」
  const pattern1 = /了解.*?([^。！\n]+)を実装します/;
  const match1 = message.match(pattern1);
  if (match1) {
    detected = true;
    taskDescription = match1[1].trim();
    confidence = 0.95;
  }

  // Pattern 2: 「では、〇〇を実装していきます」
  const pattern2 = /では[、，]?\s*([^。！\n]+)を実装/;
  const match2 = message.match(pattern2);
  if (!detected && match2) {
    detected = true;
    taskDescription = match2[1].trim();
    confidence = 0.90;
  }

  // Pattern 3: 「〇〇の実装を開始します」
  const pattern3 = /([^。！\n]+)の実装を開始/;
  const match3 = message.match(pattern3);
  if (!detected && match3) {
    detected = true;
    taskDescription = match3[1].trim();
    confidence = 0.92;
  }

  // Pattern 4: 「実装を続行します」
  const pattern4 = /実装を続行/;
  if (!detected && pattern4.test(message)) {
    detected = true;
    taskDescription = '実装続行';
    confidence = 0.85;
  }

  return {
    detected,
    taskDescription,
    phase,
    priority,
    confidence,
  };
}

/**
 * Detect Phase start
 *
 * Pattern examples:
 * - "Phase 1: Context Detection実装"
 * - "Phase 2/5: メインボット統合"
 *
 * @param message - Jarvis's response message
 * @returns Detection result
 */
export function detectPhaseStart(message: string): DetectionResult {
  let detected = false;
  let taskDescription: string | null = null;
  let phase: string | null = null;
  let priority: 'normal' | 'urgent' = 'normal';
  let confidence = 0.0;

  // Pattern 1: "Phase X: Description"
  const pattern1 = /Phase\s+(\d+)[:：]\s*([^\n]+)/i;
  const match1 = message.match(pattern1);
  if (match1) {
    detected = true;
    phase = `Phase ${match1[1]}`;
    taskDescription = match1[2].trim();
    confidence = 0.90;
  }

  // Pattern 2: "Phase X/Y: Description"
  const pattern2 = /Phase\s+(\d+)\/(\d+)[:：]\s*([^\n]+)/i;
  const match2 = message.match(pattern2);
  if (!detected && match2) {
    detected = true;
    phase = `Phase ${match2[1]}/${match2[2]}`;
    taskDescription = match2[3].trim();
    confidence = 0.92;
  }

  // Pattern 3: "フェーズX"
  const pattern3 = /フェーズ\s*(\d+)[:：]\s*([^\n]+)/;
  const match3 = message.match(pattern3);
  if (!detected && match3) {
    detected = true;
    phase = `Phase ${match3[1]}`;
    taskDescription = match3[2].trim();
    confidence = 0.88;
  }

  return {
    detected,
    taskDescription,
    phase,
    priority,
    confidence,
  };
}

/**
 * Detect AI Council consultation
 *
 * Pattern: Messages starting with "council:"
 *
 * @param message - User's message
 * @returns Detection result
 */
export function detectCouncilConsultation(message: string): DetectionResult {
  const detected = message.trim().toLowerCase().startsWith('council:');

  if (detected) {
    // Extract question from "council: question text"
    const questionMatch = message.match(/council:\s*(.+)/i);
    const taskDescription = questionMatch
      ? `AI Council相談: ${questionMatch[1].substring(0, 100)}...`
      : 'AI Council相談中';

    return {
      detected: true,
      taskDescription,
      phase: null,
      priority: 'normal',
      confidence: 1.0,
    };
  }

  return {
    detected: false,
    taskDescription: null,
    phase: null,
    priority: 'normal',
    confidence: 0.0,
  };
}

/**
 * Detect urgent implementation
 *
 * Pattern: Messages containing urgent keywords
 *
 * @param message - Message to check
 * @returns True if urgent
 */
export function isUrgentImplementation(message: string): boolean {
  const urgentPatterns = [
    /緊急/,
    /urgent/i,
    /asap/i,
    /今すぐ/,
    /すぐに/,
    /critical/i,
  ];

  return urgentPatterns.some((pattern) => pattern.test(message));
}

/**
 * Unified detection - checks all patterns
 *
 * @param message - Message to analyze
 * @param messageType - 'user' or 'bot'
 * @returns Combined detection result
 */
export function detectInterruptableTask(
  message: string,
  messageType: 'user' | 'bot'
): DetectionResult {
  // User message: Check for council consultation
  if (messageType === 'user') {
    const councilResult = detectCouncilConsultation(message);
    if (councilResult.detected) {
      return councilResult;
    }
  }

  // Bot message: Check for implementation/phase start
  if (messageType === 'bot') {
    // Check Phase first (higher priority)
    const phaseResult = detectPhaseStart(message);
    if (phaseResult.detected && phaseResult.confidence >= 0.85) {
      // Check if urgent
      if (isUrgentImplementation(message)) {
        phaseResult.priority = 'urgent';
      }
      return phaseResult;
    }

    // Check implementation declaration
    const implResult = detectImplementationStart(message);
    if (implResult.detected && implResult.confidence >= 0.85) {
      // Check if urgent
      if (isUrgentImplementation(message)) {
        implResult.priority = 'urgent';
      }
      return implResult;
    }
  }

  // No detection
  return {
    detected: false,
    taskDescription: null,
    phase: null,
    priority: 'normal',
    confidence: 0.0,
  };
}
