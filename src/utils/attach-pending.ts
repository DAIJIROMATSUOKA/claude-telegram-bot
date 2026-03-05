/**
 * Pending attachment store
 * When a user sends a file without a destination, it's held here for 10 minutes.
 * The next /mail, /line, /imsg command picks it up automatically.
 */

import type { TgFileInfo } from "./tg-file";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingEntry {
  info: TgFileInfo;
  ts: number;
}

const store = new Map<number, PendingEntry>();

export function setPendingAttach(userId: number, info: TgFileInfo): void {
  store.set(userId, { info, ts: Date.now() });
}

export function getPendingAttach(userId: number): TgFileInfo | null {
  const entry = store.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return entry.info;
}

export function clearPendingAttach(userId: number): void {
  store.delete(userId);
}
