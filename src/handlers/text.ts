import { handleImsgSend } from "./imsg-send";
import { handleMailSend } from "./mail-send";
import { handleLinePost } from "./line-post";
import { handleDeadlineInput } from "./deadline-input";
import { relayDomain, getLock, getBufferCount, MAX_BUFFER } from "../services/domain-buffer";
import { handleAgentTask } from "./agent-task";
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
import { logger } from "../utils/logger";
import { session } from "../session";
import { ALLOWED_USERS } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import { auditLogRateLimit, checkInterrupt, startTypingIndicator } from "../utils";
import { sendTyping } from "../utils/typing";
import {
  hasActiveSession,
  sendToSession,
  splitTelegramMessage,
} from "../utils/session-bridge";
import { maybeEnrichWithWebSearch } from "../utils/web-search";
import { maybeEnrichWithXSummary } from "../utils/x-summary";
import { handleInboxReply } from "./inbox";

import { dispatchToWorker, handleBridgeReply } from "./croppy-bridge";
import { handleChatReply } from "./claude-chat";
import { routeToProjectNotes } from "../services/obsidian-writer";
import { getChromeOrchestrator } from "./orchestrator-chrome";
import { handleDomainRelay } from "./domain-router";

/** Quote DJ's original message at the top of a relay response (max 60 chars) */
function djQuote(msg: string): string {
  const clean = msg.replace(/\n/g, " ").trim();
  const truncated = clean.length > 60 ? clean.substring(0, 60) + "…" : clean;
  return `💬 ${truncated}\n`;
}

/** Send relay response safely: edit statusMsg or fallback to new reply, with chunking */
async function sendRelayResponse(
  ctx: Context,
  chatId: number,
  statusMsgId: number,
  text: string
): Promise<void> {
  const MAX = 4000;
  try {
    if (text.length <= MAX) {
      await ctx.api.editMessageText(chatId, statusMsgId, text);
    } else {
      // Too long for editMessageText — delete status and send chunks
      try { await ctx.api.deleteMessage(chatId, statusMsgId); } catch {}
      const chunks = splitTelegramMessage(text);
      for (const chunk of chunks) { await ctx.reply(chunk); }
    }
  } catch {
    // editMessageText failed — fallback to new reply
    try {
      const chunks = splitTelegramMessage(text);
      for (const chunk of chunks) { await ctx.reply(chunk); }
    } catch (e) {
      logger.error("text", "sendRelayResponse: all send attempts failed", e);
    }
  }
}



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
  sendTyping(ctx);



    // === Agent Task: [AGENT] prefix triggers Agent SDK execution ===
    if (message.startsWith('[AGENT]')) {
      const taskPrompt = message.replace(/^\[AGENT\]\s*/, '').trim();
      if (taskPrompt) {
        // Fire and forget - don't block other message handling
        handleAgentTask(taskPrompt, chatId, ctx.api).catch((e: any) =>
          logger.error("text", "Agent Task unhandled error", e)
        );
        return;
      }
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
        logger.error("text", "Inbox reply error", e);
      }
    }

    // === Domain reply: replies to domain chat responses go back to that domain ===
    if (replyMsg?.from?.is_bot) {
      const replyContent = ("text" in replyMsg ? replyMsg.text : "") || "";
      // Match domain tags: "\xf0\x9f\x93\x8b [domain]" or "\xf0\x9f\x93\x8c domain"
      const domainMatch = replyContent.match(/(?:\u{1F4CB}\s*\[([\w-]+)\]|\u{1F4CC}\s*([\w-]+))/u);
      const replyDomain = domainMatch?.[1] || domainMatch?.[2];
      if (replyDomain) {
        console.log(`[Text] Reply to domain ${replyDomain} response -> routing back`);
        try {
          const userText = ctx.message?.text || "";
          const statusMsg = await ctx.reply(`\u{1F4CC} ${replyDomain} \u306B\u9001\u4FE1\u4E2D...`);
          const response = await relayDomain(replyDomain, userText, async () => {
            await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `\u{1F4CC} ${replyDomain} \u5FDC\u7B54\u4E2D...`);
          });
          if (response === "BUFFERED") {
            const lock = getLock(replyDomain);
            const count = getBufferCount(replyDomain);
            const label = lock?.type === "handoff" ? "HANDOFF\u4e2d" : "\u5fdc\u7b54\u4e2d";
            await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `\u{1f4cc} ${replyDomain} ${label}\uff08\u30d0\u30c3\u30d5\u30a1 ${count}/${MAX_BUFFER}\uff09`);
          } else if (response) {
            // Split long responses to avoid Telegram 4096 char limit
            const fullReply = `\u{1F4CB} [${replyDomain}]\n${response}`;
            if (fullReply.length <= 4000) {
              await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, fullReply);
            } else {
              try { await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id); } catch {}
              const chunks = splitTelegramMessage(fullReply);
              for (const chunk of chunks) { await ctx.reply(chunk); }
            }
          } else {
            await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `\u{1F4CB} [${replyDomain}] \u2014 \u5FDC\u7B54\u306A\u3057`);
          }
          return;
        } catch (domReplyErr: any) {
          console.error(`[Text] Domain reply to ${replyDomain} failed:`, domReplyErr?.message?.substring(0, 100));
          await ctx.reply(`\u26a0\ufe0f ${replyDomain} \u30c1\u30e3\u30c3\u30c8\u63a5\u7d9a\u30a8\u30e9\u30fc\u3002/pc \u3067\u76f4\u63a5\u9001\u4fe1\u3057\u3066\u304f\u3060\u3055\u3044\u3002`);
          return; // Do NOT fall through to INBOX
        }
      }
    }

    // === F4.5: Direct domain send (/domainname message) ===
    if (message.startsWith("/")) {
      const directMatch = message.match(/^\/([a-zA-Z0-9_]+)\s+(.+)/s);
      if (directMatch) {
        const [, maybeDomain, domainMsg] = directMatch;
        const domainLower = maybeDomain!.toLowerCase();
        // Check if this domain exists in chat-routing.yaml
        try {
          const { execSync } = await import("child_process");
          const urlCheck = execSync(
            `python3 ${process.env.HOME}/claude-telegram-bot/scripts/chat-router.py url "${domainLower}" 2>/dev/null`,
            { timeout: 5000, encoding: "utf-8" }
          ).trim();
          if (urlCheck && !urlCheck.includes("未作成") && !urlCheck.includes("ERROR") && urlCheck.startsWith("http")) {
            console.log(`[Text] Direct send: /${domainLower} → ${urlCheck.substring(0, 50)}`);
            // Delete DJ's message
            try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}
            const statusMsg = await ctx.reply(`📌 ${domainLower} に送信中...`);
            try {
              const response = await relayDomain(domainLower, domainMsg!, async () => {
                await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${domainLower} 応答中...`);
              });
              if (response === "BUFFERED") {
                const lock = getLock(domainLower);
                const count = getBufferCount(domainLower);
                const label = lock?.type === "handoff" ? "HANDOFF中" : "応答中";
                await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${domainLower} ${label}（バッファ ${count}/${MAX_BUFFER}）`);
              } else if (response) {
                // Split long responses to avoid Telegram 4096 char limit
                const fullDirect = `${djQuote(domainMsg!)}📌 ${domainLower}\n\n${response}`;
                if (fullDirect.length <= 4000) {
                  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, fullDirect);
                } else {
                  try { await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id); } catch {}
                  const chunks = splitTelegramMessage(fullDirect);
                  for (const chunk of chunks) { await ctx.reply(chunk); }
                }
              } else {
                await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${domainLower} — 応答なし`);
              }
            } catch (relayErr: any) {
              try { await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${domainLower} — エラー`); } catch {}
              console.error("[Text] Direct send error:", relayErr?.message?.substring(0, 100));
            }
            return;
          }
        } catch { /* not a domain command, continue normal flow */ }
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
            // Bot message replies without domain tag (triage, worker etc.) → skip INBOX, use Worker tab
            if (replyMsg?.from?.is_bot) {
              console.log("[Text] No route, reply to bot message → skip INBOX, fall through to Worker");
            } else {
            // No domain match, no M-number: route to INBOX specialist chat
            console.log("[Text] No route match → relaying to INBOX domain");
            try {
              // 1. Show status + delete original message
              const statusMsg = await ctx.reply("📥 INBOX に送信中...");
              try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}

              const inboxResponse = await relayDomain('inbox', message, async () => {
                await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, '📥 INBOX 応答中...');
              });
              if (inboxResponse) {
                // 3. Parse [ROUTE:domain] tag
                const routeTag = inboxResponse.match(/\[ROUTE:(\w+)\]/)?.[1];
                const cleanResponse = inboxResponse.replace(/\[ROUTE:\w+\]/, "").trim();

                if (routeTag && routeTag !== "none") {
                  // 3. Auto-forward to target domain
                  console.log(`[Text] INBOX routed to ${routeTag}, forwarding...`);
                  try {
                    const fwdResponse = await relayDomain(routeTag, message, async () => {
                      try { await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📥 → ${routeTag} 応答中...`); } catch {}
                    });
                    if (fwdResponse && fwdResponse !== "BUFFERED") {
                      await sendRelayResponse(ctx, ctx.chat!.id, statusMsg.message_id, `${djQuote(message)}📌 ${routeTag}\n\n${fwdResponse}`);
                      console.log(`[Text] ${routeTag} replied ${fwdResponse.length} chars`);
                    } else if (fwdResponse === "BUFFERED") {
                      try { await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📌 ${routeTag} 応答中（バッファ済み）`); } catch {}
                    } else {
                      await sendRelayResponse(ctx, ctx.chat!.id, statusMsg.message_id, `${djQuote(message)}📌 ${routeTag}\n\n${cleanResponse}`);
                      console.log(`[Text] ${routeTag} no response, showing INBOX answer`);
                    }
                  } catch (fwdErr: any) {
                    // Forward failed, show INBOX response as fallback
                    await sendRelayResponse(ctx, ctx.chat!.id, statusMsg.message_id, `📥 INBOX (${routeTag}転送失敗)\n\n${cleanResponse}`);
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
            } // end: else (not bot reply)

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
        await appendMemo(memoText);
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
        await appendTask(taskText);
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
  stopProcessing();
  await dispatchToWorker(ctx, message, { raw: true });
}

