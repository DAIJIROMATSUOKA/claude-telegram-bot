/**
 * Telegram message sending utilities for AI Council
 *
 * Supports both single-bot and multi-avatar modes.
 */

import type { Api } from "grammy";
import type { CouncilAgentConfig } from "../../council-config";

interface SendOptions {
  chat_id: number;
  text: string;
  parse_mode?: "HTML" | "Markdown";
  reply_to_message_id?: number;
}

/**
 * Send a message using the control bot (Jarvis).
 */
export async function sendAsControlBot(
  bot: Api,
  options: SendOptions
): Promise<number> {
  try {
    const result = await bot.sendMessage(options.chat_id, options.text, {
      parse_mode: options.parse_mode || "HTML",
      reply_to_message_id: options.reply_to_message_id,
    });

    return result.message_id;
  } catch (error) {
    console.error("Failed to send as control bot:", error);
    throw error;
  }
}

/**
 * Send a message using an avatar bot (multi-avatar mode).
 *
 * This requires the avatar bot's token to be set in environment.
 * For now, this is a stub that falls back to control bot.
 */
export async function sendAsAvatarBot(
  bot: Api,
  agentConfig: CouncilAgentConfig,
  options: SendOptions
): Promise<number> {
  // TODO: Implement multi-avatar mode
  // For now, fall back to control bot
  console.warn(
    `Multi-avatar mode not fully implemented, using control bot for ${agentConfig.display_name}`
  );

  const prefixedText = `${agentConfig.emoji} <b>${agentConfig.display_name}</b>\n\n${options.text}`;

  return sendAsControlBot(bot, {
    ...options,
    text: prefixedText,
  });
}

/**
 * Send a message with rate limiting.
 *
 * Adds delay and jitter to avoid Telegram rate limits.
 */
export async function sendWithRateLimit(
  sendFn: () => Promise<number>,
  delayMs: number,
  jitterMs: number
): Promise<number> {
  const jitter = Math.random() * jitterMs;
  const totalDelay = delayMs + jitter;

  await new Promise((resolve) => setTimeout(resolve, totalDelay));

  return sendFn();
}

/**
 * Send a message with exponential backoff retry.
 */
export async function sendWithRetry(
  sendFn: () => Promise<number>,
  maxRetries: number = 3
): Promise<number> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendFn();
    } catch (error: any) {
      lastError = error;

      // Check if this is a rate limit error (429)
      if (error?.error_code === 429 || error?.message?.includes("429")) {
        const retryAfter = error?.parameters?.retry_after || 5;
        console.warn(
          `Rate limit hit, waiting ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      // For other errors, throw immediately
      throw error;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}
