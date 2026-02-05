/**
 * AI Council Configuration Loader
 *
 * Loads and validates workspace/COUNCIL.yml configuration.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import yaml from "js-yaml";

export interface CouncilAgentConfig {
  provider: "openai" | "anthropic" | "google" | "local";
  model: string;
  display_name: string;
  emoji: string;
  telegram_token_env?: string;
  system_prompt: string;
}

export interface CouncilRateLimitConfig {
  messages_per_minute: number;
  delay_between_messages_ms: number;
  jitter_ms: number;
}

export interface CouncilConfig {
  enabled: boolean;
  mode: "single" | "multi-avatar";
  allowed_chat_ids: number[];
  default_max_rounds: number;
  turn_order: string[];
  summary_agent: string;
  rate_limit: CouncilRateLimitConfig;
  agents: Record<string, CouncilAgentConfig>;
}

interface CouncilYmlRoot {
  council: CouncilConfig;
}

let COUNCIL_CONFIG: CouncilConfig | null = null;

/**
 * Load COUNCIL.yml configuration.
 * Returns null if file doesn't exist or is invalid.
 */
export function loadCouncilConfig(): CouncilConfig | null {
  if (COUNCIL_CONFIG) return COUNCIL_CONFIG;

  try {
    const configPath = resolve(
      dirname(import.meta.dir),
      "../workspace/COUNCIL.yml"
    );

    if (!existsSync(configPath)) {
      console.log("No COUNCIL.yml found - AI Council disabled");
      return null;
    }

    const fileContent = readFileSync(configPath, "utf8");
    const parsed = yaml.load(fileContent) as CouncilYmlRoot;

    if (!parsed?.council) {
      console.warn("Invalid COUNCIL.yml: missing 'council' key");
      return null;
    }

    COUNCIL_CONFIG = parsed.council;

    // Validate required fields
    if (!COUNCIL_CONFIG.enabled) {
      console.log("AI Council is disabled in config");
      return COUNCIL_CONFIG;
    }

    if (!COUNCIL_CONFIG.agents || Object.keys(COUNCIL_CONFIG.agents).length === 0) {
      console.warn("Invalid COUNCIL.yml: no agents configured");
      COUNCIL_CONFIG.enabled = false;
      return COUNCIL_CONFIG;
    }

    console.log(
      `Loaded AI Council config: ${Object.keys(COUNCIL_CONFIG.agents).length} agents, mode=${COUNCIL_CONFIG.mode}`
    );

    return COUNCIL_CONFIG;
  } catch (error) {
    console.error("Failed to load COUNCIL.yml:", error);
    return null;
  }
}

/**
 * Get loaded council configuration.
 * Must call loadCouncilConfig() first.
 */
export function getCouncilConfig(): CouncilConfig | null {
  return COUNCIL_CONFIG;
}

/**
 * Check if AI Council is enabled and available.
 */
export function isCouncilEnabled(): boolean {
  const config = getCouncilConfig();
  return config?.enabled === true;
}

/**
 * Check if a chat is allowed to use AI Council.
 */
export function isCouncilAllowedForChat(chatId: number): boolean {
  const config = getCouncilConfig();
  if (!config?.enabled) return false;

  // Empty allowed_chat_ids means allow all authorized users
  if (!config.allowed_chat_ids || config.allowed_chat_ids.length === 0) {
    return true;
  }

  return config.allowed_chat_ids.includes(chatId);
}
