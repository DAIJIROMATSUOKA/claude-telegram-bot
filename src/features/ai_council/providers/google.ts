/**
 * Google (Gemini) LLM Provider for AI Council
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  LlmProvider,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from "../types";

export class GoogleProvider implements LlmProvider {
  name: "google" = "google";
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY or GOOGLE_API_KEY is required for Google provider"
      );
    }
    this.client = new GoogleGenerativeAI(key);
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: options.model || "gemini-2.5-flash",
      });

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

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 1000,
        },
      });

      const content = result.response.text() || "";

      return {
        content,
        usage: {
          input_tokens: result.response.usageMetadata?.promptTokenCount,
          output_tokens: result.response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (error) {
      console.error("Google generate error:", error);
      throw error;
    }
  }
}
