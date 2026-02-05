/**
 * Approval Flow Utility
 *
 * Manages user approval requests with inline keyboards
 */

import { InlineKeyboard } from 'grammy';
import type { DangerDetectionResult } from './danger-detector';

/**
 * 承認リクエストのデータ構造
 */
export interface ApprovalRequest {
  requestId: string;
  userId: number;
  chatId: number;
  detection: DangerDetectionResult;
  context: string;
  command?: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

/**
 * 承認リクエストのタイムアウト（5分）
 */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 承認リクエストを作成
 */
export function createApprovalRequest(
  userId: number,
  chatId: number,
  detection: DangerDetectionResult,
  context: string,
  command?: string
): ApprovalRequest {
  const requestId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    requestId,
    userId,
    chatId,
    detection,
    context,
    command,
    timestamp: Date.now(),
    status: 'pending'
  };
}

/**
 * 承認リクエスト用のインラインキーボードを生成
 */
export function createApprovalKeyboard(requestId: string, level: DangerDetectionResult['level']): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // 危険レベルに応じてボタンのテキストを変更
  if (level === 'critical') {
    keyboard
      .text('⚠️ 理解して実行', `approval:approve:${requestId}`)
      .text('❌ キャンセル', `approval:reject:${requestId}`);
  } else if (level === 'high') {
    keyboard
      .text('✅ 承認して実行', `approval:approve:${requestId}`)
      .text('❌ キャンセル', `approval:reject:${requestId}`);
  } else {
    keyboard
      .text('✅ 実行', `approval:approve:${requestId}`)
      .text('❌ キャンセル', `approval:reject:${requestId}`);
  }

  return keyboard;
}

/**
 * 承認リクエストをファイルに保存
 */
export async function saveApprovalRequest(request: ApprovalRequest): Promise<void> {
  const filePath = `/tmp/approval-request-${request.requestId}.json`;

  try {
    await Bun.write(filePath, JSON.stringify(request, null, 2));
    console.log(`[ApprovalFlow] Saved approval request: ${request.requestId}`);
  } catch (error) {
    console.error('[ApprovalFlow] Failed to save approval request:', error);
    throw error;
  }
}

/**
 * 承認リクエストをファイルから読み込み
 */
export async function loadApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
  const filePath = `/tmp/approval-request-${requestId}.json`;

  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const request: ApprovalRequest = JSON.parse(text);

    // タイムアウトチェック
    if (Date.now() - request.timestamp > APPROVAL_TIMEOUT_MS) {
      request.status = 'expired';
    }

    return request;
  } catch (error) {
    console.error(`[ApprovalFlow] Failed to load approval request ${requestId}:`, error);
    return null;
  }
}

/**
 * 承認リクエストのステータスを更新
 */
export async function updateApprovalStatus(
  requestId: string,
  status: 'approved' | 'rejected' | 'expired'
): Promise<boolean> {
  try {
    const request = await loadApprovalRequest(requestId);
    if (!request) {
      return false;
    }

    request.status = status;
    await saveApprovalRequest(request);

    console.log(`[ApprovalFlow] Updated approval ${requestId} to ${status}`);
    return true;
  } catch (error) {
    console.error(`[ApprovalFlow] Failed to update approval status:`, error);
    return false;
  }
}

/**
 * 期限切れの承認リクエストをクリーンアップ
 */
export async function cleanupExpiredApprovals(): Promise<void> {
  try {
    const { unlinkSync } = await import('fs');
    const { readdirSync } = await import('fs');

    const files = readdirSync('/tmp').filter(f => f.startsWith('approval-request-'));

    let cleaned = 0;
    for (const file of files) {
      const filePath = `/tmp/${file}`;
      try {
        const content = await Bun.file(filePath).text();
        const request: ApprovalRequest = JSON.parse(content);

        // 5分以上経過したリクエストを削除
        if (Date.now() - request.timestamp > APPROVAL_TIMEOUT_MS) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        // 読み込みエラーの場合はファイル削除
        try {
          unlinkSync(filePath);
          cleaned++;
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[ApprovalFlow] Cleaned up ${cleaned} expired approval requests`);
    }
  } catch (error) {
    console.error('[ApprovalFlow] Failed to cleanup expired approvals:', error);
  }
}

/**
 * 承認リクエストメッセージのフォーマット
 */
export function formatApprovalMessage(request: ApprovalRequest): string {
  const { detection, context } = request;
  const emoji = getDangerEmoji(detection.level);

  let message = `${emoji} **承認が必要な操作**\n\n`;

  // 検出された危険な操作をリスト化
  if (detection.matches.length > 0) {
    message += '**検出された操作:**\n';
    for (let i = 0; i < detection.matches.length; i++) {
      const match = detection.matches[i];
      if (!match) continue;
      message += `${i + 1}. ${match.description}\n`;
    }
    message += '\n';
  }

  // コンテキストを表示
  message += '**実行内容:**\n';
  const displayContext = context.length > 200 ? context.slice(0, 200) + '...' : context;
  message += `\`${displayContext}\`\n\n`;

  // 警告メッセージ
  const mostSevereMatch = detection.matches[0];
  if (mostSevereMatch) {
    message += `${mostSevereMatch.confirmationPrompt}\n`;
  }

  return message;
}

/**
 * 危険レベルに応じた絵文字を取得
 */
function getDangerEmoji(level: DangerDetectionResult['level']): string {
  switch (level) {
    case 'critical':
      return '🚨';
    case 'high':
      return '⚠️';
    case 'medium':
      return '⚡';
    default:
      return '✅';
  }
}

/**
 * 承認結果メッセージのフォーマット
 */
export function formatApprovalResultMessage(
  approved: boolean,
  context: string
): string {
  if (approved) {
    return `✅ **承認されました**\n実行します...\n\n\`${context.slice(0, 100)}\``;
  } else {
    return `❌ **キャンセルされました**\n操作は実行されませんでした。`;
  }
}
