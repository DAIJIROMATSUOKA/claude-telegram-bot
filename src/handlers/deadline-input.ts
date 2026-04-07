/**
 * deadline-input.ts
 * Telegram: "M1300の納期2026/03/31" → Access DB更新 + カレンダー登録
 * 
 * Format: YYYY/MM/DD 統一（年必須）
 * Examples:
 *   M1300の納期2026/03/31
 *   M1322 納期 2026/04/15
 *   M1319の納期2026-03-09
 */

import { createLogger } from "../utils/logger";
const log = createLogger("deadline-input");

import { exec } from 'child_process';
import type { Context } from 'grammy';

// YYYY/MM/DD or YYYY-MM-DD (年必須)
const DEADLINE_REGEX = /[MP]M?(\d{3,4})\S*\s*(?:の)?(?:希望)?納期\s*[:：]?\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/i;

/** Detect and process deadline messages (e.g. "M1300の納期2026/03/31"). */
export async function handleDeadlineInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) return false;

  // Check if it looks like a deadline message but wrong format
  if (/[MP]M?\d{3,4}.*納期/i.test(text) && !DEADLINE_REGEX.test(text)) {
    await ctx.reply('⚠️ 納期は YYYY/MM/DD 形式で入力してください\n例: M1300の納期2026/03/31');
    return true;
  }

  const match = text.match(DEADLINE_REGEX);
  if (!match) return false;

  const machineNo = match[1];
  const year = parseInt(match[2]!);
  const month = parseInt(match[3]!);
  const day = parseInt(match[4]!);

  const deadline = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const machineLabel = `M${machineNo}`;
  const chatId = ctx.chat?.id;

  await ctx.reply(`⏳ ${machineLabel}の希望納期を ${deadline} に更新中...（Parallels経由、約60秒）`);

  exec(
    `python3 ~/scripts/access-write-deadline.py M${machineNo} ${deadline}`,
    { timeout: 180000, shell: '/bin/zsh' },
    (error, stdout, stderr) => {
      const bot = ctx.api;
      if (!chatId) return;

      if (error) {
        const errMsg = stderr || error.message || 'Unknown error';
        bot.sendMessage(chatId, `❌ 納期更新エラー: ${errMsg.substring(0, 200)}`).catch(() => {});
        log.error('[Deadline] exec error:', errMsg.substring(0, 200));
        return;
      }

      const output = (stdout || '').trim();
      if (output.startsWith('ERROR:')) {
        bot.sendMessage(chatId, `❌ ${output}`).catch(() => {});
      } else {
        bot.sendMessage(chatId, `✅ ${output}`).catch(() => {});
      }
      log.info('[Deadline] result:', output.substring(0, 100));
    }
  );

  log.info(`[Deadline] fired: M${machineNo} ${deadline}`);
  return true;
}
