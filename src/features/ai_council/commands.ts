/**
 * AI Council command handlers
 */

import type { Context } from "grammy";
import { isAuthorized } from "../../security";
import { ALLOWED_USERS } from "../../config";
import {
  isCouncilEnabled,
  isCouncilAllowedForChat,
  getCouncilConfig,
} from "../../council-config";
import { AiCouncilOrchestrator } from "./orchestrator";
import { formatConfigStatus, formatError } from "./format";

/**
 * /council <theme> - Start a new council discussion
 */
export async function handleCouncil(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  if (!chatId) {
    await ctx.reply("Error: Could not determine chat ID.");
    return;
  }

  if (!isCouncilEnabled()) {
    await ctx.reply(formatError("AI Council is not enabled."), {
      parse_mode: "HTML",
    });
    return;
  }

  if (!isCouncilAllowedForChat(chatId)) {
    await ctx.reply(
      formatError("AI Council is not enabled for this chat."),
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse command
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1); // Remove /council

  // Handle subcommands
  if (args.length === 0 || args[0] === "help") {
    await ctx.reply(
      `🤖 <b>AI Council Commands</b>\n\n` +
        `<b>/council &lt;theme&gt;</b> - Start discussion\n` +
        `<b>/council next</b> - Next round\n` +
        `<b>/council stop</b> - Stop session\n` +
        `<b>/council sum</b> - Summarize\n` +
        `<b>/council config</b> - Show config`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const subcommand = args[0]?.toLowerCase() || "";

  try {
    const orchestrator = new AiCouncilOrchestrator(ctx.api);

    switch (subcommand) {
      case "next":
        await orchestrator.nextRound(chatId);
        break;

      case "stop":
        await orchestrator.stopCouncil(chatId);
        break;

      case "sum":
      case "summary":
        await orchestrator.summarize(chatId);
        break;

      case "config": {
        const config = getCouncilConfig();
        if (config) {
          await ctx.reply(formatConfigStatus(config), { parse_mode: "HTML" });
        } else {
          await ctx.reply(formatError("Council config not loaded."), {
            parse_mode: "HTML",
          });
        }
        break;
      }

      default: {
        // Theme - start new council
        const theme = args.join(" ");
        const replyToId = ctx.message?.reply_to_message?.message_id;
        await orchestrator.startCouncil(chatId, theme, replyToId);
        break;
      }
    }
  } catch (error) {
    console.error("Council command error:", error);
    await ctx.reply(
      formatError(
        `Command failed: ${error instanceof Error ? error.message : "Unknown error"}`
      ),
      { parse_mode: "HTML" }
    );
  }
}

/**
 * /ask <agent> <question> - Ask a specific AI agent
 *
 * Example: /ask chatgpt What is 2+2?
 */
export async function handleAsk(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  if (!chatId) {
    await ctx.reply("Error: Could not determine chat ID.");
    return;
  }

  if (!isCouncilEnabled()) {
    await ctx.reply(formatError("AI Council is not enabled."), {
      parse_mode: "HTML",
    });
    return;
  }

  // Parse command
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1); // Remove /ask

  if (args.length < 2) {
    await ctx.reply(
      `❓ <b>Usage:</b> /ask &lt;agent&gt; &lt;question&gt;\n\n` +
        `<b>Available agents:</b> chatgpt, claude, gemini, openclaw`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const agentId = args[0]?.toLowerCase() || "";
  const question = args.slice(1).join(" ");

  const config = getCouncilConfig();
  if (!config) {
    await ctx.reply(formatError("Council config not loaded."), {
      parse_mode: "HTML",
    });
    return;
  }

  const agentConfig = agentId ? config.agents[agentId] : undefined;
  if (!agentConfig) {
    const availableAgents = Object.keys(config.agents).join(", ");
    await ctx.reply(
      formatError(
        `Unknown agent: ${agentId}\n\nAvailable: ${availableAgents}`
      ),
      { parse_mode: "HTML" }
    );
    return;
  }

  try {
    // Import provider
    const { createProvider } = await import("./providers");

    // Generate response
    const provider = createProvider(agentConfig);
    const response = await provider.generate({
      system: agentConfig.system_prompt,
      messages: [{ role: "user", content: question }],
      model: agentConfig.model,
      temperature: 0.7,
      maxTokens: 1000,
    });

    // Send response
    await ctx.reply(
      `${agentConfig.emoji} <b>${agentConfig.display_name}</b>\n\n${response.content}`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error("Ask command error:", error);
    await ctx.reply(
      formatError(
        `Failed to get response: ${error instanceof Error ? error.message : "Unknown error"}`
      ),
      { parse_mode: "HTML" }
    );
  }
}
