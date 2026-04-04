/**
 * telegram-buffer.ts — Grammy middleware for high-load message buffering
 *
 * If more than 5 messages arrive within 1 second from the same chat,
 * subsequent messages are queued and processed sequentially.
 * Prevents handler overlap and race conditions under burst load.
 *
 * Usage in index.ts:
 *   bot.use(telegramMessageBuffer);
 */

import type { Context, NextFunction } from "grammy";

const BURST_WINDOW_MS = 1_000;
const BURST_THRESHOLD = 5;

interface ChatState {
  /** Recent message timestamps within the window */
  timestamps: number[];
  /** Pending handlers waiting to run */
  queue: Array<() => Promise<void>>;
  /** Whether a drain is in progress */
  draining: boolean;
}

const chatStates = new Map<string, ChatState>();

function getState(chatId: string): ChatState {
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, { timestamps: [], queue: [], draining: false });
  }
  return chatStates.get(chatId)!;
}

async function drain(state: ChatState): Promise<void> {
  if (state.draining) return;
  state.draining = true;
  while (state.queue.length > 0) {
    const handler = state.queue.shift()!;
    try {
      await handler();
    } catch {
      // errors handled by individual handlers
    }
  }
  state.draining = false;
}

export async function telegramMessageBuffer(ctx: Context, next: NextFunction): Promise<void> {
  const chatId = ctx.chat?.id?.toString();

  // Skip buffering for commands, callbacks, and non-chat contexts
  if (!chatId || ctx.message?.text?.startsWith("/") || ctx.callbackQuery) {
    return next();
  }

  const state = getState(chatId);
  const now = Date.now();

  // Evict timestamps outside the burst window
  state.timestamps = state.timestamps.filter((t) => now - t < BURST_WINDOW_MS);
  state.timestamps.push(now);

  // Under threshold — run immediately
  if (state.timestamps.length <= BURST_THRESHOLD && state.queue.length === 0) {
    return next();
  }

  // Over threshold — enqueue
  return new Promise<void>((resolve, reject) => {
    state.queue.push(async () => {
      try {
        await next();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    drain(state).catch(() => {});
  });
}
