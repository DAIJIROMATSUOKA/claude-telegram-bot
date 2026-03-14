/**
 * orchestrator-chrome.ts — Chrome-based Orchestrator (replaces sessionKey F4)
 *
 * Routes incoming messages to project-specific Chrome tabs.
 * Uses project-tab-router.sh for tab resolution and tab-relay.sh for forwarding.
 *
 * [DECIDED] 2026-03-14: sessionKey API廃棄、Chrome Worker Tab一本化
 */

import { exec } from "child_process";
import { enqueueMessage, dequeueForProject } from "../utils/message-queue";
import { promisify } from "util";
import { appendFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { homedir } from "os";

const execAsync = promisify(exec);
import { waitAndRelayResponse, registerBridgeReply } from "./croppy-bridge";

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
  { pattern: /miyama|美山|成田工場|成田/i, projectId: "M1317", label: "美山成田" },
  { pattern: /nakanishi|中西製作所|中西/i, projectId: "M1319", label: "中西製作所" },
  { pattern: /yagai|ヤガイ|おやつカルパス/i, projectId: "M1311", label: "ヤガイ" },
  { pattern: /itoham|伊藤ハム|米久|プラント/i, projectId: "M1317", label: "伊藤ハム米久" },
  { pattern: /tokai|東海漬物|東海/i, projectId: "M1320", label: "東海漬物" },
  { pattern: /prima|プリマハム|プリマ/i, projectId: "M1318", label: "プリマハム" },
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

// ─── Inbox Tab (Claude fallback routing) ─────────────────────

const INBOX_CONFIG_PATH = `${homedir()}/.claude-orchestrator-config.json`;

interface InboxConfig {
  inbox_tab_wt: string | null;
  inbox_tab_url: string | null;
}

function loadInboxConfig(): InboxConfig {
  try {
    if (existsSync(INBOX_CONFIG_PATH)) {
      return JSON.parse(readFileSync(INBOX_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { inbox_tab_wt: null, inbox_tab_url: null };
}

function saveInboxConfig(config: InboxConfig): void {
  writeFileSync(INBOX_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Claude Inbox routing: when code-layer can't route, ask Claude via Inbox tab
 */
async function claudeInboxRoute(
  text: string,
  source: string,
  senderHint?: string,
): Promise<{ projectId: string | null; confidence: number; reason: string }> {
  const config = loadInboxConfig();
  if (!config.inbox_tab_wt) {
    return { projectId: null, confidence: 0, reason: "Inboxタブ未設定" };
  }

  // Check if Inbox tab is alive
  const status = await runShell(
    `bash "${TAB_MANAGER}" check-status "${config.inbox_tab_wt}"`, 10000
  );
  if (status !== "READY") {
    return { projectId: null, confidence: 0, reason: `Inboxタブ不可: ${status}` };
  }

  // Build routing prompt
  const prompt = [
    `[ルーティング判断リクエスト]`,
    `ソース: ${source}${senderHint ? ` (${senderHint})` : ""}`,
    `メッセージ:`,
    text.substring(0, 1000),
    ``,
    `出力形式（JSON1行のみ、他のテキスト不要）:`,
    `{"project_id": "M1317", "confidence": 0.8, "reason": "白菜検査に関する内容"}`,
    ``,
    `ルール:`,
    `- project_idはM+4桁の案件番号、または年+3桁のPrNo`,
    `- 該当案件が不明な場合: {"project_id": null, "confidence": 0, "reason": "案件特定不能"}`,
    `- confidenceは0.0〜1.0`,
  ].join("\n");

  // Write prompt to file and inject
  const tmpFile = `/tmp/inbox-route-${Date.now()}.txt`;
  writeFileSync(tmpFile, prompt, "utf-8");
  const injectResult = await runShell(
    `bash "${TAB_MANAGER}" inject-file "${config.inbox_tab_wt}" "${tmpFile}"; rm -f "${tmpFile}"`,
    15000
  );
  if (!injectResult.includes("INSERTED:SENT")) {
    return { projectId: null, confidence: 0, reason: `Inbox inject失敗: ${injectResult}` };
  }

  // Wait for response
  const response = await runShell(
    `bash "${TAB_MANAGER}" wait-response "${config.inbox_tab_wt}" 60`,
    70000
  );
  if (response === "TIMEOUT" || response.startsWith("ERROR:")) {
    return { projectId: null, confidence: 0, reason: `Inbox応答失敗: ${response}` };
  }

  // Parse JSON from response
  try {
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        projectId: parsed.project_id || null,
        confidence: parsed.confidence || 0,
        reason: parsed.reason || "Claude判断",
      };
    }
  } catch {}

  return { projectId: null, confidence: 0, reason: `JSONパース失敗: ${response.substring(0, 100)}` };
}

// ─── Auto-Handoff (long chat → summarize → new chat) ────────

const HANDOFF_INJECT_THRESHOLD = 25; // inject count before warning
const HANDOFF_TRIGGER_THRESHOLD = 30; // inject count to trigger handoff

/**
 * Check if a project tab needs handoff and execute if needed
 */
async function checkAndHandoff(
  projectId: string,
  tabWT: string,
): Promise<{ triggered: boolean; newWT: string | null; error: string | null }> {
  // Estimate: read DOM message count
  const countStr = await runShell(
    `bash "${TAB_MANAGER}" token-estimate "${tabWT}" 2>/dev/null | grep -o '[0-9]*' | head -1`,
    10000
  );
  const count = parseInt(countStr) || 0;

  if (count < HANDOFF_TRIGGER_THRESHOLD) {
    return { triggered: false, newWT: null, error: null };
  }

  console.log(`[AutoHandoff] ${projectId}: ${count} messages → handoff triggered`);

  // 1. Ask for summary
  const summaryPrompt = "この会話の要約を作成してください。重要な決定事項、未解決の課題、次のアクションを含めて。";
  const tmpSummary = `/tmp/handoff-summary-${Date.now()}.txt`;
  writeFileSync(tmpSummary, summaryPrompt, "utf-8");
  await runShell(`bash "${TAB_MANAGER}" inject-file "${tabWT}" "${tmpSummary}"; rm -f "${tmpSummary}"`, 15000);
  const summary = await runShell(`bash "${TAB_MANAGER}" wait-response "${tabWT}" 120`, 130000);

  if (summary === "TIMEOUT" || summary.startsWith("ERROR:")) {
    return { triggered: false, newWT: null, error: `要約取得失敗: ${summary}` };
  }

  // 2. Create new chat with context + summary
  const CONTEXT_BUILDER = `${SCRIPTS_DIR}/project-context-builder.sh`;
  const contextFile = `/tmp/handoff-context-${Date.now()}.txt`;
  await runShell(`bash "${CONTEXT_BUILDER}" context "${projectId}" > "${contextFile}"`, 30000);

  // Append summary
  const contextContent = existsSync(contextFile) ? readFileSync(contextFile, "utf-8") : "";
  const handoffContent = [
    contextContent,
    "",
    "## 前チャットの要約（自動引き継ぎ）",
    summary.substring(0, 3000),
    "",
    "以上の文脈を踏まえて、今後のメッセージに対応してください。「了解」とだけ返答してください。",
  ].join("\n");
  writeFileSync(contextFile, handoffContent, "utf-8");

  // 3. Resolve new tab (this creates a fresh chat via project-tab-router)
  // First, clear old mapping so resolve creates a new one
  await runShell(`python3 -c "
import json, os
path = os.path.expanduser('~/.croppy-project-tabs.json')
if os.path.exists(path):
    d = json.load(open(path))
    d.pop('${projectId}', None)
    json.dump(d, open(path, 'w'), indent=2)
"`, 5000);

  const newWT = await runShell(`bash "${TAB_ROUTER}" resolve "${projectId}"`, 120000);
  unlinkSync(contextFile);

  if (newWT.startsWith("ERROR:")) {
    return { triggered: true, newWT: null, error: newWT };
  }

  console.log(`[AutoHandoff] ${projectId}: ${tabWT} → ${newWT}`);
  return { triggered: true, newWT, error: null };
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
   * Full route: detect project → resolve Chrome tab → forward message → relay response
   * G1: 応答リレー (inject → wait → read → Telegram reply)
   * G3: auto-handoff配線
   * G5: キューバッファ (inject失敗→enqueue)
   * G6+G14: Inboxフォールバック (resolve失敗→Inbox)
   */
  async route(opts: {
    text: string;
    source: string;
    senderHint?: string;
    autoPost?: boolean;
    ctx?: any; // Grammy Context for G1 応答リレー
  }): Promise<RouteResult> {
    const now = new Date().toISOString();
    console.log(`[ChromeOrch] route() called: source=${opts.source} autoPost=${opts.autoPost} hasCtx=${!!opts.ctx}`);
    const decision = codeLayerRoute(opts.text, opts.source, opts.senderHint);
    console.log(`[ChromeOrch] codeLayer: method=${decision.method} project=${decision.projectId} conf=${decision.confidence}`);

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

    // No project from code-layer → try Claude Inbox routing
    if (!decision.projectId && decision.method === "no-route") {
      try {
        const inboxResult = await claudeInboxRoute(opts.text, opts.source, opts.senderHint);
        if (inboxResult.projectId && inboxResult.confidence >= 0.6) {
          decision.method = "keyword"; // reuse type for audit
          decision.projectId = inboxResult.projectId;
          decision.confidence = inboxResult.confidence;
          decision.reason = `Claude Inbox: ${inboxResult.reason}`;
          decision.needsReview = inboxResult.confidence < 0.8;

          logAudit({
            timestamp: new Date().toISOString(),
            source: opts.source,
            method: "claude-inbox",
            projectId: inboxResult.projectId,
            confidence: inboxResult.confidence,
            reason: inboxResult.reason,
            messagePreview: opts.text.substring(0, 100),
            needsReview: decision.needsReview,
          });
        }
      } catch (e: any) {
        console.error("[ChromeOrch] Inbox route error:", e.message, e.stack?.substring(0, 300));
      }
    }

    // Still no project → return early
    if (!decision.projectId) {
      return { decision, tabWT: null, forwarded: false, error: null };
    }

    // G6+G14: Resolve project → Chrome tab (with Inbox fallback)
    let tabWT: string | null = null;
    try {
      const result = await runShell(
        `bash "${TAB_ROUTER}" resolve "${decision.projectId}"`,
        60000
      );
      if (result.startsWith("ERROR:") || !result.trim()) {
        // G6+G14: Resolve failed → try Inbox tab as fallback
        console.log(`[ChromeOrch] resolve failed for ${decision.projectId}, trying Inbox fallback`);
        const inboxConfig = loadInboxConfig();
        if (inboxConfig.inbox_tab_wt) {
          const inboxStatus = await runShell(
            `bash "${TAB_MANAGER}" check-status "${inboxConfig.inbox_tab_wt}"`, 10000
          );
          if (inboxStatus === "READY") {
            tabWT = inboxConfig.inbox_tab_wt;
            console.log(`[ChromeOrch] Inbox fallback: ${tabWT}`);
          }
        }
        if (!tabWT) {
          // G5: Enqueue for retry
          enqueueMessage({
            text: opts.text,
            source: opts.source,
            senderHint: opts.senderHint,
            projectId: decision.projectId,
            error: result || "resolve returned empty",
          });
          return { decision, tabWT: null, forwarded: false, error: `resolve失敗+キュー保存: ${result}` };
        }
      } else {
        tabWT = result;
      }
    } catch (e: any) {
      // G5: Enqueue on exception
      enqueueMessage({
        text: opts.text,
        source: opts.source,
        senderHint: opts.senderHint,
        projectId: decision.projectId!,
        error: e.message,
      });
      return { decision, tabWT: null, forwarded: false, error: e.message };
    }

    // G5: Retry any queued messages for this project (piggyback on successful resolve)
    if (tabWT && decision.projectId) {
      const queued = dequeueForProject(decision.projectId);
      for (const qm of queued) {
        try {
          const qTmp = `/tmp/orch-queue-${Date.now()}.txt`;
          writeFileSync(qTmp, `[キュー再送] ${qm.text}`, "utf-8");
          await runShell(`bash "${TAB_MANAGER}" inject-file "${tabWT}" "${qTmp}"; rm -f "${qTmp}"`, 20000);
          console.log(`[ChromeOrch] Queue retry: ${qm.id} → ${tabWT}`);
        } catch {}
      }
    }

    // Auto-post to project tab
    if (opts.autoPost && tabWT) {
      try {
        // Wait for tab to be READY before inject (may be BUSY from queue retry or prior message)
        let tabReady = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const st = await runShell(`bash "${TAB_MANAGER}" check-status "${tabWT}"`, 10000);
          if (st.trim() === "READY") { tabReady = true; break; }
          console.log(`[ChromeOrch] Tab ${tabWT} is ${st.trim()}, waiting... (${attempt + 1}/20)`);
          await new Promise(r => setTimeout(r, 3000));
        }
        if (!tabReady) {
          console.warn(`[ChromeOrch] Tab ${tabWT} still not READY after 60s`);
        }

        const prefix = `[${opts.source}] ${opts.senderHint || ""}`.trim();
        const message = prefix ? `${prefix}\n\n${opts.text}` : opts.text;
        // Use inject-file to avoid shell quoting issues (lesson: 2026-03-14)
        const tmpFile = `/tmp/orch-inject-${Date.now()}.txt`;
        writeFileSync(tmpFile, message, "utf-8");
        const injectResult = await runShell(
          `bash "${TAB_MANAGER}" inject-file "${tabWT}" "${tmpFile}"; rm -f "${tmpFile}"`,
          30000
        );
        const forwarded = injectResult.includes("INSERTED:SENT");

        if (!forwarded) {
          // G5: Inject failed → enqueue
          enqueueMessage({
            text: opts.text,
            source: opts.source,
            senderHint: opts.senderHint,
            projectId: decision.projectId!,
            error: injectResult,
          });
          return { decision, tabWT, forwarded: false, error: injectResult };
        }

        // G1: 応答リレー — wait for Chrome response, relay to Telegram
        if (opts.ctx && forwarded) {
          try {
            const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const projLabel = decision.projectId || "unknown";
            const header = `🏭 <b>${projLabel}</b> [${decision.method}]
📝 ${escHtml(opts.text.substring(0, 80))}${opts.text.length > 80 ? "..." : ""}`;

            // Delete DJ's original message (same UX as bridge)
            const origMsgId = opts.ctx.message?.message_id;
            if (origMsgId) {
              opts.ctx.api.deleteMessage(opts.ctx.chat!.id, origMsgId).catch(() => {});
            }

            // G1: Initial delay for Claude to start processing after inject
            // check-status BUSY detection is unreliable right after inject
            // (Claude needs ~3-5s to start showing Stop button)
            console.log(`[ChromeOrch] G1: waiting 5s for Claude to start processing...`);
            await new Promise(r => setTimeout(r, 5000));

            // G1: Wait for response and relay to Telegram
            // waitAndRelayResponse handles BUSY->READY polling with double-READY check
            // Also registers bridgeReplyMap (G4: reply->same tab)
            await waitAndRelayResponse(opts.ctx, tabWT!, 180000, undefined, header);
          } catch (e: any) {
            console.error("[ChromeOrch] G1 relay error:", e.message);
          }
        }

        // G3: auto-handoff配線
        if (decision.projectId && tabWT) {
          try {
            const handoff = await checkAndHandoff(decision.projectId, tabWT);
            if (handoff.triggered && handoff.newWT) {
              tabWT = handoff.newWT;
              console.log(`[ChromeOrch] G3 handoff: ${decision.projectId} → ${tabWT}`);
            }
          } catch (e: any) {
            console.error("[ChromeOrch] G3 handoff error:", e.message);
          }
        }

        return { decision, tabWT, forwarded, error: null };
      } catch (e: any) {
        // G5: Enqueue on inject exception
        enqueueMessage({
          text: opts.text,
          source: opts.source,
          senderHint: opts.senderHint,
          projectId: decision.projectId!,
          error: e.message,
        });
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

  /**
   * Set the Inbox tab for Claude fallback routing
   */
  setInboxTab(wt: string, url?: string): void {
    const config = loadInboxConfig();
    config.inbox_tab_wt = wt;
    if (url) config.inbox_tab_url = url;
    saveInboxConfig(config);
    console.log(`[ChromeOrchestrator] Inbox tab set: ${wt}`);
  }

  /**
   * Check and trigger auto-handoff if needed
   */
  async checkHandoff(projectId: string, tabWT: string): Promise<{ triggered: boolean; newWT: string | null }> {
    const result = await checkAndHandoff(projectId, tabWT);
    if (result.triggered) {
      console.log(`[ChromeOrchestrator] Handoff: ${projectId} ${tabWT} -> ${result.newWT}`);
    }
    return result;
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
