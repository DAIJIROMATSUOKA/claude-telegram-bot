/**
 * Memory GC - 記憶の自動整理（ガベージコレクション）
 *
 * 記憶が増えすぎるとプロンプト肥大化・応答速度低下・ノイズ増加を招く。
 * 定期的に以下を実行:
 *
 * 1. learned_memory:
 *    - 90日超え + confidence < 0.8 → 無効化
 *    - 同一カテゴリで内容が類似する記憶を統合
 *    - active記憶が50件超えたら低信頼度から無効化
 *
 * 2. session_summaries:
 *    - 30日超え → 削除
 *    - 7日超え + 3件以上 → 古いものを削除して最新3件のみ残す
 *
 * 3. chat_history:
 *    - 30日超え → 削除（既存のcleanupOldHistoryで対応済み）
 *
 * 実行タイミング: Bot起動時 + 24時間毎
 */

import { callMemoryGateway } from '../handlers/ai-router';

const MAX_LEARNED_MEMORIES = 50;
const LEARNED_MEMORY_EXPIRE_DAYS = 90;
const LEARNED_MEMORY_MIN_CONFIDENCE = 0.8;
const SESSION_SUMMARY_EXPIRE_DAYS = 30;
const SESSION_SUMMARY_KEEP_RECENT = 5;

/**
 * learned_memoryのGC
 *
 * 1. 古い + 低信頼度 → 無効化
 * 2. 件数上限超過 → 低信頼度から無効化
 */
async function gcLearnedMemory(): Promise<{ deactivated: number; message: string }> {
  let deactivated = 0;

  try {
    // 1. 90日超え + confidence < 0.8 を無効化
    const expireResult = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `UPDATE jarvis_learned_memory
            SET active = 0
            WHERE active = 1
              AND created_at < datetime('now', '-${LEARNED_MEMORY_EXPIRE_DAYS} days')
              AND confidence < ?`,
      params: [LEARNED_MEMORY_MIN_CONFIDENCE],
    });

    const expiredCount = expireResult.data?.meta?.changes || 0;
    deactivated += expiredCount;
    if (expiredCount > 0) {
      console.log(`[Memory GC] learned_memory: ${expiredCount}件を期限切れで無効化`);
    }

    // 2. active件数チェック → 上限超過なら低信頼度から無効化
    const countResult = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT COUNT(*) as cnt FROM jarvis_learned_memory WHERE active = 1`,
      params: [],
    });

    const activeCount = countResult.data?.results?.[0]?.cnt || 0;

    if (activeCount > MAX_LEARNED_MEMORIES) {
      const excess = activeCount - MAX_LEARNED_MEMORIES;

      // 低信頼度 + 古い順にIDを取得して無効化
      const toDeactivate = await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `SELECT id FROM jarvis_learned_memory
              WHERE active = 1
              ORDER BY confidence ASC, created_at ASC
              LIMIT ?`,
        params: [excess],
      });

      const ids = toDeactivate.data?.results?.map((r: { id: string }) => r.id) || [];

      for (const id of ids) {
        await callMemoryGateway('/v1/db/query', 'POST', {
          sql: `UPDATE jarvis_learned_memory SET active = 0 WHERE id = ?`,
          params: [id],
        });
      }

      deactivated += ids.length;
      if (ids.length > 0) {
        console.log(`[Memory GC] learned_memory: ${ids.length}件を上限超過で無効化（残り${MAX_LEARNED_MEMORIES}件）`);
      }
    }

    // 3. 完全に無効化されたもので180日以上経過 → 物理削除
    const purgeResult = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_learned_memory
            WHERE active = 0
              AND created_at < datetime('now', '-180 days')`,
      params: [],
    });

    const purgedCount = purgeResult.data?.meta?.changes || 0;
    if (purgedCount > 0) {
      console.log(`[Memory GC] learned_memory: ${purgedCount}件を物理削除（180日超え非アクティブ）`);
    }

    return {
      deactivated,
      message: `learned_memory: ${deactivated}件無効化, ${purgedCount}件削除, 残り${activeCount - deactivated}件`,
    };
  } catch (error) {
    console.error('[Memory GC] learned_memory GC error:', error);
    return { deactivated: 0, message: `learned_memory GC error: ${error}` };
  }
}

/**
 * session_summariesのGC
 *
 * 1. 30日超え → 削除
 * 2. 残りが多すぎたら最新N件のみ残す
 */
async function gcSessionSummaries(): Promise<{ deleted: number; message: string }> {
  let deleted = 0;

  try {
    // 1. 30日超え → 削除
    const expireResult = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_session_summaries
            WHERE created_at < datetime('now', '-${SESSION_SUMMARY_EXPIRE_DAYS} days')`,
      params: [],
    });

    const expiredCount = expireResult.data?.meta?.changes || 0;
    deleted += expiredCount;
    if (expiredCount > 0) {
      console.log(`[Memory GC] session_summaries: ${expiredCount}件を30日超えで削除`);
    }

    // 2. ユーザー毎に最新N件のみ残す
    // まずユーザーIDを取得
    const usersResult = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT DISTINCT user_id FROM jarvis_session_summaries`,
      params: [],
    });

    const userIds = usersResult.data?.results?.map((r: { user_id: string }) => r.user_id) || [];

    for (const userId of userIds) {
      // 最新N件以外を削除
      const trimResult = await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `DELETE FROM jarvis_session_summaries
              WHERE user_id = ?
                AND id NOT IN (
                  SELECT id FROM jarvis_session_summaries
                  WHERE user_id = ?
                  ORDER BY created_at DESC
                  LIMIT ?
                )`,
        params: [userId, userId, SESSION_SUMMARY_KEEP_RECENT],
      });

      const trimmedCount = trimResult.data?.meta?.changes || 0;
      deleted += trimmedCount;
      if (trimmedCount > 0) {
        console.log(`[Memory GC] session_summaries: user=${userId} ${trimmedCount}件を上限超過で削除`);
      }
    }

    return {
      deleted,
      message: `session_summaries: ${deleted}件削除`,
    };
  } catch (error) {
    console.error('[Memory GC] session_summaries GC error:', error);
    return { deleted: 0, message: `session_summaries GC error: ${error}` };
  }
}

/**
 * Memory GC メインエントリーポイント
 *
 * Bot起動時 + 24時間毎に実行
 */
export async function runMemoryGC(): Promise<string> {
  console.log('[Memory GC] 🗑️ Starting memory garbage collection...');
  const startTime = Date.now();

  const [learnedResult, summaryResult] = await Promise.all([
    gcLearnedMemory(),
    gcSessionSummaries(),
  ]);

  const duration = Date.now() - startTime;
  const report = `[Memory GC] 完了 (${duration}ms)\n  ${learnedResult.message}\n  ${summaryResult.message}`;
  console.log(report);

  return report;
}

// 24時間タイマー用
let gcTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Memory GCの定期実行を開始
 *
 * Bot起動時に呼ぶ。即時実行 + 24時間毎に再実行。
 */
export function startMemoryGCScheduler(): void {
  if (gcTimer) {
    console.log('[Memory GC] Scheduler already running');
    return;
  }

  // 起動時に即実行（非同期、ブロックしない）
  runMemoryGC().catch(err => console.error('[Memory GC] Initial run error:', err));

  // 24時間毎に実行
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  gcTimer = setInterval(() => {
    runMemoryGC().catch(err => console.error('[Memory GC] Scheduled run error:', err));
  }, TWENTY_FOUR_HOURS);

  console.log('[Memory GC] Scheduler started (interval: 24h)');
}
