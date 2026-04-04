/**
 * Typing indicator helper — fire-and-forget.
 */

/**
 * Send a one-shot "typing" chat action. Silently ignores errors.
 */
export function sendTyping(ctx: any): void {
  ctx.replyWithChatAction("typing").catch(() => {});
}
