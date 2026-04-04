/**
 * retry.ts — Exponential backoff retry utility
 *
 * Usage:
 *   const result = await withRetry(() => gatewayQuery(sql, params));
 */

import { logger } from "./logger";

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1_000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn("retry", `Attempt ${attempt + 1} failed, retrying in ${delayMs}ms`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
