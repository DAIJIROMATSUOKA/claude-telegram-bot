/**
 * Type definitions for AI Council
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGenerateOptions {
  system?: string;
  messages: LlmMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmGenerateResponse {
  content: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface LlmProvider {
  name: "openai" | "anthropic" | "google" | "local";
  generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse>;
}

export interface CouncilTurn {
  agent_id: string;
  agent_name: string;
  emoji: string;
  content: string;
  timestamp: Date;
  message_id?: number; // Telegram message ID
}

export interface CouncilSession {
  id: string;
  chat_id: number;
  root_msg_id?: number;
  round: number;
  max_rounds: number;
  agents: string[]; // Agent IDs in turn order
  transcript: CouncilTurn[];
  theme: string; // Original user question/theme
  created_at: Date;
  updated_at: Date;
  ttl: Date; // Expiration time
}
