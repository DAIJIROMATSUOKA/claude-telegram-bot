/**
 * orchestrator-chrome.ts — Chrome-based Orchestrator (replaces sessionKey F4)
 *
 * Routes incoming messages to project-specific Chrome tabs.
 * Uses project-tab-router.sh for tab resolution and tab-relay.sh for forwarding.
 *
 * [DECIDED] 2026-03-14: sessionKey API廃棄、Chrome Worker Tab一本化
 */

import { exec } from "child_process";
import { promisify } from "util";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";

const execAsync = promisify(exec);

// ─── Constants ────────────────────────────────────────────────

const SCRIPTS_DIR = `${homedir()}/claude-telegram-bot/scripts`;
const TAB_ROUTER = `${SCRIPTS_DIR}/project-tab-router.sh`;
const TAB_RELAY = `${SCRIPTS_DIR}/tab-relay.sh`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const AUDIT_DIR = `${homedir()}/.jarvis/orchestrator`;
const AUDIT_FILE = `${AUDIT_DIR}/audit.jsonl`;

// ─── Types ────────────────────────────────────────────────────

type RouteMethod = "m-number" | "sender-map" | "keyword" | "no-route";

interface RoutingDecision {
  method: RouteMethod;
  projectId: string | null;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

interface RouteResult {
  decision: RoutingDecision;
  tabWT: string | null;
  forwarded: boolean;
  error: string | null;
}

// ─── Sender → Project Mapping ────────────────────────────────

const SENDER_PROJECT_MAP: Array<{ pattern: RegExp; projectId: string; label: string }> = [
  // Populate with real client mappings:
  // { pattern: /miyama|美山|成田工場/i, projectId: "M1317", label: "美山成田" },
  // { pattern: /nakanishi|中西製作所/i, projectId: "M1319", label: "中西製作所" },
  // { pattern: /yagai|ヤガイ/i, projectId: "M1311", label: "ヤガイ" },
];

const REVIEW_KEYWORDS = [
  /緊急|至急|urgent/i,
  /安全|safety|危険/i,
  /納期|deadline|遅延|遅れ/i,
  /事故|accident|故障/i,
  /クレーム|complaint/i,
];

// ─── M-number Detection ─────────────────────────────────────

const M_NUMBER_RE = /\b(M\d{4})\b/gi;
const PR_NUMBER_RE = /\b(2[4-9]\d{3})\b/g;

function detectMNumbers(text: string): string[] {
  const matches = text.match(M_NUMBER_RE);
  return matches ? [...new Set(matches.map((m) => m.toUpperCase()))] : [];
}

function detectPrNumbers(text: string): string[] {
  const matches = text.match(PR_NUMBER_RE);
  return matches ? [...new Set(matches)] : [];
}

// ─── Code-layer Routing ──────────────────────────────────────

function codeLayerRoute(text: string, source: string, senderHint?: string): RoutingDecision {
  // 1. M-number detection (highest priority)
  const mNumbers = detectMNumbers(text);
  if (mNumbers.length > 0) {
    const needsReview = REVIEW_KEYWORDS.some((kw) => kw.test(text));
    return {
      method: "m-number",
      projectId: mNumbers[0] ?? null,
      confidence: 1.0,
      reason: `M番号検出: ${mNumbers.join(", ")}`,
      needsReview,
    };
  }

  // 2. PrNo detection
  const prNumbers = detectPrNumbers(text);
  if (prNumbers.length > 0) {
    return {
      method: "m-number",
      projectId: prNumbers[0] ?? null,
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
        confidence: 0.85,
        reason: `送信元マッチ: ${label}`,
        needsReview: false,
      };
    }
  }

  // 4. Safety/deadline keyword → force review
  if (REVIEW_KEYWORDS.some((kw) => kw.test(text))) {
    return {
      method: "keyword",
      projectId: null,
      confidence: 0.7,
      reason: "安全/納期キーワード検出 → DJ確認必要",
      needsReview: true,
    };
  }

  // 5. No route
  return {
    method: "no-route",
    projectId: null,
    confidence: 0,
    reason: "ルーティング不能",
    needsReview: false,
  };
}

// ─── Shell Helpers ───────────────────────────────────────────

async function runShell(cmd: string, timeoutMs = 30000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      shell: "/bin/zsh",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      },
    });
    return stdout.trim();
  } catch (error: any) {
    return `ERROR: ${error.message || error}`;
  }
}

// ─── Audit Log ──────────────────────────────────────────────

function logAudit(entry: Record<string, unknown>): void {
  try {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Non-fatal
  }
}

// ─── Chrome Orchestrator ────────────────────────────────────

export class ChromeOrchestrator {
  /**
   * Quick synchronous route (code-layer only, no Chrome interaction)
   */
  quickRoute(text: string, source: string, senderHint?: string): RoutingDecision {
    return codeLayerRoute(text, source, senderHint);
  }

  /**
   * Full route: detect project → resolve Chrome tab → forward message
   */
  async route(opts: {
    text: string;
    source: string;
    senderHint?: string;
    autoPost?: boolean;
  }): Promise<RouteResult> {
    const now = new Date().toISOString();
    const decision = codeLayerRoute(opts.text, opts.source, opts.senderHint);

    // Audit
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

    // No project identified → return early
    if (!decision.projectId) {
      return { decision, tabWT: null, forwarded: false, error: null };
    }

    // Resolve project → Chrome tab
    let tabWT: string | null = null;
    try {
      const result = await runShell(
        `bash "${TAB_ROUTER}" resolve "${decision.projectId}"`,
        60000
      );
      if (result.startsWith("ERROR:")) {
        return { decision, tabWT: null, forwarded: false, error: result };
      }
      tabWT = result;
    } catch (e: any) {
      return { decision, tabWT: null, forwarded: false, error: e.message };
    }

    // Auto-post to project tab
    if (opts.autoPost && tabWT) {
      try {
        const prefix = `[${opts.source}] ${opts.senderHint || ""}`.trim();
        const message = prefix ? `${prefix}\n\n${opts.text}` : opts.text;
        const injectResult = await runShell(
          `bash "${TAB_MANAGER}" inject-raw "${tabWT}" ${JSON.stringify(message)}`,
          15000
        );
        const forwarded = injectResult.includes("INSERTED:SENT");
        return { decision, tabWT, forwarded, error: forwarded ? null : injectResult };
      } catch (e: any) {
        return { decision, tabWT, forwarded: false, error: e.message };
      }
    }

    return { decision, tabWT, forwarded: false, error: null };
  }

  /**
   * Forward a message between project tabs
   */
  async forward(fromProject: string, toProject: string, prefix?: string): Promise<string> {
    const fromWT = await runShell(`bash "${TAB_ROUTER}" resolve "${fromProject}"`);
    const toWT = await runShell(`bash "${TAB_ROUTER}" resolve "${toProject}"`);
    if (fromWT.startsWith("ERROR:") || toWT.startsWith("ERROR:")) {
      return `ERROR: resolve failed (from=${fromWT}, to=${toWT})`;
    }
    const prefixArg = prefix ? JSON.stringify(prefix) : '""';
    return runShell(`bash "${TAB_RELAY}" relay "${fromWT}" "${toWT}" ${prefixArg}`);
  }

  /**
   * Start a debate between two project tabs
   */
  async debate(projectA: string, projectB: string, topic: string, rounds = 3): Promise<string> {
    const wtA = await runShell(`bash "${TAB_ROUTER}" resolve "${projectA}"`);
    const wtB = await runShell(`bash "${TAB_ROUTER}" resolve "${projectB}"`);
    if (wtA.startsWith("ERROR:") || wtB.startsWith("ERROR:")) {
      return `ERROR: resolve failed (A=${wtA}, B=${wtB})`;
    }
    return runShell(
      `bash "${TAB_RELAY}" debate "${wtA}" "${wtB}" ${JSON.stringify(topic)} ${rounds}`,
      rounds * 600 * 1000 // generous timeout: 10min per round
    );
  }
}

// ─── Singleton ──────────────────────────────────────────────

let _instance: ChromeOrchestrator | null = null;

export function getChromeOrchestrator(): ChromeOrchestrator {
  if (!_instance) _instance = new ChromeOrchestrator();
  return _instance;
}

export function initChromeOrchestrator(): ChromeOrchestrator {
  _instance = new ChromeOrchestrator();
  console.log("[ChromeOrchestrator] Initialized (no sessionKey, Chrome-native)");
  return _instance;
}
