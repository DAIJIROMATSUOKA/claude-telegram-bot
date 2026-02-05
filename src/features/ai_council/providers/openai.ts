/**
 * OpenAI LLM Provider for AI Council
 */

import OpenAI from "openai";
import type {
  LlmProvider,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from "../types";

export class OpenAIProvider implements LlmProvider {
  name: "openai" = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY is required for OpenAI provider");
    }
    this.client = new OpenAI({ apiKey: key });
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      // Add system message if provided
      if (options.system) {
        messages.push({
          role: "system",
          content: options.system,
        });
      }

      // Add conversation messages
      for (const msg of options.messages) {
        messages.push({
          role: msg.role as "system" | "user" | "assistant",
          content: msg.content,
        });
      }

      const completion = await this.client.chat.completions.create({
        model: options.model || "gpt-4o",
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
      });

      const content = completion.choices[0]?.message?.content || "";
      const usage = completion.usage;

      return {
        content,
        usage: {
          input_tokens: usage?.prompt_tokens,
          output_tokens: usage?.completion_tokens,
        },
      };
    } catch (error) {
      console.error("OpenAI generate error:", error);
      throw error;
    }
  }
}
