/**
 * Anthropic (Claude) LLM Provider for AI Council
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmProvider,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from "../types";

export class AnthropicProvider implements LlmProvider {
  name: "anthropic" = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY is required for Anthropic provider");
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    try {
      // Convert messages to Anthropic format
      const messages: Anthropic.MessageParam[] = options.messages
        .filter((msg) => msg.role !== "system") // System goes in system parameter
        .map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

      const response = await this.client.messages.create({
        model: options.model || "claude-sonnet-4-20250514",
        system: options.system,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
      });

      const content =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      return {
        content,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      console.error("Anthropic generate error:", error);
      throw error;
    }
  }
}
