/**
 * Text message handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { session } from "../session";
import { ALLOWED_USERS } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import { auditLog, auditLogRateLimit, checkInterrupt, startTypingIndicator } from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";
import { controlTowerDB } from "../utils/control-tower-db";
import { redactSensitiveData } from "../utils/redaction-filter";
import { routeDarwinCommand } from "./darwin-commands";
import { checkPhaseCompletionApproval } from "../utils/phase-detector";
import { saveChatMessage, cleanupOldHistory } from "../utils/chat-history";
import { autoUpdateContext, getJarvisContext, autoDetectAndUpdateWorkMode } from "../utils/jarvis-context";
import { buildCroppyPrompt } from "../utils/croppy-context";
import { detectInterruptableTask } from "../utils/implementation-detector";
import { saveInterruptSnapshot, type SnapshotData } from "../utils/auto-resume";
import { isFocusModeEnabled, bufferNotification } from "../utils/focus-mode";
import { preloadToolContext, formatPreloadedContext } from "../utils/tool-preloader";
import { WORKING_DIR } from "../config";

// Smart Router: 同じモードで連続提案しないようキャッシュ（1時間TTL）
const _routerSuggestedCache = new Set<string>();

/**
 * Handle incoming text messages.
 */
export async function handleText(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  let message = ctx.message?.text;

  if (!userId || !message || !chatId) {
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  // 2. Check for darwin commands
  const _lm = message.trim().toLowerCase();
  if (_lm === 'darwin' || _lm.startsWith('darwin ')) {
    const args = message.trim().split(/\s+/).slice(1); // Remove 'darwin' prefix
    await routeDarwinCommand(ctx, args);
    return;
  }

  // 2.5. Check for croppy: debug command
  if (message.trim().toLowerCase() === 'croppy: debug') {
    const { formatCroppyDebugOutput } = await import("../utils/croppy-context");
    const debugOutput = await formatCroppyDebugOutput(userId);
    await ctx.reply(debugOutput, { parse_mode: 'HTML' });
    return;
  }

  // 3. Check for interrupt prefix
  message = await checkInterrupt(message);
  if (!message.trim()) {
    return;
  }

  // 4. Rate limit check
  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(`⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`);
    return;
  }

  // 5. Mark processing started
  const stopProcessing = session.startProcessing();

  // 6. Start typing indicator
  const typing = startTypingIndicator(ctx);

  // 7. Create streaming state and callback
  const state = new StreamingState();
  const statusCallback = createStatusCallback(ctx, state);

  // 8. Start action trace
  const sessionId = `telegram_${chatId}_${Date.now()}`;
  const startedAt = Date.now();
  const actionName = message.slice(0, 50);
  const inputsRedacted = redactSensitiveData(message).sanitized;

  const traceId = controlTowerDB.startActionTrace({
    session_id: sessionId,
    action_type: 'text_message',
    action_name: actionName,
    inputs_redacted: inputsRedacted,
    metadata: { username, userId: String(userId) },
  });

  try {
    // 9. Save user message to chat history
    await saveChatMessage(userId, 'user', message);

    // 10. Cleanup old history (30+ days) periodically
    // Run cleanup with 1% probability to avoid overhead
    if (Math.random() < 0.01) {
      cleanupOldHistory().catch(err => console.error('Cleanup error:', err));
    }

    // 10.5. Smart AI Router - Auto-detect work mode and update DB
    await autoDetectAndUpdateWorkMode(userId, message);
    const jarvisContext = await getJarvisContext(userId);

    // 10.6. Tool Pre-Loading - Detect file refs, git context, errors from message
    let preloadedContext = '';
    const preloaded = preloadToolContext(message);
    preloadedContext = formatPreloadedContext(preloaded);
    if (preloadedContext) {
      console.log(`[Tool Preloader] Loaded ${preloaded.length} context(s): ${preloaded.map(p => p.type).join(', ')}`);
    }

    // 11. Check for croppy: prefix and inject context
    if (message.trim().toLowerCase().startsWith('croppy:')) {
      console.log('[Text Handler] croppy: detected, injecting context...');
      const originalPrompt = message.slice(7).trim(); // Remove "croppy:" prefix
      message = 'croppy: ' + await buildCroppyPrompt(originalPrompt, userId);
      console.log('[Text Handler] Context injected, new message length:', message.length);
    }

    // 11.5. Inject preloaded tool context if available
    if (preloadedContext && !message.includes('croppy:')) {
      message = message + '\n' + preloadedContext;
    }

    // 12. Send to Claude with streaming
    const response = await session.sendMessageStreaming(
      message,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );

    // 12. Save assistant response to chat history
    await saveChatMessage(userId, 'assistant', response);

    // 12.5. Smart Router - suggest council for strategic questions
    var _councilKeywords = /設計|design|アーキテクチャ|architecture|戦略|strategy|提案|proposal|方針|council/i;
    if (_councilKeywords.test(message) && !_lm.startsWith('council') && !_lm.startsWith('croppy:')) {
      var _ck = String(userId) + '_council';
      if (!_routerSuggestedCache.has(_ck)) {
        _routerSuggestedCache.add(_ck);
        try {
          await ctx.reply('💡 戦略的な相談は council: で聞いてみて');
          console.log('[Smart Router] council suggestion sent');
        } catch (e) {
          console.error('[Smart Router] send failed:', e);
        }
        setTimeout(function() { _routerSuggestedCache.delete(_ck); }, 3600000);
      }
    }

    // 13. Auto-update jarvis_context (task, phase, assumptions, decisions)
    await autoUpdateContext(userId, response);

    // 14. Auto-Resume Detection: Check if this is an interruptable task
    const detectionResult = detectInterruptableTask(response, 'bot');
    if (detectionResult.detected && detectionResult.confidence >= 0.85) {
      console.log('[Auto-Resume] 🎯 Interruptable task detected:', {
        task: detectionResult.taskDescription,
        phase: detectionResult.phase,
        priority: detectionResult.priority,
        confidence: detectionResult.confidence,
      });

      // Get current context for snapshot
      const jarvisContext = await getJarvisContext(userId);
      const workMode = jarvisContext?.work_mode || 'coding';
      const currentTask = jarvisContext?.current_task || detectionResult.taskDescription;
      const currentPhase = jarvisContext?.current_phase || detectionResult.phase;

      // Build snapshot data
      const snapshotData: SnapshotData = {
        task_description: detectionResult.taskDescription || currentTask || '不明なタスク',
        next_action: `${detectionResult.phase || 'Phase不明'}の実装を続行`,
        context_summary: response.substring(0, 500), // First 500 chars as summary
        priority: detectionResult.priority,
        auto_resume_eligible: true,
      };

      // Save snapshot to database
      await saveInterruptSnapshot(
        String(userId),
        sessionId,
        workMode,
        currentTask,
        currentPhase,
        snapshotData
      );
    }

    // 14. Complete action trace (success)
    const completedAt = Math.floor(Date.now() / 1000);
    const durationMs = Date.now() - startedAt;
    const outputsSummary = response.slice(0, 200);

    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: completedAt,
      duration_ms: durationMs,
      outputs_summary: outputsSummary,
    });

    // 15. Check for phase completion and croppy approval
    // (Skip in focus mode - will be buffered)
    const inFocusMode = await isFocusModeEnabled(userId);
    if (!inFocusMode) {
      await checkPhaseCompletionApproval(ctx, response);
    } else {
      // Buffer phase completion notifications
      if (response.toLowerCase().includes('phase') && response.toLowerCase().includes('完了')) {
        await bufferNotification(userId, 'info', 'Phase完了検出（要承認確認）');
      }
    }

    // 16. Audit log
    await auditLog(userId, username, "TEXT", message, response);
  } catch (error) {
    console.error("Error processing message:", error);

    // Complete action trace (failed)
    const completedAt = Math.floor(Date.now() / 1000);
    const durationMs = Date.now() - startedAt;
    const errorSummary = String(error).slice(0, 200);

    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'failed',
      completed_at: completedAt,
      duration_ms: durationMs,
      error_summary: errorSummary,
    });

    // Clean up any partial messages
    for (const toolMsg of state.toolMessages) {
      try {
        await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
      } catch (error) {
        console.debug("Failed to delete tool message:", error);
      }
    }

    // Check if it was a cancellation
    if (String(error).includes("abort") || String(error).includes("cancel")) {
      await ctx.reply("🛑 Query stopped.");
    } else {
      await ctx.reply(`❌ Error: ${String(error).slice(0, 200)}`);
    }
  } finally {
    stopProcessing();
    typing.stop();
  }
}
