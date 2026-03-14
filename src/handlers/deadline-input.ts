/**
 * deadline-input.ts
 * Telegram message handler for deadline input
 * Pattern: "M1300の納期3/31" or "M1300 納期 2026-03-31"
 * 
 * Integration: Import and call from text.ts message handler
 * 
 * ```ts
 * import { handleDeadlineInput } from './deadline-input';
 * // In message handler, before AI routing:
 * const handled = await handleDeadlineInput(ctx);
 * if (handled) return;
 * ```
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Context } from 'grammy';

const execAsync = promisify(exec);

// Match patterns:
// "M1300の納期3/31"  "M1300 納期 2026-03-31"  "PM931の納期4月15日"
// "M1317納期3月末" → won't match (needs explicit date)
const DEADLINE_PATTERN = /[MP]M?(\d{3,4})(?:[-\s]*\d*)?[\s]*(?:の)?納期[\s:：]*(\d{1,4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})?日?/i;

// Simpler pattern: "M1300の納期3/31" or "M1300の納期2026-03-31"
const DEADLINE_SIMPLE = /[MP]M?(\d{3,4})\S*\s*(?:の)?(?:希望)?納期\s*[:：]?\s*(\d{1,4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/i;

export async function handleDeadlineInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) return false;

  // Try both patterns
  const match = text.match(DEADLINE_SIMPLE) || text.match(DEADLINE_PATTERN);
  if (!match) return false;

  const machineNo = match[1]; // e.g., "1300"
  let year: number, month: number, day: number;

  if (match[4]) {
    // Full date: YYYY/MM/DD or MM/DD/YY
    if (parseInt(match[2]) > 2000) {
      year = parseInt(match[2]);
      month = parseInt(match[3]);
      day = parseInt(match[4]);
    } else {
      // Assume MM/DD or MM/DD with year in context
      month = parseInt(match[2]);
      day = parseInt(match[3]);
      year = new Date().getFullYear();
    }
  } else {
    // MM/DD format, assume current year
    month = parseInt(match[2]);
    day = parseInt(match[3]);
    year = new Date().getFullYear();
    // If the date is already past, assume next year
    const testDate = new Date(year, month - 1, day);
    if (testDate < new Date()) {
      year++;
    }
  }

  const deadline = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const machineLabel = `M${machineNo}`;

  // Confirm before writing
  await ctx.reply(`${machineLabel}の希望納期を ${deadline} に更新中...`);

  try {
    const { stdout, stderr } = await execAsync(
      `python3 ~/scripts/access-write-deadline.py M${machineNo} ${deadline}`,
      { timeout: 120000, shell: '/bin/zsh' }
    );

    const output = stdout.trim();
    if (output.startsWith('ERROR:')) {
      await ctx.reply(`❌ ${output}`);
    } else {
      await ctx.reply(`✅ ${output}`);
    }
  } catch (error: any) {
    const errMsg = error.stderr || error.message || 'Unknown error';
    await ctx.reply(`❌ 納期更新エラー: ${errMsg.substring(0, 200)}`);
  }

  return true; // Handled, don't pass to AI
}
