/**
 * Local LLM Provider for AI Council (stub implementation)
 *
 * This is a placeholder for local models like OpenClaw.
 * Implement actual local model integration as needed.
 */

import type {
  LlmProvider,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from "../types";

export class LocalProvider implements LlmProvider {
  name: "local" = "local";

  constructor() {
    console.warn("LocalProvider is a stub implementation");
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    // Stub implementation - returns a placeholder response
    console.warn("LocalProvider.generate called - returning stub response");

    const content = `[LocalProvider Stub Response]

I'm a placeholder for local LLM integration (e.g., OpenClaw).
To implement me, integrate your local model API here.

Topic: ${options.messages[options.messages.length - 1]?.content || "Unknown"}`;

    return {
      content,
      usage: {
        input_tokens: 0,
        output_tokens: content.length,
      },
    };
  }
}
