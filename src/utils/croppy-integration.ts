/**
 * Croppy Auto-Approval Integration
 *
 * Jarvisのワークフローに組み込むためのヘルパー関数
 */

import { Context } from 'grammy';
import { askCroppyApproval } from './croppy-approval';
import type { ApprovalInput } from './croppy-approval';
import { isAutoApprovalEnabled } from '../handlers/croppy-commands';

/**
 * フェーズ完了時の承認チェック
 *
 * 使い方:
 * 1. Jarvisがフェーズ完了を報告する直前に呼び出す
 * 2. 戻り値が true なら自動承認、false なら DJに確認を求める
 *
 * @param ctx Telegram Context
 * @param input 承認判断に必要な情報
 * @returns true = 自動承認GO, false = DJ確認必要
 */
export async function checkPhaseApproval(
  ctx: Context,
  input: ApprovalInput
): Promise<{ approved: boolean; reason: string }> {
  // 1. 自動承認が有効かチェック
  const autoEnabled = await isAutoApprovalEnabled();
  if (!autoEnabled) {
    console.log('[Croppy Integration] 自動承認無効 → DJ確認');
    return {
      approved: false,
      reason: '自動承認が無効化されています（/croppy enable で有効化）',
    };
  }

  // 2. croppyに判断を依頼
  console.log('[Croppy Integration] croppy判断開始:', input.phase_name);
  const result = await askCroppyApproval(input);

  // 3. 結果をTelegramに通知
  if (result.approved) {
    await ctx.reply(
      `🦞 <b>Croppy Auto-Approval: GO</b>\n\n` +
      `<b>Phase:</b> ${input.phase_name}\n` +
      `<b>理由:</b> ${result.reason}\n\n` +
      `次のフェーズに進みます...`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.reply(
      `🦞 <b>Croppy Auto-Approval: STOP</b>\n\n` +
      `<b>Phase:</b> ${input.phase_name}\n` +
      `<b>理由:</b> ${result.reason}\n\n` +
      `⚠️ DJの承認が必要です。\n` +
      `続行する場合は「GO」と送信してください。`,
      { parse_mode: 'HTML' }
    );
  }

  console.log('[Croppy Integration] 判断結果:', { approved: result.approved, reason: result.reason });
  return { approved: result.approved, reason: result.reason };
}

/**
 * テストヘルパー: croppyの判断をテストする
 */
export async function testCroppyApproval(ctx: Context) {
  const testInput: ApprovalInput = {
    phase_name: 'Test Phase',
    jarvis_context: 'これはテストです',
    prerequisite_summary: {
      is_experiment: false,
      production_impact: false,
      is_urgent: false,
    },
    implementation_summary: 'テスト用の実装サマリー',
    test_results: 'pass',
    error_report: null,
  };

  await ctx.reply('🦞 Croppyテスト開始...');
  const result = await checkPhaseApproval(ctx, testInput);
  await ctx.reply(
    `✅ テスト完了\n\n` +
    `承認: ${result.approved ? 'GO' : 'STOP'}\n` +
    `理由: ${result.reason}`
  );
}
