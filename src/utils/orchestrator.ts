/**
 * orchestrator.ts — F4: Message Routing Orchestrator
 *
 * Hybrid routing: code-first (deterministic) → Claude fallback (ambiguous).
 * Design decision from 3AI debate (2026-03-14, unanimous Round 2).
 *
 * Code layer (0 cost, 0 latency):
 *   1. M-number regex → project chat
 *   2. Explicit commands (/ask, etc.) → handled elsewhere
 *   3. Sender→customer mapping → project chat
 *   4. Safety/deadline keywords → force review
 *
 * Claude layer (Sonnet, audit-logged):
 *   5. Ambiguous messages → Inbox chat judges destination
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ProjectChatManager, type ProjectChatEntry } from "./project-chat-manager";
import { ClaudeAIClient, type Model, type CompletionResult } from "./claude-ai-client";

// ─── Types ────────────────────────────────────────────────────

export type RouteMethod = "m-number" | "sender-map" | "keyword" | "command" | "claude-inbox" | "no-route";

export interface RoutingDecision {
  /** How the route was determined */
  method: RouteMethod;
  /** Target project ID (M1317, 26005, etc.) or null */
  projectId: string | null;
  /** Target chat UUID (if resolved) */
  chatUuid: string | null;
  /** Confidence: 1.0 for code-layer, 0.0-1.0 for Claude */
  confidence: number;
  /** Human-readable reason */
  reason: string;
  /** Whether this needs DJ review */
  needsReview: boolean;
}

export interface RoutingResult {
  decision: RoutingDecision;
  /** Response from project chat (if message was posted) */
  response: CompletionResult | null;
  /** Project chat entry (if routed to a project) */
  entry: ProjectChatEntry | null;
}

// ─── Sender → Customer Mapping ──────────────────────────────

/**
 * Maps known sender email domains/names to project IDs.
 * Add entries as customers are identified.
 * Format: { pattern: projectId }
 */
const SENDER_PROJECT_MAP: Array<{ pattern: RegExp; projectId: string; label: string }> = [
  // Example entries — DJ should populate these:
  // { pattern: /miyama|美山|成田工場/i, projectId: "M1317", label: "美山成田" },
  // { pattern: /nakanishi|中西製作所/i, projectId: "M1319", label: "中西製作所" },
];

// ─── Safety/Deadline Keywords ────────────────────────────────

const REVIEW_KEYWORDS = [
  /納期/,
  /deadline/i,
  /至急/,
  /urgent/i,
  /緊急/,
  /クレーム/,
  /事故/,
  /リコール/,
  /安全/,
  /safety/i,
];

// ─── Audit Log ──────────────────────────────────────────────

const AUDIT_DIR = join(homedir(), "claude-telegram-bot", "logs");
const AUDIT_FILE = join(AUDIT_DIR, "routing-audit.ndjson");

function logAudit(entry: {
  timestamp: string;
  source: string;
  method: RouteMethod;
  projectId: string | null;
  confidence: number;
  reason: string;
  messagePreview: string;
  needsReview: boolean;
}): void {
  try {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("[Orchestrator] Audit log write failed:", e);
  }
}

// ─── Code Layer Routing ─────────────────────────────────────

function codeLayerRoute(text: string, source: string, senderHint?: string): RoutingDecision {
  // 1. M-number detection (highest priority)
  const mNumbers = ProjectChatManager.detectMNumbers(text);
  if (mNumbers.length > 0) {
    const needsReview = REVIEW_KEYWORDS.some((kw) => kw.test(text));
    return {
      method: "m-number",
      projectId: mNumbers[0], // Primary M-number (first match)
      chatUuid: null, // Resolved later by ProjectChatManager
      confidence: 1.0,
      reason: `M番号検出: ${mNumbers.join(", ")}`,
      needsReview,
    };
  }

  // 2. PrNo detection
  const prNumbers = ProjectChatManager.detectPrNumbers(text);
  if (prNumbers.length > 0) {
    return {
      method: "m-number", // Same handling as M-number
      projectId: prNumbers[0],
      chatUuid: null,
      confidence: 0.9,
      reason: `PrNo検出: ${prNumbers.join(", ")}`,
      needsReview: false,
    };
  }

  // 3. Sender → customer mapping
  const senderText = `${senderHint || ""} ${text}`;
  for (const { pattern, projectId, label } of SENDER_PROJECT_MAP) {
    if (pattern.test(senderText)) {
      return {
        method: "sender-map",
        projectId,
        chatUuid: null,
        confidence: 0.85,
        reason: `送信元マッチ: ${label}`,
        needsReview: false,
      };
    }
  }

  // 4. Safety/deadline keyword → force review (no routing, DJ confirmation)
  if (REVIEW_KEYWORDS.some((kw) => kw.test(text))) {
    return {
      method: "keyword",
      projectId: null,
      chatUuid: null,
      confidence: 0.7,
      reason: "安全/納期キーワード検出 → DJ確認必要",
      needsReview: true,
    };
  }

  // No code-layer match
  return {
    method: "no-route",
    projectId: null,
    chatUuid: null,
    confidence: 0,
    reason: "コード層でルーティング不能",
    needsReview: false,
  };
}

// ─── Claude Inbox Routing ───────────────────────────────────

const INBOX_SYSTEM_PROMPT = `あなたはメッセージルーティングAIです。
受信メッセージを分析し、適切な案件チャットの宛先を判断してください。

出力形式（JSON1行のみ、他のテキスト不要）:
{"project_id": "M1317", "confidence": 0.8, "reason": "白菜検査に関する内容"}

ルール:
- project_idはM+4桁の案件番号、または年+3桁のPrNo
- 該当案件が不明な場合: {"project_id": null, "confidence": 0, "reason": "案件特定不能"}
- confidenceは0.0〜1.0
- 過去の案件チャットを探す指示の場合: {"project_id": null, "confidence": 0, "reason": "search:キーワード", "search": true}`;

async function claudeInboxRoute(
  client: ClaudeAIClient,
  inboxChatUuid: string | null,
  text: string,
  source: string,
  senderHint?: string,
): Promise<RoutingDecision> {
  if (!inboxChatUuid) {
    return {
      method: "no-route",
      projectId: null,
      chatUuid: null,
      confidence: 0,
      reason: "Inboxチャット未設定",
      needsReview: false,
    };
  }

  try {
    const prompt = [
      `[ルーティング判断リクエスト]`,
      `ソース: ${source}${senderHint ? ` (${senderHint})` : ""}`,
      `メッセージ:`,
      text.substring(0, 1000),
    ].join("\n");

    const result = await client.postMessage({
      conversationUuid: inboxChatUuid,
      prompt,
      model: "claude-sonnet-4-6", // Always Sonnet for routing (quota saving)
    });

    // Parse JSON response
    const jsonMatch = result.text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        method: "claude-inbox",
        projectId: parsed.project_id || null,
        chatUuid: null,
        confidence: parsed.confidence || 0,
        reason: parsed.reason || "Claude判断",
        needsReview: (parsed.confidence || 0) < 0.6,
      };
    }

    return {
      method: "claude-inbox",
      projectId: null,
      chatUuid: null,
      confidence: 0,
      reason: `Claude応答パース失敗: ${result.text.substring(0, 100)}`,
      needsReview: true,
    };
  } catch (e: any) {
    return {
      method: "no-route",
      projectId: null,
      chatUuid: null,
      confidence: 0,
      reason: `Claude判断エラー: ${e.message?.substring(0, 100)}`,
      needsReview: false,
    };
  }
}

// ─── Main Orchestrator ──────────────────────────────────────

export class Orchestrator {
  private client: ClaudeAIClient;
  private projectMgr: ProjectChatManager;
  private inboxChatUuid: string | null;

  constructor(opts: {
    client: ClaudeAIClient;
    projectMgr: ProjectChatManager;
    inboxChatUuid?: string | null;
  }) {
    this.client = opts.client;
    this.projectMgr = opts.projectMgr;
    this.inboxChatUuid = opts.inboxChatUuid || null;
  }

  /** Set/update the Inbox chat UUID */
  setInboxChat(uuid: string): void {
    this.inboxChatUuid = uuid;
  }

  /**
   * Route a message through the hybrid pipeline.
   * Returns routing result. Does NOT post to project chat unless autoPost=true.
   */
  async route(opts: {
    text: string;
    source: string;
    senderHint?: string;
    /** If true, automatically post to the resolved project chat */
    autoPost?: boolean;
    /** Skip Claude fallback (code-layer only) */
    codeOnly?: boolean;
  }): Promise<RoutingResult> {
    const now = new Date().toISOString();

    // ── Step 1: Code layer ──
    let decision = codeLayerRoute(opts.text, opts.source, opts.senderHint);

    // ── Step 2: Claude fallback (if code layer failed) ──
    if (decision.method === "no-route" && !opts.codeOnly) {
      decision = await claudeInboxRoute(
        this.client,
        this.inboxChatUuid,
        opts.text,
        opts.source,
        opts.senderHint,
      );
    }

    // ── Step 3: Audit log ──
    logAudit({
      timestamp: now,
      source: opts.source,
      method: decision.method,
      projectId: decision.projectId,
      confidence: decision.confidence,
      reason: decision.reason,
      messagePreview: opts.text.substring(0, 100),
      needsReview: decision.needsReview,
    });

    // ── Step 4: Resolve chat and optionally post ──
    let response: CompletionResult | null = null;
    let entry: ProjectChatEntry | null = null;

    if (decision.projectId && opts.autoPost) {
      try {
        entry = await this.projectMgr.getOrCreateChat(decision.projectId);
        decision.chatUuid = entry.chat_uuid;

        const icon = { gmail: "📧", line: "💬", slack: "🔔", apple: "📱", telegram: "💬" }[opts.source] || "📨";
        const sender = opts.senderHint ? ` (${opts.senderHint})` : "";
        const prompt = `${icon} ${opts.source}${sender}:\n${opts.text}`;

        response = await this.client.postMessage({
          conversationUuid: entry.chat_uuid,
          prompt,
          model: entry.model,
        });
      } catch (e) {
        console.error(`[Orchestrator] Post failed for ${decision.projectId}:`, e);
      }
    } else if (decision.projectId) {
      // Resolve chat UUID without posting
      try {
        entry = await this.projectMgr.getOrCreateChat(decision.projectId);
        decision.chatUuid = entry.chat_uuid;
      } catch (e) {
        console.error(`[Orchestrator] Chat resolve failed for ${decision.projectId}:`, e);
      }
    }

    return { decision, response, entry };
  }

  /**
   * Quick code-only route check (no Claude, no posting).
   * Useful for checking if a message has a deterministic route.
   */
  quickRoute(text: string, source: string, senderHint?: string): RoutingDecision {
    return codeLayerRoute(text, source, senderHint);
  }

  /** Get audit log path */
  getAuditLogPath(): string {
    return AUDIT_FILE;
  }
}
