/**
 * Background Task Manager - バックグラウンドタスクの一元管理
 *
 * fire-and-forget だったタスクを一元管理し、
 * リトライ・成功率追跡・失敗通知を提供する。
 */

import { recordBgTaskMetrics } from './metrics';

export interface BgTaskOptions {
  /** タスク名（メトリクス・ログ用） */
  name: string;
  /** 最大リトライ回数（デフォルト: 2） */
  maxRetries?: number;
  /** リトライ間隔の基本ms（exponential backoff、デフォルト: 1000） */
  retryBaseMs?: number;
}

interface TaskResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
  retries: number;
}

// 直近のタスク結果を保持（最大100件）
const recentResults: TaskResult[] = [];
const MAX_RESULTS = 100;

/**
 * バックグラウンドタスクを実行（リトライ付き）
 * fire-and-forget で呼ぶが、結果はメトリクスに記録される
 */
export function runBgTask(
  fn: () => Promise<void>,
  options: BgTaskOptions
): void {
  const { name, maxRetries = 2, retryBaseMs = 1000 } = options;

  const execute = async (attempt: number): Promise<void> => {
    const startTime = Date.now();
    try {
      await fn();
      const duration = Date.now() - startTime;

      const result: TaskResult = {
        name,
        success: true,
        durationMs: duration,
        retries: attempt,
      };
      pushResult(result);
      recordBgTaskMetrics(name, true, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (attempt < maxRetries) {
        const delay = retryBaseMs * Math.pow(2, attempt);
        console.warn(`[BgTask:${name}] Failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${errorMsg}`);
        setTimeout(() => execute(attempt + 1), delay);
        return;
      }

      // 最終失敗
      console.error(`[BgTask:${name}] Failed after ${attempt + 1} attempts: ${errorMsg}`);
      const result: TaskResult = {
        name,
        success: false,
        durationMs: duration,
        error: errorMsg,
        retries: attempt,
      };
      pushResult(result);
      recordBgTaskMetrics(name, false, duration, errorMsg);
    }
  };

  // 非同期で開始（呼び出し元をブロックしない）
  execute(0).catch(err =>
    console.error(`[BgTask:${name}] Unhandled error:`, err)
  );
}

function pushResult(result: TaskResult): void {
  recentResults.push(result);
  if (recentResults.length > MAX_RESULTS) {
    recentResults.shift();
  }
}

/**
 * 直近のタスク結果サマリー
 */
export function getBgTaskSummary(): {
  total: number;
  successes: number;
  failures: number;
  recentFailures: TaskResult[];
} {
  const total = recentResults.length;
  const successes = recentResults.filter(r => r.success).length;
  const failures = total - successes;
  const recentFailures = recentResults
    .filter(r => !r.success)
    .slice(-5); // 直近5件の失敗

  return { total, successes, failures, recentFailures };
}
