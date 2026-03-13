/**
 * claude-ai-client.ts — claude.ai Internal API Client
 *
 * Programmatic access to claude.ai's undocumented web API.
 * Replaces Python script (claude-chat-post.py) with native TypeScript.
 *
 * Auth: sessionKey cookie from ~/.claude-chatlog-config.json
 * NOT the official api.anthropic.com — this is the Web UI backend.
 */

import { readFileSync } from "fs";
import { homedir } from "os";

// ─── Types ────────────────────────────────────────────────────

export interface ClaudeAIConfig {
  session_key: string;
  org_id: string;
}

export interface Conversation {
  uuid: string;
  name: string;
  model: string;
  created_at: string;
  updated_at: string;
  current_leaf_message_uuid?: string;
  project_uuid?: string;
  settings?: Record<string, unknown>;
}

export interface ChatMessage {
  uuid: string;
  text: string;
  sender: "human" | "assistant";
  created_at: string;
  attachments?: unknown[];
  files?: string[];
}

export interface CompletionResult {
  text: string;
  stop_reason: string | null;
  message_uuid: string | null;
}

export interface FileUploadResult {
  file_uuid: string;
  file_kind: "blob" | "image" | "document";
  file_name: string;
  sanitized_name: string;
  size_bytes: number | null;
  thumbnail_asset?: { url: string; image_width: number; image_height: number };
  preview_asset?: { url: string; image_width: number; image_height: number };
  document_asset?: { url: string; page_count: number; token_count: number | null };
}

export interface UsageInfo {
  daily_usage?: unknown;
  weekly_usage?: unknown;
  [key: string]: unknown;
}

export interface ProjectDoc {
  uuid: string;
  file_name: string;
  content: string;
  created_at: string;
}

export type Model = "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5-20251001";

// ─── Errors ───────────────────────────────────────────────────

export class SessionExpiredError extends Error {
  constructor() {
    super("sessionKey expired (403)");
    this.name = "SessionExpiredError";
  }
}

export class ClaudeAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`claude.ai API error ${status}: ${message}`);
    this.name = "ClaudeAPIError";
    this.status = status;
  }
}

// ─── Client ───────────────────────────────────────────────────

export class ClaudeAIClient {
  private sk: string;
  private orgId: string;
  private baseUrl: string;
  private onSessionExpired?: () => void;

  constructor(config?: ClaudeAIConfig, onSessionExpired?: () => void) {
    const cfg = config || ClaudeAIClient.loadConfig();
    this.sk = cfg.session_key;
    this.orgId = cfg.org_id;
    this.baseUrl = `https://claude.ai/api/organizations/${this.orgId}`;
    this.onSessionExpired = onSessionExpired;
  }

  /** Load config from ~/.claude-chatlog-config.json */
  static loadConfig(): ClaudeAIConfig {
    const path = `${homedir()}/.claude-chatlog-config.json`;
    const raw = readFileSync(path, "utf-8");
    const cfg = JSON.parse(raw);
    if (!cfg.session_key || !cfg.org_id) {
      throw new Error(`Invalid config at ${path}: missing session_key or org_id`);
    }
    return cfg;
  }

  // ─── Internal HTTP ────────────────────────────────────────

  private headers(accept = "application/json", contentType?: string): Record<string, string> {
    const h: Record<string, string> = {
      Cookie: `sessionKey=${this.sk}`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: accept,
      Referer: "https://claude.ai/",
      Origin: "https://claude.ai",
    };
    if (contentType) h["Content-Type"] = contentType;
    return h;
  }

  private async request(method: string, path: string, body?: unknown, stream = false): Promise<Response> {
    const url = `${this.baseUrl}/${path}`;
    const opts: RequestInit = {
      method,
      headers: this.headers(
        stream ? "text/event-stream" : "application/json",
        body ? "application/json" : undefined,
      ),
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(url, opts);

    if (resp.status === 403) {
      this.onSessionExpired?.();
      throw new SessionExpiredError();
    }
    if (!resp.ok && !stream) {
      const text = await resp.text().catch(() => "");
      throw new ClaudeAPIError(resp.status, text.substring(0, 500));
    }
    return resp;
  }

  // ─── Conversations ────────────────────────────────────────

  /** List conversations (paginated) */
  async listConversations(limit = 20, offset = 0): Promise<Conversation[]> {
    const resp = await this.request("GET", `chat_conversations?limit=${limit}&offset=${offset}`);
    return resp.json();
  }

  /** Get a single conversation with messages */
  async getConversation(uuid: string): Promise<Conversation & { chat_messages: ChatMessage[] }> {
    const resp = await this.request("GET", `chat_conversations/${uuid}`);
    return resp.json();
  }

  /** Create a new conversation */
  async createConversation(opts: {
    name: string;
    model?: Model;
    project_uuid?: string;
  }): Promise<Conversation> {
    const resp = await this.request("POST", "chat_conversations", {
      name: opts.name,
      model: opts.model || "claude-sonnet-4-6",
      project_uuid: opts.project_uuid || undefined,
    });
    return resp.json();
  }

  /** Update conversation (rename, star, settings) */
  async updateConversation(uuid: string, updates: Record<string, unknown>): Promise<void> {
    await this.request("PUT", `chat_conversations/${uuid}`, updates);
  }

  /** Delete conversation */
  async deleteConversation(uuid: string): Promise<void> {
    await this.request("DELETE", `chat_conversations/${uuid}`);
  }

  /** Get the current leaf message UUID (for posting) */
  async getLeafMessageUUID(uuid: string): Promise<string> {
    const conv = await this.getConversation(uuid);
    return conv.current_leaf_message_uuid || "";
  }

  // ─── Completion (Message Posting) ──────────────────────────

  /** Post a message and receive full response (blocking) */
  async postMessage(opts: {
    conversationUuid: string;
    prompt: string;
    parentMessageUuid?: string;
    model?: Model;
    files?: string[];
    attachments?: Array<{
      file_name: string;
      file_type: string;
      file_size: number;
      extracted_content: string;
    }>;
  }): Promise<CompletionResult> {
    // Auto-resolve parent if not provided
    let parentUuid = opts.parentMessageUuid;
    if (parentUuid === undefined) {
      parentUuid = await this.getLeafMessageUUID(opts.conversationUuid);
    }

    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      parent_message_uuid: parentUuid,
      timezone: "Asia/Tokyo",
      model: opts.model || "claude-sonnet-4-6",
      attachments: opts.attachments || [],
    };
    if (opts.files?.length) body.files = opts.files;

    const resp = await this.request(
      "POST",
      `chat_conversations/${opts.conversationUuid}/completion`,
      body,
      true,
    );

    return this.parseSSE(resp);
  }

  /** Post first message to a new conversation */
  async postFirstMessage(opts: {
    conversationUuid: string;
    prompt: string;
    model?: Model;
    files?: string[];
    attachments?: Array<{
      file_name: string;
      file_type: string;
      file_size: number;
      extracted_content: string;
    }>;
  }): Promise<CompletionResult> {
    return this.postMessage({
      ...opts,
      parentMessageUuid: "",
    });
  }

  /** Parse SSE stream into completion result */
  private async parseSSE(resp: Response): Promise<CompletionResult> {
    if (!resp.body) throw new ClaudeAPIError(0, "No response body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const textParts: string[] = [];
    let stopReason: string | null = null;
    let messageUuid: string | null = null;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "completion") {
              if (d.completion) textParts.push(d.completion);
              if (d.stop_reason) stopReason = d.stop_reason;
              if (d.message_uuid) messageUuid = d.message_uuid;
            } else if (d.type === "error") {
              throw new ClaudeAPIError(0, d.error?.message || "SSE error");
            }
          } catch (e) {
            if (e instanceof ClaudeAPIError) throw e;
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: textParts.join(""),
      stop_reason: stopReason,
      message_uuid: messageUuid,
    };
  }

  // ─── File Upload ──────────────────────────────────────────

  /** Upload a file to a conversation (supports text, image, PDF) */
  async uploadFile(opts: {
    conversationUuid: string;
    fileName: string;
    fileContent: Buffer | Uint8Array;
    contentType: string;
  }): Promise<FileUploadResult> {
    const formData = new FormData();
    const blob = new Blob([opts.fileContent], { type: opts.contentType });
    formData.append("file", blob, opts.fileName);

    const url = `${this.baseUrl}/conversations/${opts.conversationUuid}/wiggle/upload-file`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: `sessionKey=${this.sk}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://claude.ai/",
        Origin: "https://claude.ai",
        // Content-Type auto-set by FormData
      },
      body: formData,
    });

    if (resp.status === 403) {
      this.onSessionExpired?.();
      throw new SessionExpiredError();
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ClaudeAPIError(resp.status, text.substring(0, 500));
    }
    return resp.json();
  }

  // ─── Usage ────────────────────────────────────────────────

  /** Get current usage (quota monitoring) */
  async getUsage(): Promise<UsageInfo> {
    const resp = await this.request("GET", "usage");
    return resp.json();
  }

  /** Get rate limit info */
  async getRateLimits(): Promise<unknown> {
    const resp = await this.request("GET", "rate_limits");
    return resp.json();
  }

  // ─── Settings ─────────────────────────────────────────────

  /** Update conversation settings (web search, paprika_mode, etc.) */
  async updateSettings(uuid: string, settings: Record<string, unknown>): Promise<void> {
    await this.updateConversation(uuid, { settings });
  }

  // ─── Project Docs ─────────────────────────────────────────

  /** List all projects */
  async listProjects(limit = 50): Promise<Array<{ uuid: string; name: string; [k: string]: unknown }>> {
    const resp = await this.request("GET", `projects?limit=${limit}`);
    return resp.json();
  }

  /** Get project docs */
  async getProjectDocs(projectUuid: string): Promise<ProjectDoc[]> {
    const resp = await this.request("GET", `projects/${projectUuid}/docs`);
    return resp.json();
  }

  /** Create a project doc */
  async createProjectDoc(projectUuid: string, fileName: string, content: string): Promise<ProjectDoc> {
    const resp = await this.request("POST", `projects/${projectUuid}/docs`, {
      file_name: fileName,
      content,
    });
    return resp.json();
  }

  /** Delete a project doc */
  async deleteProjectDoc(projectUuid: string, docUuid: string): Promise<void> {
    await this.request("DELETE", `projects/${projectUuid}/docs/${docUuid}`);
  }

  // ─── Convenience ──────────────────────────────────────────

  /** Search past chats by keyword (via Obsidian chatlog search) */
  async searchChats(keyword: string): Promise<Array<{ filename: string; title: string; uuid: string }>> {
    const { execSync } = await import("child_process");
    const home = homedir();
    const script = `${home}/scripts/search-chatlogs.py`;
    const stateFile = `${home}/.claude-chatlog-state.json`;

    // Run search
    const searchResult = execSync(
      `python3 "${script}" "${keyword.replace(/"/g, '\\"')}" --list`,
      { timeout: 15000, encoding: "utf-8" },
    ).trim();

    if (!searchResult) return [];

    // Load UUID mapping
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    const basenameToUuid: Record<string, string> = {};
    for (const [uid, info] of Object.entries(state)) {
      const fp = (info as any)?.filepath || "";
      if (fp) {
        const basename = fp.split("/").pop() || "";
        basenameToUuid[basename] = uid;
      }
    }

    // Parse results
    const matches: Array<{ filename: string; title: string; uuid: string }> = [];
    for (const line of searchResult.split("\n")) {
      const m = line.match(/^(.+\.md)\s*$/);
      if (m) {
        const filename = m[1].trim();
        const uuid = basenameToUuid[filename] || "";
        const title = filename.replace(/\.md$/, "").replace(/_/g, " ");
        if (uuid) matches.push({ filename, title, uuid });
      }
    }
    return matches;
  }

  /** Post to a chat found by keyword search */
  async searchAndPost(keyword: string, message: string, model?: Model): Promise<CompletionResult & { chatTitle: string }> {
    const matches = await this.searchChats(keyword);
    if (matches.length === 0) {
      throw new Error(`No chats found for keyword: ${keyword}`);
    }
    const best = matches[0];
    const result = await this.postMessage({
      conversationUuid: best.uuid,
      prompt: message,
      model,
    });
    return { ...result, chatTitle: best.title };
  }
}
