/**
 * auto-handoff.ts — F7: Automatic Chat Handoff
 *
 * Monitors project chat length and automatically hands off to a new chat
 * when context window is approaching limits.
 *
 * Flow:
 *   1. Before posting to a project chat, check estimated token count
 *   2. If over threshold → summarize → create new chat → inject summary → update mapping
 *   3. All logs stay in Obsidian mirror (chatlog-api.py handles this)
 *
 * Design decision from 3AI debate (2026-03-14): auto-handoff is highest priority.
 * "Token limit reached = memory loss = worst failure mode" (Claude)
 */

import { ClaudeAIClient, type Model, type CompletionResult } from "./claude-ai-client";
import { ProjectChatManager } from "./project-chat-manager";

// ─── Types ────────────────────────────────────────────────────

export interface HandoffResult {
  /** Whether handoff was triggered */
  triggered: boolean;
  /** Old chat UUID (if handoff happened) */
  oldChatUuid: string | null;
  /** New chat UUID (if handoff happened) */
  newChatUuid: string | null;
  /** Summary used for context injection */
  summary: string | null;
  /** Error if handoff failed */
  error: string | null;
}

export interface ChatTokenEstimate {
  messageCount: number;
  estimatedTokens: number;
  /** Whether this chat needs handoff */
  needsHandoff: boolean;
  /** Utilization as percentage of threshold */
  utilization: number;
}

// ─── Constants ────────────────────────────────────────────────

/**
 * Estimated max usable context window.
 * claude.ai Opus has ~200K context, but we want to hand off well before that.
 * Messages near the beginning get "forgotten" at ~60-70% of context.
 * Conservative threshold: 80K tokens (~40K for accumulated context, 40K for working space).
 */
const TOKEN_THRESHOLD = 80_000;

/** Average tokens per message (human + assistant combined) */
const AVG_TOKENS_PER_MESSAGE_PAIR = 1500;

/** Minimum messages before we even consider handoff */
const MIN_MESSAGES_FOR_HANDOFF = 20;

/** Maximum messages to include in summary request */
const MAX_MESSAGES_FOR_SUMMARY = 50;

// ─── Token Estimation ───────────────────────────────────────

/**
 * Estimate token count for a conversation.
 * Uses message count as proxy (fast, no API call for content).
 */
export function estimateTokens(messageCount: number): ChatTokenEstimate {
  // Each message pair (human+assistant) averages ~1500 tokens
  const pairs = Math.ceil(messageCount / 2);
  const estimatedTokens = pairs * AVG_TOKENS_PER_MESSAGE_PAIR;
  const utilization = Math.round((estimatedTokens / TOKEN_THRESHOLD) * 100);

  return {
    messageCount,
    estimatedTokens,
    needsHandoff: messageCount >= MIN_MESSAGES_FOR_HANDOFF && estimatedTokens >= TOKEN_THRESHOLD,
    utilization: Math.min(utilization, 100),
  };
}

/**
 * More accurate estimation by counting actual characters.
 * ~4 chars ≈ 1 token for mixed Japanese/English.
 */
export function estimateTokensFromText(text: string): number {
  // Japanese: ~1.5 chars per token. English: ~4 chars per token.
  // Mixed content: ~3 chars per token is a reasonable estimate.
  return Math.ceil(text.length / 3);
}

// ─── Auto-Handoff ───────────────────────────────────────────

/**
 * Check if a project chat needs handoff and execute if necessary.
 */
export async function checkAndHandoff(opts: {
  client: ClaudeAIClient;
  projectMgr: ProjectChatManager;
  projectId: string;
  chatUuid: string;
  model: Model;
}): Promise<HandoffResult> {
  const { client, projectMgr, projectId, chatUuid, model } = opts;

  try {
    // 1. Get conversation and count messages
    const conv = await client.getConversation(chatUuid);
    const messages = conv.chat_messages || [];
    const estimate = estimateTokens(messages.length);

    if (!estimate.needsHandoff) {
      return {
        triggered: false,
        oldChatUuid: null,
        newChatUuid: null,
        summary: null,
        error: null,
      };
    }

    console.log(`[AutoHandoff] ${projectId}: ${estimate.messageCount} msgs, ~${estimate.estimatedTokens} tokens (${estimate.utilization}%) → handoff triggered`);

    // 2. More accurate check: count actual content
    const totalText = messages.map((m) => m.text || "").join("\n");
    const accurateTokens = estimateTokensFromText(totalText);

    if (accurateTokens < TOKEN_THRESHOLD * 0.7) {
      // False alarm — actual content is smaller than estimated
      console.log(`[AutoHandoff] ${projectId}: accurate estimate ${accurateTokens} tokens < threshold × 0.7, skipping`);
      return {
        triggered: false,
        oldChatUuid: null,
        newChatUuid: null,
        summary: null,
        error: null,
      };
    }

    // 3. Generate summary of existing chat
    const summary = await generateSummary(client, chatUuid, messages, model);

    // 4. Create new chat
    const entry = projectMgr.getChat(projectId);
    const chatName = entry?.chat_name || projectId;
    const newConv = await client.createConversation({
      name: `${chatName} (continued)`,
      model,
      project_uuid: entry?.project_uuid,
    });

    // 5. Inject summary as first message
    const handoffPrompt = [
      `これは案件 ${projectId} の継続チャットです。`,
      `前チャットが長くなったため自動引き継ぎを行いました。`,
      ``,
      `## 前チャットの要約`,
      summary,
      ``,
      `以上の文脈を踏まえて、今後のメッセージに対応してください。「了解」とだけ返答してください。`,
    ].join("\n");

    await client.postFirstMessage({
      conversationUuid: newConv.uuid,
      prompt: handoffPrompt,
      model,
    });

    // 6. Update mapping
    projectMgr.replaceChat(projectId, newConv.uuid);

    // 7. Mark old chat as archived (rename)
    try {
      await client.updateConversation(chatUuid, {
        name: `[archived] ${chatName}`,
      });
    } catch {
      // Non-fatal
    }

    console.log(`[AutoHandoff] ${projectId}: ${chatUuid} → ${newConv.uuid} (summary: ${summary.length} chars)`);

    return {
      triggered: true,
      oldChatUuid: chatUuid,
      newChatUuid: newConv.uuid,
      summary,
      error: null,
    };
  } catch (e: any) {
    console.error(`[AutoHandoff] ${projectId} failed:`, e);
    return {
      triggered: false,
      oldChatUuid: null,
      newChatUuid: null,
      summary: null,
      error: e.message?.substring(0, 200) || "Unknown error",
    };
  }
}

/**
 * Generate a summary of a chat for handoff.
 */
async function generateSummary(
  client: ClaudeAIClient,
  chatUuid: string,
  messages: Array<{ text: string; sender: string; created_at: string }>,
  model: Model,
): Promise<string> {
  // Take last N messages for summary (recent context is most important)
  const recentMessages = messages.slice(-MAX_MESSAGES_FOR_SUMMARY);

  // Build conversation excerpt
  const excerpt = recentMessages
    .map((m) => {
      const role = m.sender === "human" ? "DJ" : "Claude";
      const text = (m.text || "").substring(0, 500);
      return `[${role}] ${text}`;
    })
    .join("\n\n");

  // Also capture earliest messages for project identity
  const earlyMessages = messages.slice(0, 5).map((m) => {
    const role = m.sender === "human" ? "DJ" : "Claude";
    return `[${role}] ${(m.text || "").substring(0, 300)}`;
  }).join("\n\n");

  const summaryPrompt = [
    `以下はこの案件チャットの会話履歴です。`,
    `次のチャットに引き継ぐための要約を生成してください。`,
    ``,
    `要約に含めるべき内容:`,
    `1. 案件の概要（装置名、客先、目的）`,
    `2. 現在の進捗状況`,
    `3. 未解決の課題・懸念事項`,
    `4. 直近の決定事項`,
    `5. 次にやるべきこと`,
    ``,
    `要約は1000文字以内で、箇条書きで構造化してください。`,
    ``,
    `=== チャット冒頭 ===`,
    earlyMessages,
    ``,
    `=== 直近の会話 (${recentMessages.length}件) ===`,
    excerpt,
  ].join("\n");

  const result = await client.postMessage({
    conversationUuid: chatUuid,
    prompt: summaryPrompt,
    model,
  });

  return result.text || "(要約生成失敗)";
}

// ─── Pre-post Hook ──────────────────────────────────────────

/**
 * Hook to call before posting to a project chat.
 * Returns the (possibly new) chat UUID to post to.
 */
export async function prePostHandoffCheck(opts: {
  client: ClaudeAIClient;
  projectMgr: ProjectChatManager;
  projectId: string;
  chatUuid: string;
  model: Model;
}): Promise<{ chatUuid: string; handoffTriggered: boolean }> {
  const result = await checkAndHandoff(opts);

  if (result.triggered && result.newChatUuid) {
    return { chatUuid: result.newChatUuid, handoffTriggered: true };
  }

  return { chatUuid: opts.chatUuid, handoffTriggered: false };
}

// ─── Usage Monitor ──────────────────────────────────────────

export interface UsageStatus {
  fiveHour: { utilization: number; resetsAt: string } | null;
  sevenDay: { utilization: number; resetsAt: string } | null;
  sevenDaySonnet: { utilization: number; resetsAt: string } | null;
  isNearLimit: boolean;
  recommendation: string;
}

/**
 * Check current usage and provide recommendation.
 */
export async function checkUsage(client: ClaudeAIClient): Promise<UsageStatus> {
  const usage = await client.getUsage();

  const fiveHour = usage.five_hour as any;
  const sevenDay = usage.seven_day as any;
  const sevenDaySonnet = usage.seven_day_sonnet as any;

  const isNearLimit =
    (fiveHour?.utilization || 0) > 70 ||
    (sevenDay?.utilization || 0) > 70;

  let recommendation = "通常運用";
  if ((sevenDay?.utilization || 0) > 80) {
    recommendation = "⚠️ 7日枠80%超: Sonnetのみ使用を推奨";
  } else if ((fiveHour?.utilization || 0) > 80) {
    recommendation = "⚠️ 5時間枠80%超: リセットまで待機推奨";
  } else if ((sevenDay?.utilization || 0) > 50) {
    recommendation = "ルーティング・定型作業はSonnetで実行";
  }

  return {
    fiveHour: fiveHour ? { utilization: fiveHour.utilization, resetsAt: fiveHour.resets_at } : null,
    sevenDay: sevenDay ? { utilization: sevenDay.utilization, resetsAt: sevenDay.resets_at } : null,
    sevenDaySonnet: sevenDaySonnet ? { utilization: sevenDaySonnet.utilization, resetsAt: sevenDaySonnet.resets_at } : null,
    isNearLimit,
    recommendation,
  };
}
