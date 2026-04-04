/**
 * rate-limiter.ts — Token bucket rate limiter (no external deps)
 *
 * Usage:
 *   await telegramRateLimiter.acquire("sendMessage");
 *   await gatewayRateLimiter.acquire("query");
 */

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface BucketConfig {
  /** Max tokens (= max burst) */
  capacity: number;
  /** Tokens added per window */
  rate: number;
  /** Refill window in ms */
  windowMs: number;
}

class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private configs: Record<string, BucketConfig>;
  private defaultConfig: BucketConfig;

  constructor(configs: Record<string, BucketConfig>, defaultConfig: BucketConfig) {
    this.configs = configs;
    this.defaultConfig = defaultConfig;
  }

  async acquire(key: string): Promise<void> {
    const cfg = this.configs[key] ?? this.defaultConfig;
    const now = Date.now();

    if (!this.buckets.has(key)) {
      this.buckets.set(key, { tokens: cfg.capacity, lastRefillMs: now });
    }

    const bucket = this.buckets.get(key)!;

    // Refill proportional to elapsed time
    const elapsed = now - bucket.lastRefillMs;
    const refill = (elapsed / cfg.windowMs) * cfg.rate;
    if (refill > 0) {
      bucket.tokens = Math.min(cfg.capacity, bucket.tokens + refill);
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Delay until next token is available
    const waitMs = Math.ceil((1 - bucket.tokens) * (cfg.windowMs / cfg.rate));
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    bucket.tokens = 0;
    bucket.lastRefillMs = Date.now();
  }
}

/** Telegram API: 30 req/min per bucket key */
export const telegramRateLimiter = new TokenBucketLimiter(
  {},
  { capacity: 30, rate: 30, windowMs: 60_000 }
);

/** Memory Gateway API: 10 req/min */
export const gatewayRateLimiter = new TokenBucketLimiter(
  {},
  { capacity: 10, rate: 10, windowMs: 60_000 }
);
