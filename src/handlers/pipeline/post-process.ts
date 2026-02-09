/**
 * Post-Process Stage - Claude応答後のバックグラウンド処理
 *
 * Auto-Review, Learned Memory, Session Summary, Auto-Resume を
 * BgTaskManager経由で実行する。
 */

import type { Context } from "grammy";
import { autoReviewWithGemini } from "../../utils/auto-review";
import { processAndLearn } from "../../utils/learned-memory";
import { saveSessionSummary } from "../../utils/session-summary";
import { getChatHistory } from "../../utils/chat-history";
import { autoUpdateContext } from "../../utils/jarvis-context";
import { detectInterruptableTask } from "../../utils/implementation-detector";
import { saveInterruptSnapshot, type SnapshotData } from "../../utils/auto-resume";
import { getJarvisContext } from "../../utils/jarvis-context";
import { runBgTask } from "../../utils/bg-task-manager";

// Session Summary: メッセージカウンター（20メッセージ毎に要約保存）
let _sessionMsgCount = 0;

export function getSessionMsgCount(): number {
  return _sessionMsgCount;
}

export interface PostProcessOptions {
  ctx: Context;
  userId: number;
  sessionId: string;
  message: string;
  response: string;
  replyToMessageId?: number;
}

/**
 * Claude応答後の全バックグラウンド処理を実行
 */
export async function runPostProcess(opts: PostProcessOptions): Promise<void> {
  const { ctx, userId, sessionId, message, response, replyToMessageId } = opts;

  // 1. Auto Review（BgTaskManager経由）
  runBgTask(async () => {
    const review = await autoReviewWithGemini(response);
    if (review) {
      await ctx.reply(`━━━━━━━━━━━━━━━\n${review}\n━━━━━━━━━━━━━━━`, {
        ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
      });
    }
  }, { name: 'auto-review', maxRetries: 1 });

  // 2. Auto-update jarvis_context
  await autoUpdateContext(userId, response);

  // 3. Learned Memory（BgTaskManager経由）
  runBgTask(
    () => processAndLearn(userId, message, response),
    { name: 'learned-memory', maxRetries: 2 }
  );

  // 4. Session Summary（20メッセージ毎）
  _sessionMsgCount++;
  if (_sessionMsgCount % 20 === 0) {
    runBgTask(async () => {
      const history = await getChatHistory(userId, 50);
      if (history.length >= 10) {
        await saveSessionSummary(userId, sessionId, history);
      }
    }, { name: 'session-summary', maxRetries: 2 });
  }

  // 5. Auto-Resume Detection
  const detectionResult = detectInterruptableTask(response, 'bot');
  if (detectionResult.detected && detectionResult.confidence >= 0.85) {
    console.log('[Auto-Resume] Interruptable task detected:', {
      task: detectionResult.taskDescription,
      phase: detectionResult.phase,
      priority: detectionResult.priority,
      confidence: detectionResult.confidence,
    });

    const jarvisCtx = await getJarvisContext(userId);
    const workMode = jarvisCtx?.work_mode || 'coding';
    const currentTask = jarvisCtx?.current_task || detectionResult.taskDescription;
    const currentPhase = jarvisCtx?.current_phase || detectionResult.phase;

    const snapshotData: SnapshotData = {
      task_description: detectionResult.taskDescription || currentTask || '不明なタスク',
      next_action: `${detectionResult.phase || 'Phase不明'}の実装を続行`,
      context_summary: response.substring(0, 500),
      priority: detectionResult.priority,
      auto_resume_eligible: true,
    };

    await saveInterruptSnapshot(
      String(userId),
      sessionId,
      workMode,
      currentTask,
      currentPhase,
      snapshotData
    );
  }
}
