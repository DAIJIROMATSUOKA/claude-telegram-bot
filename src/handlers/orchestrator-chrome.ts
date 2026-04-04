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
import { extractMachineNo, getProjectContext } from "../project-context-injector";
import { homedir } from "os";

const execAsync = promisify(exec);
import { waitAndRelayResponse } from "./croppy-bridge";

// ─── Constants ────────────────────────────────────────────────

const SCRIPTS_DIR = `${homedir()}/claude-telegram-bot/scripts`;
const TAB_ROUTER = `${SCRIPTS_DIR}/project-tab-router.sh`;
const TAB_RELAY = `${SCRIPTS_DIR}/tab-relay.sh`;
const TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;
const AUDIT_DIR = `${homedir()}/.jarvis/orchestrator`;
const AUDIT_FILE = `${AUDIT_DIR}/audit.jsonl`;


// ─── Periodic State Snapshot (Defense Line 1) ──────────────
const projectInjectCounts: Map<string, number> = new Map();
const projectInjectCountsTimestamps: Map<string, number> = new Map();
const PROJECT_INJECT_MAX = 1000;
const PROJECT_INJECT_TTL = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of projectInjectCountsTimestamps) {
    if (now - ts > PROJECT_INJECT_TTL) {
      projectInjectCounts.delete(key);
      projectInjectCountsTimestamps.delete(key);
    }
  }
}, 60_000).unref();
const SNAPSHOT_INTERVAL = 15;

async function saveProjectSnapshot(
  projectId: string,
  tabWT: string
): Promise<void> {
  try {
    const promptFile = `/tmp/snapshot-prompt-${Date.now()}.txt`;
    writeFileSync(promptFile, "この案件の現在の状況を5行で要約してください。重要な決定事項、進行中の作業、未解決の課題、次のアクションを含めて。必ず5行以内で。", "utf-8");
    await runShell(`bash "${TAB_MANAGER}" inject-file "${tabWT}" "${promptFile}"; rm -f "${promptFile}"`, 15000);

    // 5s fixed wait + wait-response
    await new Promise(r => setTimeout(r, 5000));
    const summary = await runShell(`bash "${TAB_MANAGER}" wait-response "${tabWT}" 120`, 130000);

    if (summary && summary !== "TIMEOUT" && summary !== "NO_RESPONSE" && !summary.startsWith("ERROR:")) {
      // Save to Dropbox project folder
      const folderName = await runShell(
        `bash "${SCRIPTS_DIR}/project-context-builder.sh" folder-name "${projectId}"`, 5000
      );
      if (folderName && folderName.trim()) {
        const dropboxDir = `${homedir()}/Machinelab Dropbox/machinelab/プロジェクト`;
        const folderPath = `${dropboxDir}/${folderName.trim()}`;
        const snapshotPath = `${folderPath}/${projectId}_ai-context.md`;
        const content = [
          `# ${projectId} AI文脈スナップショット`,
          `更新: ${new Date().toISOString().replace("T", " ").substring(0, 16)}`,
          "",
          summary.substring(0, 2000),
        ].join("\n");
        writeFileSync(snapshotPath, content, "utf-8");
        console.log(`[Snapshot] ${projectId}: saved to ${snapshotPath}`);
      }
    }
  } catch (e: any) {
    console.error(`[Snapshot] ${projectId}: failed -`, e.message);
    // Non-fatal: snapshot failure must not break message routing
  }
}

function shouldTakeSnapshot(projectId: string): boolean {
  const count = projectInjectCounts.get(projectId) || 0;
  projectInjectCounts.set(projectId, count + 1);
  projectInjectCountsTimestamps.set(projectId, Date.now());
  if (projectInjectCounts.size > PROJECT_INJECT_MAX) {
    const oldest = projectInjectCounts.keys().next().value;
    if (oldest !== undefined) { projectInjectCounts.delete(oldest); projectInjectCountsTimestamps.delete(oldest); }
  }
  return (count + 1) % SNAPSHOT_INTERVAL === 0;
}

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


// ─── Per-project Lock (serialize route() calls per project) ────────
const projectLocks = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this project to complete
  const existing = projectLocks.get(projectId);
  let resolve: () => void;
  const myLock = new Promise<void>((r) => { resolve = r; });
  projectLocks.set(projectId, myLock);

  if (existing) {
    console.log(`[ChromeOrch] ${projectId}: waiting for previous route() to complete...`);
    await existing;
  }

  try {
    return await fn();
  } finally {
    resolve!();
    // Clean up if this is still our lock
    if (projectLocks.get(projectId) === myLock) {
      projectLocks.delete(projectId);
    }
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


/**
 * Check if a project tab needs handoff and execute if needed
 */
async function checkAndHandoff(
  projectId: string,
  tabWT: string,
): Promise<{ triggered: boolean; newWT: string | null; error: string | null }> {
  // --- Token-estimate based trigger (pct >= 70) OR count >= 40 ---
  let shouldHandoff = false;
  const injectCount = projectInjectCounts.get(projectId) || 0;

  try {
    const estRaw = await runShell(
      `bash "${TAB_MANAGER}" token-estimate "${tabWT}" 2>/dev/null | grep "Usage:" | grep -o '[0-9]*'`,
      10000
    );
    const pct = parseInt(estRaw) || 0;
    if (pct >= 70) {
      console.log(`[AutoHandoff] ${projectId}: token ${pct}% >= 70% → handoff`);
      shouldHandoff = true;
    }
  } catch (e: any) {
    console.error(`[AutoHandoff] ${projectId}: token-estimate failed, falling back to count`);
  }

  if (!shouldHandoff && injectCount >= 40) {
    console.log(`[AutoHandoff] ${projectId}: ${injectCount} injects >= 40 → handoff`);
    shouldHandoff = true;
  }

  if (!shouldHandoff) {
    return { triggered: false, newWT: null, error: null };
  }

  console.log(`[AutoHandoff] ${projectId}: HANDOFF START (pct-based or count=${injectCount})`);

  // --- Step 1: Try to get summary from current chat ---
  let summary = "";
  try {
    const promptFile = `/tmp/handoff-summary-${Date.now()}.txt`;
    writeFileSync(promptFile, "この会話の要約を作成してください。重要な決定事項、未解決の課題、次のアクションを含めて。500文字以内で。", "utf-8");
    await runShell(`bash "${TAB_MANAGER}" inject-file "${tabWT}" "${promptFile}"; rm -f "${promptFile}"`, 15000);
    await new Promise(r => setTimeout(r, 5000));
    const resp = await runShell(`bash "${TAB_MANAGER}" wait-response "${tabWT}" 120`, 130000);
    if (resp && resp !== "TIMEOUT" && resp !== "NO_RESPONSE" && !resp.startsWith("ERROR:")) {
      summary = resp.substring(0, 3000);
    }
  } catch (e: any) {
    console.error(`[AutoHandoff] ${projectId}: summary failed -`, e.message);
  }

  // --- Step 2: Build context (includes _ai-context.md from Defense Line 1) ---
  const CONTEXT_BUILDER = `${SCRIPTS_DIR}/project-context-builder.sh`;
  const contextFile = `/tmp/handoff-context-${Date.now()}.txt`;
  try {
    await runShell(`bash "${CONTEXT_BUILDER}" context "${projectId}" > "${contextFile}"`, 30000);
  } catch {
    writeFileSync(contextFile, `これは案件 ${projectId} の専用チャットです。\n`, "utf-8");
  }

  // Append summary (or note that it failed)
  let contextContent = existsSync(contextFile) ? readFileSync(contextFile, "utf-8") : "";
  if (summary) {
    contextContent += "\n## 前チャットの要約（自動引き継ぎ）\n" + summary + "\n";
  } else {
    contextContent += "\n## 注意\n前チャットの要約取得に失敗しました。上記のAI文脈スナップショットが最新の状態です。\n";
  }
  contextContent += "\n以上の文脈を踏まえて、今後のメッセージに対応してください。「了解」とだけ返答してください。";
  writeFileSync(contextFile, contextContent, "utf-8");

  // --- Step 3: Create new chat DIRECTLY (not via resolve, to avoid stale mapping) ---
  let newWT = "";
  let newConvUrl = "";
  try {
    const CONFIG = `${homedir()}/claude-telegram-bot/.croppy-workers.json`;
    let projectUrl = "https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8";
    try {
      const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
      projectUrl = cfg.workers?.[0]?.url || projectUrl;
    } catch {}

    // Open new tab
    const beforeInfo = await runShell(
      `osascript -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))'`,
      5000
    );
    const [widx, tbefore] = beforeInfo.trim().split(" ");
    await runShell(
      `osascript -e 'tell application "Google Chrome" to tell window ${widx} to set URL of (make new tab) to "${projectUrl}"'`,
      5000
    );
    const newTidx = parseInt(tbefore!) + 1;
    newWT = `${widx}:${newTidx}`;

    // Wait for page load
    await new Promise(r => setTimeout(r, 8000));

    // Inject context file
    const injectResult = await runShell(
      `bash "${TAB_MANAGER}" inject-file "${newWT}" "${contextFile}"`,
      20000
    );
    if (!injectResult.includes("INSERTED:SENT")) {
      throw new Error(`inject failed: ${injectResult}`);
    }

    // Wait for conv URL (project URL -> chat URL)
    await new Promise(r => setTimeout(r, 5000));
    newConvUrl = await runShell(
      `osascript -e 'tell application "Google Chrome" to return URL of tab ${newTidx} of window ${widx}'`,
      5000
    );
    if (newConvUrl.includes("/project/")) {
      await new Promise(r => setTimeout(r, 5000));
      newConvUrl = await runShell(
        `osascript -e 'tell application "Google Chrome" to return URL of tab ${newTidx} of window ${widx}'`,
        5000
      );
    }
  } catch (e: any) {
    console.error(`[AutoHandoff] ${projectId}: new chat creation failed -`, e.message);
    try { unlinkSync(contextFile); } catch {}
    // CRITICAL: do NOT clear old mapping — old chat is still better than nothing
    return { triggered: true, newWT: null, error: e.message };
  }

  try { unlinkSync(contextFile); } catch {}

  // --- Step 4: ONLY NOW update D1 mapping (old chat still works if this fails) ---
  try {
    await runShell(
      `bash "${TAB_ROUTER}" register "${projectId}" "${newConvUrl}"`,
      10000
    );
  } catch (e: any) {
    console.error(`[AutoHandoff] ${projectId}: D1 update failed -`, e.message);
    // Fallback: update local JSON
    try {
      const localPath = `${homedir()}/.croppy-project-tabs.json`;
      const localData = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
      localData[projectId] = { conv_url: newConvUrl, wt: newWT, updated_at: new Date().toISOString() };
      writeFileSync(localPath, JSON.stringify(localData, null, 2), "utf-8");
    } catch {}
  }

  // Reset inject counter for this project
  projectInjectCounts.set(projectId, 0);

  // Update auto-kick target URL to track new chat
  try {
    const newUrl = newConvUrl.trim();
    if (newUrl && newUrl.includes("/chat/")) {
      writeFileSync("/tmp/autokick-target-url", newUrl, "utf-8");
      console.log(`[AutoHandoff] auto-kick target updated: ${newUrl.substring(0, 60)}`);
    }
  } catch {}

  console.log(`[AutoHandoff] ${projectId}: ${tabWT} → ${newWT} (summary: ${summary ? "OK" : "FAILED, using ai-context.md"})`);
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

    // Serialize per-project (prevent concurrent inject to same tab)
    return withProjectLock(decision.projectId, async () => {

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
            projectId: decision.projectId!,
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
        // Access DB context injection (diff-based, from nightly cache)
        let fullMessage = message;
        if (decision.projectId) {
          const machineKey = extractMachineNo(decision.projectId);
          if (machineKey) {
            const accessCtx = getProjectContext(machineKey);
            if (accessCtx) {
              fullMessage = accessCtx + "\n---\n" + message;
              console.log(`[ChromeOrch] Injected Access context for M${machineKey}`);
            }
          }
        }
        // Use inject-file to avoid shell quoting issues (lesson: 2026-03-14)
        const tmpFile = `/tmp/orch-inject-${Date.now()}.txt`;
        writeFileSync(tmpFile, fullMessage, "utf-8");
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
            try {
              await waitAndRelayResponse(opts.ctx, tabWT!, 180000, undefined, header);
            } catch (relayErr: any) {
              // CONV_LIMIT or RATE_LIMIT from wait-response → force handoff
              if (relayErr?.message?.includes("CONV_LIMIT") || relayErr?.message?.includes("ERROR:CONV_LIMIT")) {
                console.log(`[ChromeOrch] CONV_LIMIT detected on ${decision.projectId} — forcing handoff`);
                if (decision.projectId && tabWT) {
                  const emergencyHandoff = await checkAndHandoff(decision.projectId, tabWT);
                  if (emergencyHandoff.triggered && emergencyHandoff.newWT) {
                    tabWT = emergencyHandoff.newWT;
                    // Re-inject the original message into the new chat
                    const retryFile = `/tmp/retry-msg-${Date.now()}.txt`;
                    writeFileSync(retryFile, opts.text, "utf-8");
                    await runShell(`bash "${TAB_MANAGER}" inject-file "${tabWT}" "${retryFile}"; rm -f "${retryFile}"`, 20000);
                    await new Promise(r => setTimeout(r, 5000));
                    await waitAndRelayResponse(opts.ctx, tabWT!, 180000, undefined, header);
                  }
                }
              } else {
                throw relayErr;
              }
            }
          } catch (e: any) {
            console.error("[ChromeOrch] G1 relay error:", e.message);
          }
        }

        // Defense Line 1: periodic state snapshot (every 15 injects)
        if (decision.projectId && tabWT) {
          if (shouldTakeSnapshot(decision.projectId)) {
            saveProjectSnapshot(decision.projectId, tabWT).catch(e =>
              console.error("[Snapshot] background error:", e.message)
            );
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
    }); // end withProjectLock
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
