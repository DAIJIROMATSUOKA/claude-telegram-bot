/**
 * Domain relay buffer system
 * Handles: relay-in-progress buffering + handoff buffering
 * 
 * DESIGN: All domain relays share ONE physical Chrome tab (relay tab 1:1).
 * A global relay-tab lock serializes all relay operations across domains.
 * Per-domain handoff locks are separate (handoff uses different mechanism).
 */
import { spawn } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync, readdirSync } from "fs";

export const MAX_BUFFER = 10;
const LOCK_DIR = "/tmp";
const GLOBAL_RELAY_LOCK = `${LOCK_DIR}/domain-relay-tab.lock`;

interface DomainLock {
  type: "relay" | "handoff";
  pid: number;
  since: string;
  domain: string;
}

interface BufferEntry {
  ts: string;
  text: string;
  telegram_msg_id?: number;
}

interface GlobalRelayLock {
  pid: number;
  since: string;
  domain: string;
}

function lockPath(domain: string): string {
  return `${LOCK_DIR}/domain-lock-${domain}.json`;
}

function bufferPath(domain: string): string {
  return `${LOCK_DIR}/domain-buffer-${domain}.jsonl`;
}

// --- Global relay tab lock (serializes ALL domain relays) ---

function getGlobalRelayLock(): GlobalRelayLock | null {
  try {
    if (!existsSync(GLOBAL_RELAY_LOCK)) return null;
    const data = JSON.parse(readFileSync(GLOBAL_RELAY_LOCK, "utf-8"));
    const age = Date.now() - new Date(data.since).getTime();
    if (age > 600_000) {
      // Absolute max 10min - always stale
      console.log(`[Buffer] Stale global relay lock (${Math.round(age / 1000)}s, absolute max), removing`);
      try { unlinkSync(GLOBAL_RELAY_LOCK); } catch (e) {}
      return null;
    }
    if (age > 120_000) {
      // Check if lock holder is still alive
      let pidAlive = false;
      try { process.kill(data.pid, 0); pidAlive = true; } catch (e) {}
      if (!pidAlive) {
        console.log(`[Buffer] Stale global relay lock (${Math.round(age / 1000)}s, PID ${data.pid} dead), removing`);
        try { unlinkSync(GLOBAL_RELAY_LOCK); } catch (e) {}
        return null;
      }
      // PID alive - relay or poll still running, respect the lock
    }
    return data;
  } catch (e) { return null; }
}

function acquireGlobalRelayLock(domain: string): boolean {
  const existing = getGlobalRelayLock();
  if (existing) return false;
  writeFileSync(GLOBAL_RELAY_LOCK, JSON.stringify({
    pid: process.pid, since: new Date().toISOString(), domain,
  }));
  return true;
}

function releaseGlobalRelayLock(): void {
  try { unlinkSync(GLOBAL_RELAY_LOCK); } catch (e) {}
}

// --- Per-domain handoff lock (separate from relay) ---

export function getLock(domain: string): DomainLock | null {
  try {
    const p = lockPath(domain);
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const age = Date.now() - new Date(data.since).getTime();
    const maxAge = data.type === "handoff" ? 600_000 : 120_000;
    if (age > maxAge) {
      console.log(`[Buffer] Stale ${data.type} lock for ${domain} (${Math.round(age / 1000)}s), removing`);
      try { unlinkSync(p); } catch (e) {}
      return null;
    }
    return data;
  } catch (e) { return null; }
}

export function createHandoffLock(domain: string): void {
  writeFileSync(lockPath(domain), JSON.stringify({
    type: "handoff", pid: process.pid, since: new Date().toISOString(), domain,
  }));
}

export function removeHandoffLock(domain: string): void {
  try { unlinkSync(lockPath(domain)); } catch (e) {}
}

function addToBuffer(domain: string, text: string, telegramMsgId?: number): number {
  const entry: BufferEntry = { ts: new Date().toISOString(), text, telegram_msg_id: telegramMsgId };
  appendFileSync(bufferPath(domain), JSON.stringify(entry) + "\n");
  return getBufferCount(domain);
}

export function getBufferCount(domain: string): number {
  try {
    const content = readFileSync(bufferPath(domain), "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch (e) { return 0; }
}

function drainBuffer(domain: string): BufferEntry[] {
  const p = bufferPath(domain);
  try {
    if (!existsSync(p)) return [];
    const content = readFileSync(p, "utf-8").trim();
    if (!content) return [];
    const entries = content.split("\n").map(line => {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean) as BufferEntry[];
    unlinkSync(p);
    return entries;
  } catch (e) { return []; }
}

function findBufferedDomains(): string[] {
  try {
    return readdirSync(LOCK_DIR)
      .filter(f => f.startsWith("domain-buffer-") && f.endsWith(".jsonl"))
      .map(f => f.replace("domain-buffer-", "").replace(".jsonl", ""))
      .filter(d => getBufferCount(d) > 0);
  } catch (e) { return []; }
}

function formatBufferFlush(entries: BufferEntry[]): string {
  const lines = entries.map((e, i) => {
    const time = new Date(e.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    return `[${i + 1}] ${time} —  ${e.text}`;
  });
  return `📨 バッファ済みメッセージ (${entries.length}件):\n${lines.join("\n")}\n\n以上を踏まえて対応してください。`;
}

function execRelay(
  domain: string,
  message: string,
  onResponding?: () => Promise<void>,
  timeoutMs = 270000
): Promise<string | null> {
  return new Promise((resolve) => {
    const scriptPath = `${process.env.HOME}/claude-telegram-bot/scripts/domain-relay.sh`;
    const child = spawn("bash", [scriptPath, "--domain", domain, message], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
    });
    let stdout = "";
    let respondingFired = false;
    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (!respondingFired && (stdout.includes("WT:") || stdout.includes("Injected"))) {
        respondingFired = true;
        onResponding?.().catch(() => {});
      }
    });
    child.stderr.on("data", () => {});
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(null); }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      const match = stdout.match(/^RESPONSE: ([\s\S]+)$/m);
      resolve(match ? match[1].trim() : null);
    });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}


/**
 * Poll Chrome tab directly after relay timeout.
 * Claude may still be generating — wait up to maxMs for READY.
 */
async function pollTabUntilReady(maxMs = 300_000): Promise<string | null> {
  const { execSync } = await import("child_process");
  const TAB_MANAGER = `${process.env.HOME}/claude-telegram-bot/scripts/croppy-tab-manager.sh`;
  const wt = (() => { try { return readFileSync("/tmp/domain-relay-wt", "utf-8").trim(); } catch(e) { return "1:1"; } })();

  const start = Date.now();
  let readyCount = 0;
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 5000));
    // Keep relay lock fresh during polling
    try { writeFileSync(GLOBAL_RELAY_LOCK, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), domain: "poll" })); } catch(e) {}
    try {
      const status = execSync(`bash ${TAB_MANAGER} check-status ${wt} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
      if (status === "TOOL_LIMIT") {
        try { execSync(`bash ${TAB_MANAGER} auto-continue ${wt} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }); } catch(e) {}
        readyCount = 0;
        continue;
      }
      if (status === "READY") {
        readyCount++;
        if (readyCount >= 2) {
          await new Promise(r => setTimeout(r, 2000)); // settle
          const response = execSync(`bash ${TAB_MANAGER} read-response ${wt} 2>/dev/null`, { encoding: "utf-8", timeout: 10000 }).trim();
          if (response && !response.includes("NO_RESPONSE") && !response.includes("ERROR") && response.length > 20) {
            console.log(`[Buffer] Late response: ${response.length} chars after ${Math.round((Date.now() - start) / 1000)}s`);
            return response;
          }
          return null;
        }
      } else {
        readyCount = 0;
      }
    } catch(e) { /* check-status failed, continue */ }
  }
  console.log("[Buffer] Late response: gave up after " + Math.round(maxMs / 1000) + "s");
  return null;
}


export async function relayDomain(

const TRIAGE_WT_FILE = "/tmp/domain-triage-wt";

/**
 * Triage-specific relay: uses dedicated tab (no global lock conflict).
 * Triage has its own tab (1:2) separate from domain relay (1:1).
 */
export async function triageRelay(
  domain: string,
  message: string,
  timeoutMs = 180000
): Promise<string | null> {
  const scriptPath = `${process.env.HOME}/claude-telegram-bot/scripts/domain-relay.sh`;
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, "--domain", domain, "--wt-file", TRIAGE_WT_FILE, message], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
    });
    let stdout = "";
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", () => {});
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(null); }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      const match = stdout.match(/^RESPONSE: ([\s\S]+)$/m);
      resolve(match ? match[1].trim() : null);
    });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

  domain: string,
  message: string,
  onResponding?: () => Promise<void>,
  timeoutMs = 270000
): Promise<string | "BUFFERED" | null> {
  // 1. Check per-domain handoff lock
  const handoffLock = getLock(domain);
  if (handoffLock && handoffLock.type === "handoff") {
    const count = getBufferCount(domain);
    if (count >= MAX_BUFFER) return null;
    addToBuffer(domain, message);
    console.log(`[Buffer] ${domain} HANDOFF中, buffered (${count + 1}/${MAX_BUFFER})`);
    return "BUFFERED";
  }

  // 2. Try to acquire global relay tab lock
  if (!acquireGlobalRelayLock(domain)) {
    const lock = getGlobalRelayLock();
    const count = getBufferCount(domain);
    if (count >= MAX_BUFFER) return null;
    addToBuffer(domain, message);
    console.log(`[Buffer] Relay tab busy (${lock?.domain}), buffered ${domain} (${count + 1}/${MAX_BUFFER})`);
    return "BUFFERED";
  }

  // 3. We own the relay tab
  try {
    const response = await execRelay(domain, message, onResponding, timeoutMs);

    // If relay timed out, poll tab directly (Claude may still be generating)
    if (response === null) {
      console.log(`[Buffer] Relay timeout for ${domain}, polling tab for late response...`);
      const lateResponse = await pollTabUntilReady(300_000);
      if (lateResponse) {
        // Got late response — proceed as normal
        let combinedResponse: string | null = lateResponse;
        const buffered = drainBuffer(domain);
        if (buffered.length > 0) {
          console.log(`[Buffer] Flushing ${buffered.length} buffered messages to ${domain}`);
          const flushMsg = formatBufferFlush(buffered);
          const flushResponse = await execRelay(domain, flushMsg, undefined, timeoutMs);
          if (flushResponse) combinedResponse += "\n\n─── バッファ分応答 ───\n" + flushResponse;
        }
        return combinedResponse;
      }
    }

    // 4. Drain THIS domain's buffer
    let combinedResponse = response;
    const buffered = drainBuffer(domain);
    if (buffered.length > 0) {
      console.log(`[Buffer] Flushing ${buffered.length} buffered messages to ${domain}`);
      const flushMsg = formatBufferFlush(buffered);
      const flushResponse = await execRelay(domain, flushMsg, undefined, timeoutMs);
      if (flushResponse) {
        combinedResponse = (response || "") + "\n\n─── バッファ分応答 ───\n" + flushResponse;
      }
    }

    // 5. Process other domains' buffered messages
    const otherDomains = findBufferedDomains();
    for (const otherDomain of otherDomains) {
      const otherBuffered = drainBuffer(otherDomain);
      if (otherBuffered.length > 0) {
        console.log(`[Buffer] Sequential flush: ${otherBuffered.length} messages to ${otherDomain}`);
        const flushMsg = formatBufferFlush(otherBuffered);
        await execRelay(otherDomain, flushMsg, undefined, timeoutMs);
      }
    }

    return combinedResponse;
  } finally {
    releaseGlobalRelayLock();
  }
}
