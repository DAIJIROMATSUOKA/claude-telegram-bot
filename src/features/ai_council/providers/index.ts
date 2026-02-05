/**
 * LLM Provider factory
 */

import type { LlmProvider } from "../types";
import type { CouncilAgentConfig } from "../../../council-config";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { LocalProvider } from "./local";

/**
 * Create an LLM provider instance based on agent configuration.
 */
export function createProvider(
  agentConfig: CouncilAgentConfig
): LlmProvider {
  switch (agentConfig.provider) {
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "google":
      return new GoogleProvider();
    case "local":
      return new LocalProvider();
    default:
      throw new Error(`Unknown provider: ${agentConfig.provider}`);
  }
}

export { OpenAIProvider, AnthropicProvider, GoogleProvider, LocalProvider };
