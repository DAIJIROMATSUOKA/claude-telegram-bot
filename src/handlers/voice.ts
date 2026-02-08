/**
 * Voice message handler for Claude Telegram Bot.
 *
 * Voice transcription is disabled (requires pay-per-use OpenAI API).
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";

/**
 * Handle incoming voice messages.
 */
export async function handleVoice(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  // Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  // Voice transcription is disabled (OpenAI API = pay-per-use, violates no-billing rule)
  await ctx.reply(
    "Voice messages are currently disabled. Please send text instead."
  );
}
