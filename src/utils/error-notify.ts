/**
 * Unified error notification utility.
 * Format: ❌ [module] message\n🕐 ISO timestamp
 */

/**
 * Send a formatted error message to the user via Telegram.
 *
 * @param ctx - grammY Context (or any object with a reply method)
 * @param module - Source module name (e.g. "text", "ai-router")
 * @param error - The caught error
 */
export async function notifyError(ctx: any, module: string, error: Error | unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const timestamp = new Date().toISOString();
  try {
    await ctx.reply(`❌ [${module}] ${message}\n🕐 ${timestamp}`);
  } catch {
    // Ignore reply failures (e.g. ctx is no longer valid)
  }
}
