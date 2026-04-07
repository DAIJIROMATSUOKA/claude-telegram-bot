/**
 * Croppy Auto-Approval Control Commands
 *
 * `/croppy disable` - 自動承認を無効化
 * `/croppy enable` - 自動承認を有効化
 * `/croppy status` - 現在の状態と統計を表示
 */

import { createLogger } from "../utils/logger";
const log = createLogger("croppy-commands");

import { Context } from 'grammy';
import { callMemoryGateway } from '../handlers/ai-router';

const MAX_DAILY_GO = 10;

/**
 * DBから自動承認有効/無効状態を取得
 */
async function getGlobalEnabled(): Promise<boolean> {
  try {
    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT config_value FROM approval_config WHERE config_key = 'global_enabled'`,
      params: [],
    });

    if (response.error || !response.data?.results?.[0]) {
      log.error('[Croppy] Failed to get global_enabled:', response.error);
      return true; // デフォルトはON
    }

    return response.data.results[0].config_value === '1';
  } catch (error) {
    log.error('[Croppy] Error fetching global_enabled:', error);
    return true;
  }
}

/**
 * DBに自動承認有効/無効状態を保存
 */
async function setGlobalEnabled(enabled: boolean): Promise<void> {
  try {
    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `UPDATE approval_config SET config_value = ?, updated_at = datetime('now'), updated_by = 'DJ' WHERE config_key = 'global_enabled'`,
      params: [enabled ? '1' : '0'],
    });
  } catch (error) {
    log.error('[Croppy] Error setting global_enabled:', error);
  }
}

/**
 * DBから本日のGO/STOP統計を取得
 */
async function getDailyStats(): Promise<{ goCount: number; stopCount: number }> {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT
              SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) as go_count,
              SUM(CASE WHEN approved = 0 THEN 1 ELSE 0 END) as stop_count
            FROM approval_log
            WHERE DATE(created_at) = ?`,
      params: [today],
    });

    if (response.error || !response.data?.results?.[0]) {
      log.error('[Croppy] Failed to get daily stats:', response.error);
      return { goCount: 0, stopCount: 0 };
    }

    const result = response.data.results[0];
    return {
      goCount: result.go_count || 0,
      stopCount: result.stop_count || 0,
    };
  } catch (error) {
    log.error('[Croppy] Error fetching daily stats:', error);
    return { goCount: 0, stopCount: 0 };
  }
}

/**
 * 自動承認が現在有効か判定（非同期版）
 */
export async function isAutoApprovalEnabled(): Promise<boolean> {
  // グローバル無効化チェック
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) {
    return false;
  }

  // 1日10回制限チェック
  const stats = await getDailyStats();
  if (stats.goCount >= MAX_DAILY_GO) {
    log.info('[Croppy] 1日GO上限到達:', stats.goCount);
    return false;
  }

  return true;
}

/**
 * GO承認をカウント（approval_logへの挿入は別途 logApprovalDecision で行う）
 */
export function recordGoApproval() {
  // この関数は下位互換性のため残すが、実際のカウントはDBログから自動集計
  log.info('[Croppy] GO記録（DBログから集計）');
}

/**
 * STOP判定をカウント（approval_logへの挿入は別途 logApprovalDecision で行う）
 */
export function recordStopDecision() {
  // この関数は下位互換性のため残すが、実際のカウントはDBログから自動集計
  log.info('[Croppy] STOP記録（DBログから集計）');
}

/**
 * `/croppy disable` - 自動承認を無効化
 */
export async function handleCroppyDisable(ctx: Context) {
  await setGlobalEnabled(false);

  await ctx.reply(
    '🦞 <b>Croppy Auto-Approval: DISABLED</b>\n\n' +
    '自動承認を無効化しました。\n' +
    'すべてのフェーズ完了時にDJの承認が必要になります。\n\n' +
    '<code>/croppy enable</code> で再有効化できます。',
    { parse_mode: 'HTML' }
  );

  log.info('[Croppy] 自動承認を無効化しました');
}

/**
 * `/croppy enable` - 自動承認を有効化
 */
export async function handleCroppyEnable(ctx: Context) {
  await setGlobalEnabled(true);
  const stats = await getDailyStats();

  await ctx.reply(
    '🦞 <b>Croppy Auto-Approval: ENABLED</b>\n\n' +
    '自動承認を有効化しました。\n' +
    '安全なフェーズ完了時は自動的にGOします。\n\n' +
    `本日の残りGO回数: ${MAX_DAILY_GO - stats.goCount}/${MAX_DAILY_GO}\n\n` +
    '<code>/croppy disable</code> で無効化できます。',
    { parse_mode: 'HTML' }
  );

  log.info('[Croppy] 自動承認を有効化しました');
}

/**
 * `/croppy status` - 現在の状態と統計を表示
 */
export async function handleCroppyStatus(ctx: Context) {
  const globalEnabled = await getGlobalEnabled();
  const stats = await getDailyStats();
  const today = new Date().toISOString().split('T')[0];

  const statusEmoji = globalEnabled ? '✅' : '🚫';
  const statusText = globalEnabled ? 'ENABLED' : 'DISABLED';

  const remainingGo = MAX_DAILY_GO - stats.goCount;
  const goBarLength = Math.floor((stats.goCount / MAX_DAILY_GO) * 10);
  const goBar = '█'.repeat(goBarLength) + '░'.repeat(10 - goBarLength);

  let statusMessage = `🦞 <b>Croppy Auto-Approval Status</b>\n\n`;
  statusMessage += `状態: ${statusEmoji} <b>${statusText}</b>\n\n`;
  statusMessage += `📊 <b>本日の統計</b> (${today})\n`;
  statusMessage += `GO承認: ${stats.goCount}/${MAX_DAILY_GO} [${goBar}]\n`;
  statusMessage += `STOP判定: ${stats.stopCount}\n`;
  statusMessage += `残りGO: ${remainingGo > 0 ? remainingGo : 0}\n\n`;

  if (stats.goCount >= MAX_DAILY_GO) {
    statusMessage += '⚠️ <b>本日のGO上限到達</b>\n';
    statusMessage += '明日0:00にリセットされます。\n\n';
  }

  statusMessage += `<b>コントロール:</b>\n`;
  statusMessage += `<code>/croppy enable</code> - 自動承認ON\n`;
  statusMessage += `<code>/croppy disable</code> - 自動承認OFF\n`;

  await ctx.reply(statusMessage, { parse_mode: 'HTML' });
}

/**
 * `/croppy` - ヘルプ表示
 */
export async function handleCroppyHelp(ctx: Context) {
  const helpMessage = `🦞 <b>Croppy Auto-Approval System</b>\n\n` +
    `croppyが自動でGO/STOPを判断します。\n\n` +
    `<b>コマンド:</b>\n` +
    `<code>/croppy status</code> - 現在の状態と統計\n` +
    `<code>/croppy enable</code> - 自動承認を有効化\n` +
    `<code>/croppy disable</code> - 自動承認を無効化\n\n` +
    `<b>制限:</b>\n` +
    `• 1日10回までGO承認\n` +
    `• タイムアウト15秒\n` +
    `• エラー時は自動STOP\n\n` +
    `<b>判断基準:</b>\n` +
    `• テストパス: ✅\n` +
    `• エラーなし: ✅\n` +
    `• 従量課金API不使用: ✅\n` +
    `• 不可逆操作なし: ✅\n` +
    `• 外部影響なし: ✅\n\n` +
    `1つでも該当しない場合は自動STOP。`;

  await ctx.reply(helpMessage, { parse_mode: 'HTML' });
}
