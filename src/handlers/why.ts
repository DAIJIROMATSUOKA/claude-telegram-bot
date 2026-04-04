/**
 * /why Command Handler
 *
 * Shows AI decision rationale for the latest action
 * - What (何をした)
 * - Why (なぜそうした)
 * - Evidence (根拠)
 * - Change (何が変わった)
 * - Rollback (戻し方)
 * - Next (次の一手)
 */

import type { Context } from 'grammy';
import { controlTowerDB } from '../utils/control-tower-db';
import { isAuthorized } from '../security';
import { ALLOWED_USERS } from '../config';

/**
 * /why - Show AI decision rationale
 */
export async function handleWhy(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('⛔ Unauthorized');
    return;
  }

  // 2. Check allowlist
  const allowlistSetting = controlTowerDB.getSetting('why_allowlist_user_ids');
  if (allowlistSetting) {
    try {
      const allowlist: number[] = JSON.parse(allowlistSetting.value);
      // If allowlist is not empty and user is not in it
      if (allowlist.length > 0 && !allowlist.includes(userId!)) {
        await ctx.reply('⛔ Access denied');
        return;
      }
    } catch (e) {
      console.error('[/why] Failed to parse why_allowlist_user_ids:', e);
    }
  }

  // 3. Get latest action trace for this session
  // We use chat_id + message_id as session_id (format: "{chatId}_{messageId}")
  // For simplicity, we'll get the latest trace from any session for this user
  // Try to find session_id from control tower
  const towers = controlTowerDB.getAllControlTowers();
  const latestTower = towers.find(t => t.session_id.includes(String(chatId)));

  let latestTrace = null;
  if (latestTower) {
    latestTrace = controlTowerDB.getLatestActionTrace(latestTower.session_id);
  }

  if (!latestTrace) {
    await ctx.reply('❌ No action trace found');
    return;
  }

  // 4. Format response
  const lines: string[] = [];

  lines.push('🔍 <b>AI Decision Analysis</b>\n');

  // What (何をした)
  lines.push('<b>📌 What</b>');
  lines.push(`Action: ${latestTrace.action_name || latestTrace.action_type}`);
  lines.push(`Status: ${latestTrace.status}`);
  if (latestTrace.duration_ms) {
    lines.push(`Duration: ${latestTrace.duration_ms}ms`);
  }
  lines.push('');

  // Why (なぜそうした)
  lines.push('<b>💡 Why</b>');
  if (latestTrace.decisions) {
    try {
      const decisions = JSON.parse(latestTrace.decisions);
      if (typeof decisions === 'object' && decisions.rationale) {
        lines.push(decisions.rationale);
      } else {
        lines.push(String(decisions));
      }
    } catch {
      lines.push(latestTrace.decisions);
    }
  } else {
    lines.push('(No decision rationale recorded)');
  }
  lines.push('');

  // Evidence (根拠)
  lines.push('<b>📊 Evidence</b>');
  if (latestTrace.inputs_redacted) {
    lines.push(latestTrace.inputs_redacted);
  } else {
    lines.push('(No input evidence recorded)');
  }
  lines.push('');

  // Change (何が変わった)
  lines.push('<b>🔄 Change</b>');
  if (latestTrace.outputs_summary) {
    lines.push(latestTrace.outputs_summary);
  } else if (latestTrace.error_summary) {
    lines.push(`⚠️ Error: ${latestTrace.error_summary}`);
  } else {
    lines.push('(No change summary recorded)');
  }
  lines.push('');

  // Rollback (戻し方)
  lines.push('<b>↩️ Rollback</b>');
  if (latestTrace.rollback_instruction) {
    lines.push(latestTrace.rollback_instruction);
  } else {
    lines.push('(No rollback instruction available)');
  }
  lines.push('');

  // Next (次の一手)
  lines.push('<b>➡️ Next</b>');
  if (latestTrace.metadata) {
    try {
      const meta = JSON.parse(latestTrace.metadata);
      if (meta.next_step) {
        lines.push(meta.next_step);
      } else {
        lines.push('(No next step suggestion)');
      }
    } catch {
      lines.push('(No next step suggestion)');
    }
  } else {
    lines.push('(No next step suggestion)');
  }

  // Add timestamp
  const timestamp = new Date(latestTrace.started_at * 1000).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
  });
  lines.push('');
  lines.push(`⏰ Executed at: ${timestamp}`);

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}
