/**
 * Jarvis Context Manager
 *
 * jarvis_context テーブルの更新・取得
 */

import { callMemoryGateway } from '../handlers/ai-router';
import { detectWorkMode, getRecommendedAI } from './context-detector';

export interface JarvisContext {
  user_id: string;
  current_task: string | null;
  current_phase: string | null;
  current_assumption: string | null;
  important_decisions: string | null;
  work_mode: string | null; // 'coding' | 'debugging' | 'planning' | 'research' | 'chatting' | 'urgent'
  focus_mode: number; // 0=off, 1=on
  recommended_ai: string | null; // 'jarvis' | 'croppy' | 'gemini' | 'gpt'
  mode_confidence: number; // 0.0-1.0
  updated_at: string;
}

/**
 * jarvis_context を取得
 *
 * @param userId Telegram user ID
 * @returns JarvisContext または null
 */
export async function getJarvisContext(
  userId: string | number
): Promise<JarvisContext | null> {
  try {
    const userIdStr = String(userId);

    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT user_id, current_task, current_phase, current_assumption, important_decisions,
                   work_mode, focus_mode, recommended_ai, mode_confidence, updated_at
            FROM jarvis_context
            WHERE user_id = ?`,
      params: [userIdStr],
    });

    if (response.error || !response.data?.results?.[0]) {
      console.log('[Jarvis Context] コンテキスト未登録:', userIdStr);
      return null;
    }

    console.log('[Jarvis Context] 取得成功');
    return response.data.results[0] as JarvisContext;
  } catch (error) {
    console.error('[Jarvis Context] 取得エラー:', error);
    return null;
  }
}

/**
 * jarvis_context を更新（存在しない場合は作成）
 *
 * @param userId Telegram user ID
 * @param updates 更新する項目（部分更新可能）
 */
export async function updateJarvisContext(
  userId: string | number,
  updates: {
    current_task?: string | null;
    current_phase?: string | null;
    current_assumption?: string | null;
    important_decisions?: string | null;
    work_mode?: string | null;
    focus_mode?: number;
    recommended_ai?: string | null;
    mode_confidence?: number;
  }
): Promise<void> {
  try {
    const userIdStr = String(userId);

    // まず現在のコンテキストを取得
    const existing = await getJarvisContext(userIdStr);

    if (existing) {
      // 既存レコードを更新
      const newTask = updates.current_task !== undefined ? updates.current_task : existing.current_task;
      const newPhase = updates.current_phase !== undefined ? updates.current_phase : existing.current_phase;
      const newAssumption = updates.current_assumption !== undefined ? updates.current_assumption : existing.current_assumption;
      const newDecisions = updates.important_decisions !== undefined ? updates.important_decisions : existing.important_decisions;
      const newWorkMode = updates.work_mode !== undefined ? updates.work_mode : existing.work_mode;
      const newFocusMode = updates.focus_mode !== undefined ? updates.focus_mode : existing.focus_mode;
      const newRecommendedAI = updates.recommended_ai !== undefined ? updates.recommended_ai : existing.recommended_ai;
      const newModeConfidence = updates.mode_confidence !== undefined ? updates.mode_confidence : existing.mode_confidence;

      await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `UPDATE jarvis_context
              SET current_task = ?,
                  current_phase = ?,
                  current_assumption = ?,
                  important_decisions = ?,
                  work_mode = ?,
                  focus_mode = ?,
                  recommended_ai = ?,
                  mode_confidence = ?,
                  updated_at = datetime('now')
              WHERE user_id = ?`,
        params: [newTask, newPhase, newAssumption, newDecisions, newWorkMode, newFocusMode, newRecommendedAI, newModeConfidence, userIdStr],
      });

      console.log('[Jarvis Context] 更新成功:', updates);
    } else {
      // 新規作成
      await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `INSERT INTO jarvis_context (user_id, current_task, current_phase, current_assumption, important_decisions,
                                          work_mode, focus_mode, recommended_ai, mode_confidence)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          userIdStr,
          updates.current_task || null,
          updates.current_phase || null,
          updates.current_assumption || null,
          updates.important_decisions || null,
          updates.work_mode || 'chatting',
          updates.focus_mode !== undefined ? updates.focus_mode : 0,
          updates.recommended_ai || 'jarvis',
          updates.mode_confidence !== undefined ? updates.mode_confidence : 0.0,
        ],
      });

      console.log('[Jarvis Context] 新規作成成功:', updates);
    }
  } catch (error) {
    console.error('[Jarvis Context] 更新エラー:', error);
  }
}

/**
 * 応答から現在のタスクを自動抽出
 */
export function extractCurrentTask(response: string): string | null {
  // "タスク:" または "Task:" で始まる行を検索
  const taskPatterns = [
    /(?:タスク|Task):\s*(.+)/i,
    /(?:現在のタスク|Current task):\s*(.+)/i,
    /(?:作業中|Working on):\s*(.+)/i,
  ];

  for (const pattern of taskPatterns) {
    const match = response.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 200); // 200文字まで
    }
  }

  return null;
}

/**
 * 応答から現在のフェーズを自動抽出
 */
export function extractCurrentPhase(response: string): string | null {
  // "Phase X" パターンを検索
  const phasePatterns = [
    /Phase\s+(\d+)(?:\s*:\s*(.+?))?(?:\n|$)/i,
    /フェーズ\s*(\d+)(?:\s*[:：]\s*(.+?))?(?:\n|$)/i,
  ];

  for (const pattern of phasePatterns) {
    const match = response.match(pattern);
    if (match) {
      const phaseNumber = match[1];
      const phaseName = match[2] ? match[2].trim() : '';
      return phaseName ? `Phase ${phaseNumber}: ${phaseName}` : `Phase ${phaseNumber}`;
    }
  }

  return null;
}

/**
 * 応答から前提条件を自動抽出
 */
export function extractAssumptions(response: string): string | null {
  const assumptionPatterns = [
    /前提[:：]\s*(.+)/i,
    /前提条件[:：]\s*(.+)/i,
    /Assumptions?[:：]\s*(.+)/i,
  ];

  for (const pattern of assumptionPatterns) {
    const match = response.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 300);
    }
  }

  // キーワードベースの推定
  const assumptions: string[] = [];

  if (/実験|experiment|test|trial/i.test(response)) {
    assumptions.push('実験フェーズ');
  }

  if (/本番影響なし|no production impact|safe/i.test(response)) {
    assumptions.push('本番影響なし');
  }

  if (/緊急|urgent|critical/i.test(response)) {
    assumptions.push('緊急対応');
  }

  return assumptions.length > 0 ? assumptions.join(', ') : null;
}

/**
 * 応答から重要な決定を自動抽出
 */
export function extractImportantDecisions(response: string): string | null {
  const decisionPatterns = [
    /(?:重要な)?決定[:：]\s*(.+)/i,
    /Decision[:：]\s*(.+)/i,
    /決まったこと[:：]\s*(.+)/i,
  ];

  for (const pattern of decisionPatterns) {
    const match = response.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 500);
    }
  }

  // キーワードベースの検出
  const decisions: string[] = [];

  if (/従量課金API.*?使わない|no pay-per-use|API禁止/i.test(response)) {
    decisions.push('従量課金API使用禁止');
  }

  if (/callClaudeCLI|Telegram転送/i.test(response)) {
    decisions.push('Claude CLI経由（Telegram転送）使用');
  }

  return decisions.length > 0 ? decisions.join('; ') : null;
}

/**
 * 応答から自動的にコンテキストを更新
 *
 * Phase開始/完了、タスク変更、重要な決定を検出して自動更新
 */
export async function autoUpdateContext(
  userId: string | number,
  response: string
): Promise<void> {
  const updates: {
    current_task?: string;
    current_phase?: string;
    current_assumption?: string;
    important_decisions?: string;
  } = {};

  // タスク抽出
  const task = extractCurrentTask(response);
  if (task) {
    updates.current_task = task;
  }

  // フェーズ抽出
  const phase = extractCurrentPhase(response);
  if (phase) {
    updates.current_phase = phase;
  }

  // 前提条件抽出
  const assumptions = extractAssumptions(response);
  if (assumptions) {
    updates.current_assumption = assumptions;
  }

  // 重要な決定抽出
  const decisions = extractImportantDecisions(response);
  if (decisions) {
    // 既存の決定に追加
    const existing = await getJarvisContext(userId);
    if (existing?.important_decisions) {
      updates.important_decisions = `${existing.important_decisions}; ${decisions}`;
    } else {
      updates.important_decisions = decisions;
    }
  }

  // 更新がある場合のみDB更新
  if (Object.keys(updates).length > 0) {
    await updateJarvisContext(userId, updates);
    console.log('[Jarvis Context] 自動更新:', updates);
  }
}

/**
 * コンテキストを整形してプロンプト用文字列に変換
 */
export function formatContextForPrompt(context: JarvisContext | null): string {
  if (!context) {
    return '（コンテキストなし）';
  }

  const parts: string[] = [];

  if (context.current_task) {
    parts.push(`現在のタスク: ${context.current_task}`);
  }

  if (context.current_phase) {
    parts.push(`現在のPhase: ${context.current_phase}`);
  }

  if (context.current_assumption) {
    parts.push(`前提条件: ${context.current_assumption}`);
  }

  if (context.important_decisions) {
    parts.push(`重要な決定: ${context.important_decisions}`);
  }

  return parts.length > 0 ? parts.join('\n') : '（コンテキストなし）';
}

/**
 * Smart AI Router - メッセージから作業モードを自動判定してDBに保存
 *
 * @param userId Telegram user ID
 * @param message ユーザーメッセージ
 */
export async function autoDetectAndUpdateWorkMode(
  userId: string | number,
  message: string
): Promise<void> {
  try {
    const detection = detectWorkMode(message);
    const recommendedAI = getRecommendedAI(detection.mode);

    console.log(`[Smart AI Router] Detected: ${detection.mode} (confidence: ${detection.confidence})`);

    await updateJarvisContext(userId, {
      work_mode: detection.mode,
      recommended_ai: recommendedAI,
      mode_confidence: detection.confidence,
    });
  } catch (error) {
    console.error('[Smart AI Router] Error:', error);
  }
}
