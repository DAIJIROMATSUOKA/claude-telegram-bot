/**
 * AI Council Orchestrator
 *
 * Central orchestration for multi-agent discussions.
 * Manages conversation state, generates AI responses, and posts to Telegram.
 */

import type { Api } from "grammy";
import type { CouncilSession, CouncilTurn, LlmMessage } from "./types";
import type { CouncilConfig, CouncilAgentConfig } from "../../council-config";
import { getCouncilConfig } from "../../council-config";
import {
  createSession,
  getActiveSession,
  updateSession,
  deleteSession,
} from "./sessionStore";
import { createProvider } from "./providers";
import {
  formatAgentMessage,
  formatSummary,
  formatRoundProgress,
  formatError,
} from "./format";
import {
  sendAsControlBot,
  sendAsAvatarBot,
  sendWithRateLimit,
  sendWithRetry,
} from "./telegramSend";

export class AiCouncilOrchestrator {
  private config: CouncilConfig;
  private bot: Api;

  constructor(bot: Api) {
    const config = getCouncilConfig();
    if (!config) {
      throw new Error("Council config not loaded");
    }
    this.config = config;
    this.bot = bot;
  }

  /**
   * Start a new council discussion.
   */
  async startCouncil(
    chatId: number,
    theme: string,
    replyToMessageId?: number
  ): Promise<void> {
    try {
      // Create new session
      const session = createSession(
        chatId,
        theme,
        this.config.turn_order,
        this.config.default_max_rounds
      );

      // Save root message ID
      if (replyToMessageId) {
        session.root_msg_id = replyToMessageId;
        updateSession(session);
      }

      // Send initial message
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: `🎯 <b>AI Council Started</b>\n\nTopic: "${theme}"\n\nRound 1/${session.max_rounds}`,
        parse_mode: "HTML",
        reply_to_message_id: replyToMessageId,
      });

      // Run first round
      await this.runRound(session);
    } catch (error) {
      console.error("Failed to start council:", error);
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError(
          `Failed to start council: ${error instanceof Error ? error.message : "Unknown error"}`
        ),
      });
    }
  }

  /**
   * Continue to next round.
   */
  async nextRound(chatId: number): Promise<void> {
    const session = getActiveSession(chatId);

    if (!session) {
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError("No active council session. Start one with /council <theme>"),
      });
      return;
    }

    if (session.round >= session.max_rounds) {
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError(`Already at max rounds (${session.max_rounds})`),
      });
      return;
    }

    // Increment round
    session.round++;
    updateSession(session);

    // Send round indicator
    await sendAsControlBot(this.bot, {
      chat_id: chatId,
      text: `🔄 <b>Round ${session.round}/${session.max_rounds}</b>`,
      parse_mode: "HTML",
    });

    // Run next round
    await this.runRound(session);
  }

  /**
   * Stop the current council session.
   */
  async stopCouncil(chatId: number): Promise<void> {
    const session = getActiveSession(chatId);

    if (!session) {
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError("No active council session."),
      });
      return;
    }

    deleteSession(session.id);

    await sendAsControlBot(this.bot, {
      chat_id: chatId,
      text: `🛑 <b>Council Stopped</b>\n\nSession ended after ${session.round} round(s).`,
      parse_mode: "HTML",
    });
  }

  /**
   * Generate a summary of the discussion.
   */
  async summarize(chatId: number): Promise<void> {
    const session = getActiveSession(chatId);

    if (!session) {
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError("No active council session."),
      });
      return;
    }

    if (session.transcript.length === 0) {
      await sendAsControlBot(this.bot, {
        chat_id: chatId,
        text: formatError("No discussion to summarize yet."),
      });
      return;
    }

    // Generate summary using Jarvis (Claude)
    const summary = await this.generateSummary(session);

    // Send summary
    await sendAsControlBot(this.bot, {
      chat_id: chatId,
      text: formatSummary(summary, session.round, session.agents.length),
      parse_mode: "HTML",
    });
  }

  /**
   * Run one complete round (all agents speak once).
   */
  private async runRound(session: CouncilSession): Promise<void> {
    for (let i = 0; i < session.agents.length; i++) {
      const agentId = session.agents[i];
      if (!agentId) continue;

      const agentConfig = this.config.agents[agentId];

      if (!agentConfig) {
        console.warn(`Agent config not found: ${agentId}`);
        continue;
      }

      try {
        // Generate response
        const response = await this.generateAgentResponse(
          session,
          agentId,
          agentConfig
        );

        // Create turn
        const turn: CouncilTurn = {
          agent_id: agentId,
          agent_name: agentConfig.display_name,
          emoji: agentConfig.emoji,
          content: response,
          timestamp: new Date(),
        };

        // Send message with rate limiting
        const sendFn = async () => {
          if (this.config.mode === "single") {
            return sendAsControlBot(this.bot, {
              chat_id: session.chat_id,
              text: formatAgentMessage(turn, "single"),
              parse_mode: "HTML",
            });
          } else {
            return sendAsAvatarBot(this.bot, agentConfig, {
              chat_id: session.chat_id,
              text: turn.content,
              parse_mode: "HTML",
            });
          }
        };

        const messageId = await sendWithRetry(async () =>
          sendWithRateLimit(
            sendFn,
            this.config.rate_limit.delay_between_messages_ms,
            this.config.rate_limit.jitter_ms
          )
        );

        turn.message_id = messageId;

        // Add to transcript
        session.transcript.push(turn);
        updateSession(session);
      } catch (error) {
        console.error(`Failed to generate response for ${agentId}:`, error);
        await sendAsControlBot(this.bot, {
          chat_id: session.chat_id,
          text: formatError(
            `${agentConfig.emoji} ${agentConfig.display_name} failed to respond: ${error instanceof Error ? error.message : "Unknown error"}`
          ),
        });
      }
    }

    // Send round completion message
    await sendAsControlBot(this.bot, {
      chat_id: session.chat_id,
      text: `✅ Round ${session.round} complete. Use /council next for another round, or /council sum for summary.`,
      parse_mode: "HTML",
    });
  }

  /**
   * Generate a response for a specific agent.
   */
  private async generateAgentResponse(
    session: CouncilSession,
    agentId: string,
    agentConfig: CouncilAgentConfig
  ): Promise<string> {
    // Build conversation history
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: `Discussion topic: ${session.theme}`,
      },
    ];

    // Add previous turns
    for (const turn of session.transcript) {
      messages.push({
        role: turn.agent_id === agentId ? "assistant" : "user",
        content: `[${turn.agent_name}]: ${turn.content}`,
      });
    }

    // Add current prompt
    messages.push({
      role: "user",
      content: `Now it's your turn. Respond to the discussion. Keep it concise (under 15 lines).`,
    });

    // Create provider and generate
    const provider = createProvider(agentConfig);
    const response = await provider.generate({
      system: agentConfig.system_prompt,
      messages,
      model: agentConfig.model,
      temperature: 0.7,
      maxTokens: 500,
    });

    return response.content;
  }

  /**
   * Generate a summary of the discussion.
   */
  private async generateSummary(session: CouncilSession): Promise<string> {
    // Build transcript
    const transcriptText = session.transcript
      .map((turn) => `${turn.emoji} ${turn.agent_name}:\n${turn.content}`)
      .join("\n\n");

    // Use Claude (Anthropic) for summary
    const summaryAgentConfig =
      this.config.agents["claude"] ||
      this.config.agents[Object.keys(this.config.agents)[0] || ""];

    if (!summaryAgentConfig) {
      throw new Error("No agent available for summary generation");
    }

    const provider = createProvider(summaryAgentConfig);

    const response = await provider.generate({
      system:
        "You are Jarvis, an AI assistant summarizing a multi-agent discussion. " +
        "Provide a concise summary with:\n" +
        "1. Main conclusion (1-2 paragraphs)\n" +
        "2. Recommended actions (3-5 bullet points)\n" +
        "3. Key uncertainties or areas needing verification (1-2 points)",
      messages: [
        {
          role: "user",
          content:
            `Summarize this AI council discussion:\n\n` +
            `Topic: ${session.theme}\n\n` +
            `Transcript:\n${transcriptText}`,
        },
      ],
      model: summaryAgentConfig.model,
      temperature: 0.5,
      maxTokens: 800,
    });

    return response.content;
  }
}
