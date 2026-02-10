/**
 * Google (Gemini) LLM Provider for AI Council
 *
 * Gemini CLI経由（Google AI Pro定額サブスク）。
 * GEMINI_API_KEY不要、従量課金ゼロ。
 */

import { askGemini } from "../../../utils/multi-ai";
import type {
  LlmProvider,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from "../types";

export class GoogleProvider implements LlmProvider {
  name: "google" = "google";

  constructor(_apiKey?: string) {
    // apiKeyは互換性のため残すが使用しない（CLI経由のため不要）
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    try {
      // Build prompt from system + messages
      const parts: string[] = [];

      if (options.system) {
        parts.push(`System: ${options.system}\n`);
      }

      for (const msg of options.messages) {
        const roleLabel =
          msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
        parts.push(`${roleLabel}: ${msg.content}\n`);
      }

      const prompt = parts.join("\n");

      const result = await askGemini(prompt, 120_000);

      if (result.error) {
        throw new Error(`Gemini CLI error: ${result.error}`);
      }

      return {
        content: result.output,
        usage: {
          // CLI経由ではトークン数が取得できないためundefined
          input_tokens: undefined,
          output_tokens: undefined,
        },
      };
    } catch (error) {
      console.error("Google generate error:", error);
      throw error;
    }
  }
}
