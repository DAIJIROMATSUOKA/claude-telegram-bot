/**
 * Circuit Breaker - 外部サービス障害時にfail-fast & 段階的フォールバック
 *
 * States:
 *   CLOSED  → 正常。リクエストを通す
 *   OPEN    → 障害検出。即座にfail（タイムアウト待ちを回避）
 *   HALF_OPEN → 回復試行中。1リクエストだけ通して様子見
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** 何回連続失敗でOPENにするか */
  failureThreshold: number;
  /** OPEN後、何ms経ったらHALF_OPENに移行するか */
  resetTimeoutMs: number;
  /** サービス名（ログ用） */
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private totalCalls = 0;
  private totalFailures = 0;

  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
  }

  /**
   * Circuit Breaker経由で関数を実行。
   * OPEN状態なら即座にfallbackを返す。
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    this.totalCalls++;

    // OPEN → 時間経過でHALF_OPENに移行チェック
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        console.log(`[CircuitBreaker:${this.name}] OPEN → HALF_OPEN (${Math.round(elapsed / 1000)}s経過)`);
      } else {
        // まだOPEN → 即fallback
        return fallback;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      console.warn(`[CircuitBreaker:${this.name}] Call failed (${this.failureCount}/${this.failureThreshold}): ${error}`);
      return fallback;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log(`[CircuitBreaker:${this.name}] HALF_OPEN → CLOSED (回復)`);
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(`[CircuitBreaker:${this.name}] → OPEN (${this.failureCount}回連続失敗, ${Math.round(this.resetTimeoutMs / 1000)}s後にリトライ)`);
    }
  }

  /** 現在の状態を取得 */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    totalCalls: number;
    totalFailures: number;
    successRate: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      successRate: this.totalCalls > 0
        ? Math.round((1 - this.totalFailures / this.totalCalls) * 100)
        : 100,
    };
  }

  /** 手動リセット */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    console.log(`[CircuitBreaker:${this.name}] Manual reset → CLOSED`);
  }
}

// ============================================================================
// Pre-configured instances for each external service
// ============================================================================

/** Memory Gateway API用 — 3回連続失敗で30秒OPENにする */
export const memoryGatewayBreaker = new CircuitBreaker({
  name: 'MemoryGateway',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
});

/** Gemini API用 — 3回連続失敗で60秒OPENにする */
export const geminiBreaker = new CircuitBreaker({
  name: 'Gemini',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});
