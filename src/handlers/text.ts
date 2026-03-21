import { handleImsgSend } from "./imsg-send";
import { handleMailSend } from "./mail-send";
import { handleLinePost } from "./line-post";
import { handleDeadlineInput } from "./deadline-input";
/**
 * Text message handler for Claude Telegram Bot.
 *
 * Pipeline:
 *   1. Auth & Rate Limit
 *   2. Routing (Croppy debug, AI Session Bridge)
 *   3. Enrichment (X summary, Web search, Croppy, Tool preload)
 *   4. Claude Session (streaming)
 *   5. Post-Process (auto-review, learned memory, session summary, auto-resume)
 */

import type { Context } from "grammy";
import { session } from "../session";
import { ALLOWED_USERS } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import { auditLog, auditLogRateLimit, checkInterrupt, startTypingIndicator } from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";
import { controlTowerDB } from "../utils/control-tower-db";
import { redactSensitiveData } from "../utils/redaction-filter";
import { checkPhaseCompletionApproval } from "../utils/phase-detector";
import { saveChatMessage, cleanupOldHistory } from "../utils/chat-history";
import { autoDetectAndUpdateWorkMode } from "../utils/jarvis-context";
import {
  hasActiveSession,
  sendToSession,
  splitTelegramMessage,
} from "../utils/session-bridge";
import { isFocusModeEnabled, bufferNotification } from "../utils/focus-mode";
import { maybeEnrichWithWebSearch } from "../utils/web-search";
import { maybeEnrichWithXSummary } from "../utils/x-summary";
import { recordMessageMetrics } from "../utils/metrics";
import { enrichMessage } from "./pipeline/enrichment";
import { runPostProcess } from "./pipeline/post-process";
import { setClaudeStatus } from "../utils/tower-renderer";
import { updateTower } from "../utils/tower-manager";
import type { TowerIdentifier } from "../types/control-tower";
import { savePendingTask, clearPendingTask } from "../utils/pending-task";
import { handleInboxReply } from "./inbox";

import { dispatchToWorker, handleBridgeReply } from "./croppy-bridge";
import { handleChatReply } from "./claude-chat";
import { routeToProjectNotes } from "../services/obsidian-writer";
import { getChromeOrchestrator } from "./orchestrator-chrome";
import { handleDomainRelay } from "./domain-router";

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

  // ── Reply context: リプライ元メッセージをClaudeに渡す ──
  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg) {
    const replyText = "text" in replyMsg ? replyMsg.text : undefined;
    const replyCaption = "caption" in replyMsg ? replyMsg.caption : undefined;
    const replyContent = replyText || replyCaption;
    if (replyContent) {
      const replyFrom = replyMsg.from?.first_name || replyMsg.from?.username || "unknown";
      message = `[返信元メッセージ（${replyFrom}）]\n${replyContent}\n[/返信元]\n\n${message}`;
    }
  }

  // ── Auto-delete bot message on reply ──
  if (replyMsg?.from?.is_bot) {
    try { await ctx.api.deleteMessage(chatId, replyMsg.message_id); } catch {}
  }

  // ── Stage 1: Auth & Rate Limit ──
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }


    // === Deadline input: M1300の納期3/31 ===
    if (await handleDeadlineInput(ctx)) return;

    // === Project routing: detect M-numbers in DJ messages ===
    try {
      await routeToProjectNotes(message, "telegram");
    } catch (e) {
      // Non-fatal: never break message flow
    }

    // === Inbox Zero: quote-replies to inbox sources (MUST run BEFORE domain routing) ===
    if (ctx.message?.reply_to_message) {
      try {
        const handled = await handleInboxReply(ctx);
        if (handled) {
          return;  // No stopProcessing needed - session not started yet
        }
      } catch (e) {
        console.error("[Text] Inbox reply error:", e);
      }
    }

    // === F5: Domain routing (chat-routing.yaml) → specialized chats (PRIORITY over Orchestrator) ===
    let orchestratorHandled = false;
    if (!message.startsWith("/") && !message.startsWith("。") && !message.startsWith("、")) try {
      // Domain routing first: check chat-routing.yaml keywords
      if (await handleDomainRelay(ctx, message)) {
        orchestratorHandled = true;
      } else {
      // Orchestrator fallback: M-number → project tabs
      const orch = getChromeOrchestrator();
      if (orch && !orchestratorHandled) {
        const routeResult = orch.quickRoute(message, "telegram");
        console.log(`[Text] Orchestrator quickRoute: method=${routeResult.method} project=${routeResult.projectId} conf=${routeResult.confidence}`);
        if (routeResult.projectId && routeResult.confidence >= 0.8) {
          // Code-layer match: route to project tab (blocking — G1 応答リレー)
          const result = await orch.route({
            text: message,
            source: "telegram",
            autoPost: true,
            ctx, // G1: pass ctx for Telegram reply
          });
          console.log(`[Text] Orchestrator route result: forwarded=${result.forwarded} tabWT=${result.tabWT} error=${result.error}`);
          if (result.forwarded) {
            orchestratorHandled = true;
          }
        } else if (routeResult.method === "no-route") {
            // No domain match, no M-number: route to INBOX specialist chat
            console.log("[Text] No route match → relaying to INBOX domain");
            try {
              // 1. Show status + delete original message
              const statusMsg = await ctx.reply("📥 INBOX に転送中...");
              try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}

              const { execSync } = await import("child_process");
              const escaped = message.replace(/'/g, "'\''");
              const inboxOut = execSync(
                `bash ${process.env.HOME}/claude-telegram-bot/scripts/domain-relay.sh --domain inbox '${escaped}'`,
                { timeout: 120000, encoding: "utf-8" }
              );
              const inboxResponse = inboxOut.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();
              if (inboxResponse) {
                // 2. Parse [ROUTE:domain] tag
                const routeTag = inboxResponse.match(/\[ROUTE:(\w+)\]/)?.[1];
                const cleanResponse = inboxResponse.replace(/\[ROUTE:\w+\]/, "").trim();

                if (routeTag && routeTag !== "none") {
                  // 3. Auto-forward to target domain
                  console.log(`[Text] INBOX routed to ${routeTag}, forwarding...`);
                  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📥 → ${routeTag} に転送中...`);
                  try {
                    const fwdEscaped = message.replace(/'/g, "'\\''");
                    const fwdOut = execSync(
                      `bash ${process.env.HOME}/claude-telegram-bot/scripts/domain-relay.sh --domain "${routeTag}" '${fwdEscaped}'`,
                      { timeout: 120000, encoding: "utf-8" }
                    );
                    const fwdResponse = fwdOut.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();
                    if (fwdResponse) {
                      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${routeTag}\n\n${fwdResponse}`);
                      console.log(`[Text] ${routeTag} replied ${fwdResponse.length} chars`);
                    } else {
                      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${routeTag}\n\n${cleanResponse}`);
                      console.log(`[Text] ${routeTag} no response, showing INBOX answer`);
                    }
                  } catch (fwdErr: any) {
                    // Forward failed, show INBOX response as fallback
                    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📥 INBOX (${routeTag}転送失敗)\n\n${cleanResponse}`);
                    console.error(`[Text] Forward to ${routeTag} failed:`, fwdErr?.message?.substring(0, 100));
                  }
                } else {
                  // No route / ROUTE:none -> show INBOX response directly
                  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📥 INBOX\n\n${cleanResponse}`);
                  console.log(`[Text] INBOX replied ${cleanResponse.length} chars (no route)`);
                }
              } else {
                await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "📥 INBOX — 応答なし");
                console.log("[Text] INBOX relay done but no response");
              }
              orchestratorHandled = true;
            } catch (inboxErr: any) {
              console.error("[Text] INBOX relay failed:", inboxErr?.message?.substring(0, 100));
              // Fall through to Worker Tab as last resort
            }
          }
        }
      }
    } catch (e: any) {
      // Non-fatal: orchestrator failure falls through to Bridge
      console.error("[Orch] Route EXCEPTION (falling through to Bridge):", e?.message || e, e?.stack?.substring(0, 300));
    }

  // ── Chat Reply Routing: TelegramリプライをClaude.aiチャットにルーティング
  // Skip if orchestrator already handled (prevents double-routing on reply to M-number messages)
  if (!orchestratorHandled) {
    if (await handleChatReply(ctx)) return;
    if (await handleBridgeReply(ctx)) return;
  }

  // ── Memo mode: 。で始まるメッセージはJarvisスルー、🗑ボタンのみ ──
  if (ctx.message?.text?.startsWith('。')) {
    const memoText = ctx.message.text.substring(1).trim();
    // Delete user's original message
    try { await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {}
    // Append to Obsidian daily note
    if (memoText) {
      try {
        const { appendMemo } = await import("../services/obsidian-writer");
        appendMemo(memoText);
      } catch (e) { console.error('[Memo] Obsidian write failed:', e); }
    }
    // Brief confirmation, then auto-delete
    const memoConfirm = await ctx.api.sendMessage(chatId, '📝 ✓');
    setTimeout(() => { ctx.api.deleteMessage(chatId, memoConfirm.message_id).catch(() => {}); }, 2000);
    return;
  }

  // ── Task mode: 、で始まるメッセージはObsidianタスクに追加 ──
  if (ctx.message?.text?.startsWith('、')) {
    const taskText = ctx.message.text.substring(1).trim();
    try { await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch {}
    if (taskText) {
      try {
        const { appendTask } = await import('../services/obsidian-writer');
        appendTask(taskText);
      } catch (e) { console.error('[Task] Obsidian write failed:', e); }
    }
    // Brief confirmation, then auto-delete
    const taskConfirm = await ctx.api.sendMessage(chatId, '☑️ ✓');
    setTimeout(() => { ctx.api.deleteMessage(chatId, taskConfirm.message_id).catch(() => {}); }, 2000);
    return;
  }

  // ── Stage 2: Routing ──
  if (message.trim().toLowerCase() === 'croppy: debug') {
    const { formatCroppyDebugOutput } = await import("../utils/croppy-context");
    const debugOutput = await formatCroppyDebugOutput(userId);
    await ctx.reply(debugOutput, { parse_mode: 'HTML' });
    return;
  }

  message = await checkInterrupt(message);
  if (!message.trim()) {
    return;
  }

  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(`⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`);
    return;
  }

  const stopProcessing = session.startProcessing();

  // LINE schedule command (must check before /line)
  if (message.startsWith("/line_schedule") || message.startsWith("/lineschedule")) {
    stopProcessing();
    const { handleLineSchedule } = await import("./line-schedule");
    await handleLineSchedule(ctx);
    return;
  }

  // LINE group post command
  if (message.startsWith("/line")) {
    stopProcessing();
    await handleLinePost(ctx);
    return;
  }

  if (message.startsWith("/mail")) {
    stopProcessing();
    await handleMailSend(ctx);
    return;
  }

  if (message.startsWith("/imsg")) {
    stopProcessing();
    await handleImsgSend(ctx);
    return;
  }

  // AI Session Bridge: bypass Jarvis when session is active
  if (hasActiveSession(userId)) {
    const _sbTyping = startTypingIndicator(ctx);
    const _replyParams = ctx.message?.message_id
      ? { reply_parameters: { message_id: ctx.message.message_id } }
      : {};
    try {
      let enrichedMessage = await maybeEnrichWithXSummary(message);
      if (enrichedMessage === message) {
        enrichedMessage = await maybeEnrichWithWebSearch(message);
      }
      const aiResponse = await sendToSession(userId, enrichedMessage);
      _sbTyping.stop();
      const chunks = splitTelegramMessage(aiResponse);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.reply(chunks[i]!, i === 0 ? _replyParams : {});
      }
    } catch (e) {
      _sbTyping.stop();
      const errMsg = e instanceof Error ? e.message : String(e);
      await ctx.reply("\u274C AI Session Error: " + errMsg, _replyParams);
    }
    return;
  }


  // ── 🦞 Croppy Bridge: Route default messages to Worker tabs ──
  // G2: Skip bridge if orchestrator already handled this message
  if (orchestratorHandled) {
    console.log("[Text] G2: Orchestrator handled, skipping Bridge");
    stopProcessing();
    return;
  }
  console.log("[Text] Orchestrator did NOT handle, falling through to Bridge");
  const BRIDGE_MODE = true; // false → revert to Claude CLI (Jarvis direct)
  if (BRIDGE_MODE) {
    stopProcessing();
    await dispatchToWorker(ctx, message, { raw: true });
    return;
  }

    const typing = startTypingIndicator(ctx);

  const state = new StreamingState();
  state.replyToMessageId = ctx.message?.message_id;
  const statusCallback = createStatusCallback(ctx, state);

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
    // Save user message
    await saveChatMessage(userId, 'user', message);

    // Periodic cleanup (1% probability)
    if (Math.random() < 0.01) {
      cleanupOldHistory().catch(err => console.error('Cleanup error:', err));
    }

    // Auto-detect work mode
    await autoDetectAndUpdateWorkMode(userId, message);

    // ── Stage 3: Enrichment (pipeline module) ──
    const enrichResult = await enrichMessage(message, userId);
    message = enrichResult.message;

    // ── Stage 4: Claude Session ──
    // Save pending task so it can be resumed after restart
    savePendingTask({
      user_id: userId,
      chat_id: chatId,
      username,
      original_message: message,
      session_id: session.sessionId,
      started_at: startedAt,
    });

    setClaudeStatus('processing', actionName);
    // ピン更新（処理開始）
    try {
      const towerIdent: TowerIdentifier = { tenantId: 'telegram-bot', userId: String(userId), chatId: String(chatId) };
      await updateTower(ctx, towerIdent, { status: 'running', currentStep: actionName });
    } catch (e) { console.debug('[Tower] update failed:', e); }

    const claudeStart = Date.now();
    const response = await session.sendMessageStreaming(
      message,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );
    const claudeMs = Date.now() - claudeStart;

    // Save assistant response
    await saveChatMessage(userId, 'assistant', response);

    // Work Summary
    const workSummary = extractWorkSummary(response);
    if (workSummary) {
      try {
        await ctx.reply(
          `━━━━━━━━━━━━━━━\n✅ 作業完了\n\n📋 やったこと:\n${workSummary}\n━━━━━━━━━━━━━━━`,
          {
            disable_notification: false,
            ...(state.replyToMessageId ? { reply_parameters: { message_id: state.replyToMessageId } } : {}),
          }
        );
      } catch (e) {
        console.error('[Work Summary] Failed to send:', e);
      }
    }

    // ── Stage 5: Post-Process (pipeline module) ──
    await runPostProcess({
      ctx,
      userId,
      sessionId,
      message,
      response,
      replyToMessageId: state.replyToMessageId,
    });

    // Complete action trace
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

    // Record metrics
    recordMessageMetrics({
      message_type: 'text',
      enrichment_ms: enrichResult.enrichmentMs,
      claude_latency_ms: claudeMs,
      total_ms: durationMs,
      context_size_chars: message.length,
      success: true,
    });

    // Phase completion check
    const inFocusMode = await isFocusModeEnabled(userId);
    if (!inFocusMode) {
      await checkPhaseCompletionApproval(ctx, response);
    } else {
      if (response.toLowerCase().includes('phase') && response.toLowerCase().includes('完了')) {
        await bufferNotification(userId, 'info', 'Phase完了検出（要承認確認）');
      }
    }

    // Audit log
    await auditLog(userId, username, "TEXT", message, response);
  } catch (error) {
    console.error("Error processing message:", error);

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

    recordMessageMetrics({
      message_type: 'text',
      total_ms: durationMs,
      success: false,
    });

    // Clean up partial messages
    for (const toolMsg of state.toolMessages) {
      try {
        await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
      } catch (error) {
        console.debug("Failed to delete tool message:", error);
      }
    }

    // Classify error type
    const _errReplyOpts = state.replyToMessageId
      ? { reply_parameters: { message_id: state.replyToMessageId } }
      : {};
    const errStr = String(error).toLowerCase();
    if (errStr.includes("abort") || errStr.includes("cancel")) {
      await ctx.reply("🛑 Query stopped.", _errReplyOpts);
    } else if (errStr.includes("timeout") || errStr.includes("timed out") || errStr.includes("タイムアウト")) {
      console.warn("[Text Handler] Timeout (suppressed from user):", String(error).slice(0, 200));
    } else {
      await ctx.reply(`❌ Error: ${String(error).slice(0, 200)}`, _errReplyOpts);
    }
  } finally {
    // Clear pending task (completed or failed - either way, don't auto-resume)
    clearPendingTask();
    setClaudeStatus('idle');
    // ピン更新（処理完了）
    try {
      const towerIdent: TowerIdentifier = { tenantId: 'telegram-bot', userId: String(userId), chatId: String(chatId) };
      await updateTower(ctx, towerIdent, { status: 'idle' });
    } catch (e) { console.debug('[Tower] update failed:', e); }
    stopProcessing();
    typing.stop();
  }
}

/**
 * Claudeの応答からファイル操作・コマンド実行を抽出してサマリーを生成
 */
function extractWorkSummary(response: string): string | null {
  const actions: string[] = [];

  const editMatches = response.matchAll(/(?:✏️|Edit|Edited)\s+(.+?\.\w+)/gi);
  for (const m of editMatches) {
    const file = m[1]?.split('/').pop() || m[1];
    if (file && !actions.includes(`編集: ${file}`)) {
      actions.push(`編集: ${file}`);
    }
  }

  const writeMatches = response.matchAll(/(?:📝|Write|Created|Wrote)\s+(.+?\.\w+)/gi);
  for (const m of writeMatches) {
    const file = m[1]?.split('/').pop() || m[1];
    if (file && !actions.includes(`作成: ${file}`)) {
      actions.push(`作成: ${file}`);
    }
  }

  const bashMatches = response.matchAll(/(?:🔨|Bash|Running|Executed)[:：]?\s*`?(.+?)`?$/gim);
  for (const m of bashMatches) {
    const cmd = m[1]?.trim().slice(0, 60);
    if (cmd && !actions.includes(`実行: ${cmd}`)) {
      actions.push(`実行: ${cmd}`);
    }
  }

  if (actions.length === 0) return null;

  const limited = actions.slice(0, 8);
  if (actions.length > 8) {
    limited.push(`... 他${actions.length - 8}件`);
  }

  return limited.map(a => `  • ${a}`).join('\n');
}
