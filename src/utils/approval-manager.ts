/**
 * Approval Manager
 *
 * Manages approval requests and waiting for user responses
 */

import type { Context } from 'grammy';
import {
  createApprovalRequest,
  createApprovalKeyboard,
  saveApprovalRequest,
  loadApprovalRequest,
  formatApprovalMessage,
  type ApprovalRequest
} from './approval-flow';
import { detectDangerousCommand, type DangerDetectionResult } from './danger-detector';

/**
 * 承認リクエストを送信してユーザーの応答を待つ
 *
 * @param ctx Telegram context
 * @param detection 検出された危険な操作
 * @param context 実行しようとしているコンテキスト
 * @param command 実行しようとしているコマンド（オプション）
 * @returns ユーザーが承認した場合true、拒否または期限切れの場合false
 */
export async function requestApprovalAndWait(
  ctx: Context,
  detection: DangerDetectionResult,
  context: string,
  command?: string
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    console.error('[ApprovalManager] Missing userId or chatId');
    return false;
  }

  // 承認リクエストを作成
  const request = createApprovalRequest(userId, chatId, detection, context, command);

  // リクエストを保存
  await saveApprovalRequest(request);

  // インラインキーボードを作成
  const keyboard = createApprovalKeyboard(request.requestId, detection.level);

  // メッセージを作成
  const message = formatApprovalMessage(request);

  // Telegramに送信
  try {
    await ctx.reply(message, {
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('[ApprovalManager] Failed to send approval request:', error);
    return false;
  }

  // ユーザーの応答を待機（ポーリング）
  const approved = await waitForApprovalResponse(request.requestId);

  return approved;
}

/**
 * 承認リクエストの応答を待機（ポーリング）
 *
 * @param requestId リクエストID
 * @param timeoutMs タイムアウト時間（ミリ秒）
 * @returns 承認された場合true、拒否または期限切れの場合false
 */
async function waitForApprovalResponse(
  requestId: string,
  timeoutMs: number = 5 * 60 * 1000 // 5分
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500; // 500msごとにチェック

  while (true) {
    // タイムアウトチェック
    if (Date.now() - startTime > timeoutMs) {
      console.log(`[ApprovalManager] Approval request ${requestId} timed out`);
      return false;
    }

    // リクエストを読み込み
    const request = await loadApprovalRequest(requestId);

    if (!request) {
      console.error(`[ApprovalManager] Failed to load approval request ${requestId}`);
      return false;
    }

    // ステータスをチェック
    if (request.status === 'approved') {
      console.log(`[ApprovalManager] Approval request ${requestId} approved`);
      return true;
    }

    if (request.status === 'rejected') {
      console.log(`[ApprovalManager] Approval request ${requestId} rejected`);
      return false;
    }

    if (request.status === 'expired') {
      console.log(`[ApprovalManager] Approval request ${requestId} expired`);
      return false;
    }

    // 次のポーリングまで待機
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * コマンドが危険かどうかチェックし、必要に応じて承認を求める
 *
 * @param ctx Telegram context
 * @param command 実行しようとしているコマンド
 * @returns 実行可能な場合true、実行不可の場合false
 */
export async function checkAndRequestApproval(
  ctx: Context,
  command: string
): Promise<boolean> {
  // 危険なコマンドを検出
  const detection = detectDangerousCommand(command);

  // 安全なコマンドはそのまま実行
  if (!detection.isDangerous) {
    return true;
  }

  // 承認が不要な場合はそのまま実行（mediumレベルで承認不要の設定の場合）
  if (!detection.needsApproval) {
    // mediumレベルは警告を表示するが承認は不要
    if (detection.level === 'medium') {
      await ctx.reply(`⚡ **注意:** 以下の操作を実行します\n\`${command.slice(0, 100)}\``);
    }
    return true;
  }

  // 承認を要求
  console.log(`[ApprovalManager] Requesting approval for command: ${command.slice(0, 50)}...`);

  const approved = await requestApprovalAndWait(ctx, detection, command, command);

  return approved;
}

/**
 * ユーザーメッセージから危険な意図を検出し、必要に応じて警告
 *
 * @param ctx Telegram context
 * @param message ユーザーメッセージ
 * @returns 危険な操作が検出された場合、検出結果。それ以外はnull
 */
export async function checkMessageIntent(
  ctx: Context,
  message: string
): Promise<DangerDetectionResult | null> {
  const { detectDangerousIntent } = await import('./danger-detector');
  const detection = detectDangerousIntent(message);

  if (!detection.isDangerous) {
    return null;
  }

  // 危険度が高い場合は警告を表示
  if (detection.needsApproval) {
    const emoji = detection.level === 'critical' ? '🚨' : '⚠️';
    await ctx.reply(
      `${emoji} **注意:** 危険な操作を実行しようとしています。慎重に確認してください。`,
      { disable_notification: true }
    );
  }

  return detection;
}
