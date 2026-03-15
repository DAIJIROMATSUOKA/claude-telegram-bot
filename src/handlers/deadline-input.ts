/**
 * deadline-input.ts
 * Telegram message handler for deadline input
 * Pattern: "M1300の納期3/31" or "M1300 納期 2026-03-31"
 * 
 * IMPORTANT: Parallels COM execution takes 60+ seconds.
 * Uses fire-and-forget (non-blocking) to avoid blocking Grammy handler.
 */

import { exec } from 'child_process';
import type { Context } from 'grammy';

// Simpler pattern: "M1300の納期3/31" or "M1300の納期2026-03-31"
const DEADLINE_SIMPLE = /[MP]M?(\d{3,4})\S*\s*(?:の)?(?:希望)?納期\s*[:：]?\s*(\d{1,4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/i;

// Extended pattern: "M1300の納期2026年3月31日" or "M1300の納期2026-3-31"
const DEADLINE_PATTERN = /[MP]M?(\d{3,4})(?:[-\s]*\d*)?[\s]*(?:の)?納期[\s:：]*(\d{1,4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})?日?/i;

// Japanese month/day: "M1300の納期3月31日" or "M1300の納期3月末"
const DEADLINE_JP = /[MP]M?(\d{3,4})\S*\s*(?:の)?(?:希望)?納期\s*[:：]?\s*(\d{1,2})月(\d{1,2})日?/i;

// Month-end: "M1300の納期3月末"
const DEADLINE_MONTH_END = /[MP]M?(\d{3,4})\S*\s*(?:の)?(?:希望)?納期\s*[:：]?\s*(\d{1,2})月末/i;

export async function handleDeadlineInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) return false;

  // Try all patterns
  const match = text.match(DEADLINE_SIMPLE) || text.match(DEADLINE_PATTERN) || text.match(DEADLINE_JP);
  const monthEndMatch = !match ? text.match(DEADLINE_MONTH_END) : null;
  if (!match && !monthEndMatch) return false;

  let machineNo: string, year: number, month: number, day: number;

  if (monthEndMatch) {
    // "3月末" → last day of month
    machineNo = monthEndMatch[1];
    month = parseInt(monthEndMatch[2]);
    year = new Date().getFullYear();
    // Last day of month: day 0 of next month
    day = new Date(year, month, 0).getDate();
    if (new Date(year, month - 1, day) < new Date()) {
      year++;
      day = new Date(year, month, 0).getDate();
    }
  } else if (match) {
    machineNo = match[1];
    if (match[4]) {
      if (parseInt(match[2]) > 2000) {
        year = parseInt(match[2]);
        month = parseInt(match[3]);
        day = parseInt(match[4]);
      } else {
        month = parseInt(match[2]);
        day = parseInt(match[3]);
        year = new Date().getFullYear();
      }
    } else {
      month = parseInt(match[2]);
      day = parseInt(match[3]);
      year = new Date().getFullYear();
      const testDate = new Date(year, month - 1, day);
      if (testDate < new Date()) {
        year++;
      }
    }
  } else {
    return false;
  }

  const deadline = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const machineLabel = `M${machineNo}`;
  const chatId = ctx.chat?.id;

  // Send immediate ack (non-blocking)
  await ctx.reply(`⏳ ${machineLabel}の希望納期を ${deadline} に更新中...（Parallels経由、約60秒）`);

  // Fire-and-forget: spawn background process, callback sends result via Telegram
  exec(
    `python3 ~/scripts/access-write-deadline.py M${machineNo} ${deadline}`,
    { timeout: 180000, shell: '/bin/zsh' },
    (error, stdout, stderr) => {
      const bot = ctx.api;
      if (!chatId) return;

      if (error) {
        const errMsg = stderr || error.message || 'Unknown error';
        bot.sendMessage(chatId, `❌ 納期更新エラー: ${errMsg.substring(0, 200)}`).catch(() => {});
        console.error('[Deadline] exec error:', errMsg.substring(0, 200));
        return;
      }

      const output = (stdout || '').trim();
      if (output.startsWith('ERROR:')) {
        bot.sendMessage(chatId, `❌ ${output}`).catch(() => {});
      } else {
        bot.sendMessage(chatId, `✅ ${output}`).catch(() => {});
      }
      console.log('[Deadline] result:', output.substring(0, 100));
    }
  );

  console.log(`[Deadline] fired: M${machineNo} ${deadline}`);
  return true; // Return immediately, don't block Grammy
}
