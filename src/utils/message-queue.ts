/**
 * message-queue.ts — G5: Local message queue for failed Chrome injects
 *
 * When inject fails (tab busy/dead/Chrome not running),
 * messages are saved here and retried on next successful route.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { loadJsonFile } from "./json-loader";
import { homedir } from "os";
import { join } from "path";

const QUEUE_DIR = join(homedir(), ".jarvis/orchestrator");
const QUEUE_FILE = join(QUEUE_DIR, "message-queue.json");
const MAX_QUEUE_SIZE = 50;
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

interface QueuedMessage {
  id: string;
  text: string;
  source: string;
  senderHint?: string;
  projectId: string;
  queuedAt: string;
  retries: number;
  lastError: string;
}

function ensureDir(): void {
  if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true });
}

function loadQueue(): QueuedMessage[] {
  return loadJsonFile<QueuedMessage[]>(QUEUE_FILE, []);
}

function saveQueue(queue: QueuedMessage[]): void {
  ensureDir();
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
}

/**
 * Enqueue a message that failed to inject
 */
export function enqueueMessage(opts: {
  text: string;
  source: string;
  senderHint?: string;
  projectId: string;
  error: string;
}): void {
  const queue = loadQueue();

  // Evict expired entries
  const now = Date.now();
  const fresh = queue.filter(
    (m) => now - new Date(m.queuedAt).getTime() < MAX_AGE_MS
  );

  // Add new message
  fresh.push({
    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    text: opts.text,
    source: opts.source,
    senderHint: opts.senderHint,
    projectId: opts.projectId,
    queuedAt: new Date().toISOString(),
    retries: 0,
    lastError: opts.error,
  });

  // Trim to max size (drop oldest)
  const trimmed = fresh.length > MAX_QUEUE_SIZE
    ? fresh.slice(fresh.length - MAX_QUEUE_SIZE)
    : fresh;

  saveQueue(trimmed);
  console.log(`[MsgQueue] Enqueued for ${opts.projectId} (${trimmed.length} in queue)`);
}

/**
 * Dequeue messages for a specific project (for retry)
 */
export function dequeueForProject(projectId: string): QueuedMessage[] {
  const queue = loadQueue();
  const matching = queue.filter((m) => m.projectId === projectId);
  const remaining = queue.filter((m) => m.projectId !== projectId);
  if (matching.length > 0) {
    saveQueue(remaining);
    console.log(`[MsgQueue] Dequeued ${matching.length} for ${projectId}`);
  }
  return matching;
}

/**
 * Get all pending messages (for /audit display)
 */
export function getQueuedMessages(): QueuedMessage[] {
  return loadQueue();
}

/**
 * Mark a retry failure (increment counter)
 */
export function markRetryFailed(id: string, error: string): void {
  const queue = loadQueue();
  const msg = queue.find((m) => m.id === id);
  if (msg) {
    msg.retries += 1;
    msg.lastError = error;
    // Drop if too many retries
    if (msg.retries >= 3) {
      const idx = queue.indexOf(msg);
      queue.splice(idx, 1);
      console.log(`[MsgQueue] Dropped ${id} after ${msg.retries} retries`);
    }
    saveQueue(queue);
  }
}

/**
 * Queue size
 */
export function queueSize(): number {
  return loadQueue().length;
}
