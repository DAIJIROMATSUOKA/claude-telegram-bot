/**
 * nightly-forge-v2.ts — F8: Nightly Autonomous Improvement via claude.ai API
 *
 * Replaces v1 (bash + Claude CLI) with claude.ai API direct execution.
 * Benefits: Project docs in context, full chat history, traceable.
 *
 * Design decisions (3AI debate, 2026-03-14):
 *   - DESIGN-RULES.md reading HARDCODED at entry (cannot skip)
 *   - Full logs → Obsidian (nightly-forge/YYYY-MM-DD.md)
 *   - Chat gets checkpoint summary only (5 lines max)
 *   - Checkpoints: goal → actions → changes → rule checks → next
 *
 * Usage:
 *   bun run src/utils/nightly-forge-v2.ts              # normal
 *   bun run src/utils/nightly-forge-v2.ts --dry-run    # plan only, no execution
 *
 * Stop: touch /tmp/jarvis-nightly-stop
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { ClaudeAIClient, SessionExpiredError } from "./claude-ai-client";
import { checkUsage, type UsageStatus } from "./auto-handoff";

// ─── Constants ────────────────────────────────────────────────

const HOME = homedir();
const PROJECT_DIR = join(HOME, "claude-telegram-bot");
const DESIGN_RULES_PATH = join(PROJECT_DIR, "docs/DESIGN-RULES.md");
const FEATURE_CATALOG_PATH = join(PROJECT_DIR, "docs/FEATURE-CATALOG.md");
const OBSIDIAN_BASE = join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian");
const NIGHTLY_LOG_DIR = join(OBSIDIAN_BASE, "90_System/nightly-forge");
const STOP_FLAG = "/tmp/jarvis-nightly-stop";
const CROPPY_NOTES = join(HOME, "Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md");

/** Max steps per nightly run */
const MAX_STEPS = 5;
/** Max total runtime in minutes */
const MAX_RUNTIME_MINUTES = 60;
/** Usage threshold — skip if over this */
const USAGE_SKIP_THRESHOLD = 70;

// ─── Types ────────────────────────────────────────────────────

interface NightlyPhase {
  name: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  error?: string;
}

interface NightlyState {
  date: string;
  startedAt: string;
  phases: NightlyPhase[];
  chatUuid: string | null;
  dryRun: boolean;
  totalSteps: number;
  abortReason: string | null;
}

// ─── Logging ─────────────────────────────────────────────────

function ensureLogDir(): string {
  if (!existsSync(NIGHTLY_LOG_DIR)) mkdirSync(NIGHTLY_LOG_DIR, { recursive: true });
  return NIGHTLY_LOG_DIR;
}

function logToObsidian(date: string, line: string): void {
  ensureLogDir();
  const logPath = join(NIGHTLY_LOG_DIR, `${date}.md`);

  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# Nightly Forge ${date}\n\n`, "utf-8");
  }

  const timestamp = new Date().toISOString().substring(11, 19);
  appendFileSync(logPath, `[${timestamp}] ${line}\n`, "utf-8");
}

function notifyDJ(message: string): void {
  try {
    execSync(
      `bash ${PROJECT_DIR}/scripts/notify-dj.sh '${message.replace(/'/g, "'\\''")}'`,
      { timeout: 10000 },
    );
  } catch {
    // Non-fatal
  }
}

// ─── Stop Flag ──────────────────────────────────────────────

function shouldStop(): boolean {
  return existsSync(STOP_FLAG);
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const date = new Date().toISOString().substring(0, 10);
  const startTime = Date.now();

  const state: NightlyState = {
    date,
    startedAt: new Date().toISOString(),
    phases: [],
    chatUuid: null,
    dryRun,
    totalSteps: 0,
    abortReason: null,
  };

  logToObsidian(date, `=== Nightly Forge v2 started ${dryRun ? "(DRY RUN)" : ""} ===`);

  // ── Phase 0: Pre-flight checks ──
  const phase0: NightlyPhase = { name: "pre-flight", status: "running", startedAt: new Date().toISOString() };
  state.phases.push(phase0);

  // 0a. Stop flag
  if (shouldStop()) {
    phase0.status = "skipped";
    phase0.summary = "Stop flag detected";
    state.abortReason = "stop flag";
    logToObsidian(date, "ABORT: Stop flag /tmp/jarvis-nightly-stop exists");
    return;
  }

  // 0b. DESIGN-RULES.md — HARDCODED, CANNOT SKIP
  if (!existsSync(DESIGN_RULES_PATH)) {
    phase0.status = "failed";
    phase0.error = "DESIGN-RULES.md not found";
    state.abortReason = "missing design rules";
    logToObsidian(date, `ABORT: ${DESIGN_RULES_PATH} not found`);
    notifyDJ("🦞❌ Nightly Forge: DESIGN-RULES.md not found. Aborting.");
    return;
  }
  const designRules = readFileSync(DESIGN_RULES_PATH, "utf-8");
  logToObsidian(date, `DESIGN-RULES.md loaded (${designRules.length} chars)`);

  // 0c. Feature catalog
  let featureCatalog = "";
  if (existsSync(FEATURE_CATALOG_PATH)) {
    featureCatalog = readFileSync(FEATURE_CATALOG_PATH, "utf-8");
    logToObsidian(date, `FEATURE-CATALOG.md loaded (${featureCatalog.length} chars)`);
  }

  // 0d. Usage check
  let client: ClaudeAIClient;
  let usage: UsageStatus;
  try {
    client = new ClaudeAIClient(undefined, () => {
      logToObsidian(date, "ERROR: sessionKey expired");
      notifyDJ("🦞⚠️ Nightly Forge: sessionKey expired");
    });
    usage = await checkUsage(client);
    logToObsidian(date, `Usage: 5h=${usage.fiveHour?.utilization}%, 7d=${usage.sevenDay?.utilization}%, Sonnet=${usage.sevenDaySonnet?.utilization}%`);

    if ((usage.sevenDay?.utilization || 0) > USAGE_SKIP_THRESHOLD) {
      phase0.status = "skipped";
      phase0.summary = `7-day usage ${usage.sevenDay?.utilization}% > ${USAGE_SKIP_THRESHOLD}% threshold`;
      state.abortReason = "usage too high";
      logToObsidian(date, `ABORT: Usage too high (${usage.sevenDay?.utilization}%)`);
      notifyDJ(`🦞⏸ Nightly Forge: Usage ${usage.sevenDay?.utilization}% > ${USAGE_SKIP_THRESHOLD}%. Skipping tonight.`);
      return;
    }
  } catch (e: any) {
    phase0.status = "failed";
    phase0.error = e.message;
    state.abortReason = "client init failed";
    logToObsidian(date, `ABORT: Client init failed: ${e.message}`);
    return;
  }

  phase0.status = "done";
  phase0.completedAt = new Date().toISOString();
  phase0.summary = "All checks passed";

  // ── Phase 1: Create Nightly chat + discover tasks ──
  const phase1: NightlyPhase = { name: "discovery", status: "running", startedAt: new Date().toISOString() };
  state.phases.push(phase1);

  try {
    // Use Sonnet for discovery (save Opus quota)
    const conv = await client!.createConversation({
      name: `🌙 Nightly Forge ${date}`,
      model: "claude-sonnet-4-6",
    });
    state.chatUuid = conv.uuid;
    logToObsidian(date, `Nightly chat created: ${conv.uuid}`);

    // Discovery prompt: find improvement opportunities
    const discoveryPrompt = buildDiscoveryPrompt(designRules, featureCatalog);

    const discoveryResult = await client!.postFirstMessage({
      conversationUuid: conv.uuid,
      prompt: discoveryPrompt,
      model: "claude-sonnet-4-6",
    });

    logToObsidian(date, `Discovery response: ${discoveryResult.text.length} chars`);
    logToObsidian(date, `--- Discovery output ---\n${discoveryResult.text}\n--- End discovery ---`);

    phase1.status = "done";
    phase1.completedAt = new Date().toISOString();
    phase1.summary = `Discovered tasks (${discoveryResult.text.length} chars)`;

    if (dryRun) {
      logToObsidian(date, "DRY RUN: stopping after discovery");
      state.abortReason = "dry run";
      writeCheckpoint(client!, state, date);
      notifyDJ(`🦞🌙 Nightly Forge (dry run)\n${discoveryResult.text.substring(0, 500)}`);
      return;
    }

    // ── Phase 2: Implementation ──
    if (shouldStop()) {
      state.abortReason = "stop flag after discovery";
      logToObsidian(date, "ABORT: Stop flag detected after discovery");
      writeCheckpoint(client!, state, date);
      return;
    }

    const phase2: NightlyPhase = { name: "implementation", status: "running", startedAt: new Date().toISOString() };
    state.phases.push(phase2);

    // Ask Claude to pick the highest-impact, lowest-risk task and implement
    const implPrompt = [
      "上記の発見から、最もインパクトが高くリスクが低い改善を1つ選んで実装計画を立ててください。",
      "",
      "出力形式:",
      "```json",
      '{"task": "タスク名", "files": ["変更するファイル"], "risk": "low/medium/high", "steps": ["手順1", "手順2"]}',
      "```",
      "",
      "DESIGN-RULESに従い、テストまで含めた計画にしてください。",
    ].join("\n");

    const implResult = await client!.postMessage({
      conversationUuid: conv.uuid,
      prompt: implPrompt,
      model: "claude-sonnet-4-6",
    });

    logToObsidian(date, `Implementation plan: ${implResult.text.length} chars`);
    logToObsidian(date, `--- Implementation plan ---\n${implResult.text}\n--- End plan ---`);

    // Parse plan
    const planMatch = implResult.text.match(/```json\s*([\s\S]*?)```/);
    if (!planMatch) {
      phase2.status = "failed";
      phase2.error = "Could not parse implementation plan";
      logToObsidian(date, "ABORT: Plan parse failed");
      writeCheckpoint(client!, state, date);
      return;
    }

    let plan: { task: string; files: string[]; risk: string; steps: string[] };
    try {
      plan = JSON.parse(planMatch[1]);
    } catch {
      phase2.status = "failed";
      phase2.error = "Invalid JSON in plan";
      logToObsidian(date, "ABORT: Plan JSON parse failed");
      writeCheckpoint(client!, state, date);
      return;
    }

    // Safety: skip high-risk tasks
    if (plan.risk === "high") {
      phase2.status = "skipped";
      phase2.summary = `Skipped high-risk task: ${plan.task}`;
      logToObsidian(date, `SKIP: High-risk task: ${plan.task}`);
      writeCheckpoint(client!, state, date);
      notifyDJ(`🦞🌙 Nightly Forge: high-risk task skipped\n${plan.task}`);
      return;
    }

    // Execute implementation steps
    logToObsidian(date, `Implementing: ${plan.task} (${plan.steps.length} steps, risk: ${plan.risk})`);

    for (let i = 0; i < plan.steps.length && i < MAX_STEPS; i++) {
      if (shouldStop()) {
        state.abortReason = "stop flag during implementation";
        break;
      }

      // Check runtime
      const elapsed = (Date.now() - startTime) / 60000;
      if (elapsed > MAX_RUNTIME_MINUTES) {
        state.abortReason = `runtime exceeded ${MAX_RUNTIME_MINUTES}min`;
        logToObsidian(date, `ABORT: Runtime ${elapsed.toFixed(0)}min > ${MAX_RUNTIME_MINUTES}min`);
        break;
      }

      const stepPrompt = [
        `ステップ ${i + 1}/${plan.steps.length}: ${plan.steps[i]}`,
        "",
        "このステップを実行するために必要な具体的なコード変更またはコマンドを出力してください。",
        "実行結果を報告してから次のステップに進みます。",
      ].join("\n");

      const stepResult = await client!.postMessage({
        conversationUuid: conv.uuid,
        prompt: stepPrompt,
        model: "claude-sonnet-4-6",
      });

      state.totalSteps++;
      logToObsidian(date, `Step ${i + 1}: ${stepResult.text.substring(0, 300)}`);
    }

    phase2.status = state.abortReason ? "failed" : "done";
    phase2.completedAt = new Date().toISOString();
    phase2.summary = `${plan.task} — ${state.totalSteps} steps executed`;

    // ── Phase 3: Rule check ──
    const phase3: NightlyPhase = { name: "rule-check", status: "running", startedAt: new Date().toISOString() };
    state.phases.push(phase3);

    const ruleCheckPrompt = [
      "実装した変更がDESIGN-RULES.mdに違反していないか確認してください。",
      "",
      "チェック項目:",
      "1. 従量課金API使用禁止に違反していないか",
      "2. コマンドは1つにまとめてコピペしやすいか",
      "3. 冪等性は確保されているか",
      "4. テストは含まれているか",
      "",
      "違反があれば指摘し、なければ「ルールチェック: OK」と返答してください。",
    ].join("\n");

    const ruleResult = await client!.postMessage({
      conversationUuid: conv.uuid,
      prompt: ruleCheckPrompt,
      model: "claude-sonnet-4-6",
    });

    logToObsidian(date, `Rule check: ${ruleResult.text.substring(0, 300)}`);
    phase3.status = "done";
    phase3.completedAt = new Date().toISOString();
    phase3.summary = ruleResult.text.substring(0, 200);

  } catch (e: any) {
    if (e instanceof SessionExpiredError) {
      state.abortReason = "sessionKey expired";
    } else {
      state.abortReason = e.message?.substring(0, 200);
    }
    logToObsidian(date, `ERROR: ${e.message || e}`);
  }

  // ── Final: Write checkpoint + notify ──
  await writeCheckpoint(client!, state, date);

  const summary = formatFinalSummary(state);
  logToObsidian(date, `=== Nightly Forge v2 completed ===\n${summary}`);
  notifyDJ(`🦞🌙 Nightly Forge ${date}\n${summary}`);
}

// ─── Discovery Prompt ───────────────────────────────────────

function buildDiscoveryPrompt(designRules: string, featureCatalog: string): string {
  // Read recent croppy-notes for improvement candidates
  let recentNotes = "";
  try {
    if (existsSync(CROPPY_NOTES)) {
      const notes = readFileSync(CROPPY_NOTES, "utf-8");
      // Take last 2000 chars (most recent)
      recentNotes = notes.slice(-2000);
    }
  } catch {}

  // Read recent git log for context
  let gitLog = "";
  try {
    gitLog = execSync("cd ~/claude-telegram-bot && git log --oneline -10", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {}

  return [
    "あなたはNightly Forge — DJのFA設計会社のシステム自律改善エンジンです。",
    "",
    "## DESIGN-RULES (必読・必守)",
    designRules.substring(0, 3000),
    "",
    featureCatalog ? `## FEATURE-CATALOG\n${featureCatalog.substring(0, 2000)}\n` : "",
    "## 直近の活動 (croppy-notes)",
    recentNotes,
    "",
    "## 直近のgitコミット",
    gitLog,
    "",
    "## タスク",
    "上記の情報から改善候補を3つ挙げてください。各候補について:",
    "1. 何を改善するか（1行）",
    "2. なぜ改善が必要か（1行）",
    "3. リスク (low/medium/high)",
    "4. 推定所要時間",
    "",
    "DESIGN-RULESに違反する改善は絶対に提案しないでください。",
    "従量課金APIの使用は絶対に禁止です。",
  ].join("\n");
}

// ─── Checkpoint ─────────────────────────────────────────────

async function writeCheckpoint(client: ClaudeAIClient, state: NightlyState, date: string): Promise<void> {
  if (!state.chatUuid) return;

  // Build 5-line checkpoint
  const phases = state.phases.map((p) => `${p.name}: ${p.status}${p.summary ? ` — ${p.summary.substring(0, 80)}` : ""}`);
  const checkpoint = [
    `📋 Nightly Forge ${date} checkpoint`,
    `Phases: ${phases.join(" | ")}`,
    `Steps executed: ${state.totalSteps}`,
    `Abort reason: ${state.abortReason || "none (completed)"}`,
    `Next: DJ review at 03:00`,
  ].join("\n");

  try {
    await client.postMessage({
      conversationUuid: state.chatUuid,
      prompt: checkpoint,
      model: "claude-sonnet-4-6",
    });
  } catch {
    // Non-fatal
  }

  // Also save state to Obsidian
  logToObsidian(date, `\n## Checkpoint\n${checkpoint}`);
}

function formatFinalSummary(state: NightlyState): string {
  const phases = state.phases.map((p) => {
    const icon = { done: "✅", failed: "❌", skipped: "⏭", pending: "⏳", running: "🔄" }[p.status] || "?";
    return `${icon} ${p.name}`;
  }).join(" → ");

  return [
    phases,
    `Steps: ${state.totalSteps}`,
    state.abortReason ? `Abort: ${state.abortReason}` : "Completed normally",
  ].join("\n");
}

// ─── Entry Point (only when run directly, not when imported) ─

const isDirectRun = import.meta.main || process.argv[1]?.endsWith("nightly-forge-v2.ts");
if (isDirectRun) {
  main().catch((e) => {
  console.error("[NightlyForge] Fatal:", e);
  const date = new Date().toISOString().substring(0, 10);
  logToObsidian(date, `FATAL: ${e.message || e}`);
  notifyDJ(`🦞❌ Nightly Forge fatal error: ${(e.message || e).substring(0, 200)}`);
  process.exit(1);
  });
}

export { main };
