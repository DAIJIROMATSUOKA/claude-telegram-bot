/**
 * Domain relay buffer system
 * Handles: relay-in-progress buffering + handoff buffering
 */
import { spawn } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync } from "fs";

export const MAX_BUFFER = 10;
const LOCK_DIR = "/tmp";

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

function lockPath(domain: string): string {
  return `${LOCK_DIR}/domain-lock-${domain}.json`;
}

function bufferPath(domain: string): string {
  return `${LOCK_DIR}/domain-buffer-${domain}.jsonl`;
}

export function getLock(domain: string): DomainLock | null {
  try {
    const p = lockPath(domain);
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const age = Date.now() - new Date(data.since).getTime();
    const maxAge = data.type === "handoff" ? 600_000 : 300_000;
    if (age > maxAge) {
      console.log(`[Buffer] Stale ${data.type} lock for ${domain} (${Math.round(age / 1000)}s), removing`);
      try { unlinkSync(p); } catch {}
      return null;
    }
    return data;
  } catch { return null; }
}

function createLock(domain: string, type: "relay" | "handoff"): void {
  writeFileSync(lockPath(domain), JSON.stringify({
    type, pid: process.pid, since: new Date().toISOString(), domain,
  }));
}

function removeLock(domain: string): void {
  try { unlinkSync(lockPath(domain)); } catch {}
}

function addToBuffer(domain: string, text: string, telegramMsgId?: number): number {
  const entry: BufferEntry = {
    ts: new Date().toISOString(),
    text,
    telegram_msg_id: telegramMsgId,
  };
  appendFileSync(bufferPath(domain), JSON.stringify(entry) + "\n");
  return getBufferCount(domain);
}

export function getBufferCount(domain: string): number {
  try {
    const content = readFileSync(bufferPath(domain), "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch { return 0; }
}

function drainBuffer(domain: string): BufferEntry[] {
  const p = bufferPath(domain);
  try {
    if (!existsSync(p)) return [];
    const content = readFileSync(p, "utf-8").trim();
    if (!content) return [];
    const entries = content.split("\n").map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean) as BufferEntry[];
    unlinkSync(p);
    return entries;
  } catch { return []; }
}

function formatBufferFlush(entries: BufferEntry[]): string {
  const lines = entries.map((e, i) => {
    const time = new Date(e.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    return `[${i + 1}] ${time} \u2014 ${e.text}`;
  });
  return `\u{1f4e8} \u30d0\u30c3\u30d5\u30a1\u6e08\u307f\u30e1\u30c3\u30bb\u30fc\u30b8 (${entries.length}\u4ef6):\n${lines.join("\n")}\n\n\u4ee5\u4e0a\u3092\u8e0f\u307e\u3048\u3066\u5bfe\u5fdc\u3057\u3066\u304f\u3060\u3055\u3044\u3002`;
}

// Raw relay execution (no lock management)
function execRelay(
  domain: string,
  message: string,
  onResponding?: () => Promise<void>,
  timeoutMs = 180000
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
 * Main relay function with lock + buffer + flush
 * Returns "BUFFERED" if message was buffered, response string, or null
 */
export async function relayDomain(
  domain: string,
  message: string,
  onResponding?: () => Promise<void>,
  timeoutMs = 180000
): Promise<string | "BUFFERED" | null> {
  // Check lock
  const lock = getLock(domain);
  if (lock) {
    const count = getBufferCount(domain);
    if (count >= MAX_BUFFER) {
      return null; // Buffer full
    }
    addToBuffer(domain, message);
    const label = lock.type === "handoff" ? "HANDOFF\u4e2d" : "\u5fdc\u7b54\u4e2d";
    console.log(`[Buffer] ${domain} ${label}, buffered (${count + 1}/${MAX_BUFFER})`);
    return "BUFFERED";
  }

  // Create lock
  createLock(domain, "relay");

  try {
    // Execute relay
    const response = await execRelay(domain, message, onResponding, timeoutMs);

    // After relay completes, flush buffer
    const buffered = drainBuffer(domain);
    if (buffered.length > 0) {
      console.log(`[Buffer] Flushing ${buffered.length} buffered messages to ${domain}`);
      const flushMsg = formatBufferFlush(buffered);
      const flushResponse = await execRelay(domain, flushMsg, undefined, timeoutMs);
      if (flushResponse) {
        return (response || "") + "\n\n\u2500\u2500\u2500 \u30d0\u30c3\u30d5\u30a1\u5206\u5fdc\u7b54 \u2500\u2500\u2500\n" + flushResponse;
      }
    }

    return response;
  } finally {
    removeLock(domain);
  }
}
