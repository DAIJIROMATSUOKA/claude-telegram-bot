/**
 * Message formatting utilities for AI Council
 */

import type { CouncilTurn } from "./types";
import type { CouncilConfig } from "../../council-config";

/**
 * Format an agent's response for Telegram.
 *
 * In single mode: Prefix with emoji and agent name.
 * In multi-avatar mode: Just the content (agent identity comes from bot).
 */
export function formatAgentMessage(
  turn: CouncilTurn,
  mode: "single" | "multi-avatar"
): string {
  if (mode === "single") {
    return `${turn.emoji} <b>${turn.agent_name}</b>\n\n${turn.content}`;
  }

  // multi-avatar mode: content only
  return turn.content;
}

/**
 * Format final summary from Jarvis.
 */
export function formatSummary(
  summary: string,
  roundsCompleted: number,
  totalAgents: number
): string {
  return (
    `🤖 <b>Jarvis - Council Summary</b>\n\n` +
    `${summary}\n\n` +
    `<i>Discussion: ${roundsCompleted} round(s), ${totalAgents} agent(s)</i>`
  );
}

/**
 * Format council config status.
 */
export function formatConfigStatus(config: CouncilConfig): string {
  const agentList = config.turn_order
    .map((id) => {
      const agent = config.agents[id];
      return agent ? `${agent.emoji} ${agent.display_name}` : id;
    })
    .join(", ");

  const chatIdInfo =
    config.allowed_chat_ids.length === 0
      ? "All authorized users"
      : config.allowed_chat_ids.join(", ");

  return (
    `⚙️ <b>AI Council Configuration</b>\n\n` +
    `<b>Status:</b> ${config.enabled ? "✅ Enabled" : "❌ Disabled"}\n` +
    `<b>Mode:</b> ${config.mode}\n` +
    `<b>Max rounds:</b> ${config.default_max_rounds}\n` +
    `<b>Agents:</b> ${agentList}\n` +
    `<b>Allowed chats:</b> ${chatIdInfo}\n\n` +
    `<b>Rate limit:</b> ${config.rate_limit.messages_per_minute} msg/min, ` +
    `${config.rate_limit.delay_between_messages_ms}ms delay`
  );
}

/**
 * Format error message for user.
 */
export function formatError(error: string): string {
  return `❌ <b>Council Error</b>\n\n${error}`;
}

/**
 * Format round progress indicator.
 */
export function formatRoundProgress(
  round: number,
  maxRounds: number,
  agentsDone: number,
  totalAgents: number
): string {
  const progress = Math.round((agentsDone / totalAgents) * 100);
  return `🔄 Round ${round}/${maxRounds} - ${agentsDone}/${totalAgents} agents (${progress}%)`;
}
