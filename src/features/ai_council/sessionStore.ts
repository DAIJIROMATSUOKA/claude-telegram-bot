/**
 * In-memory TTL session store for AI Council
 *
 * Sessions expire after TTL (default 6 hours).
 */

import type { CouncilSession } from "./types";

const sessions = new Map<string, CouncilSession>();

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Create a new council session.
 */
export function createSession(
  chatId: number,
  theme: string,
  agents: string[],
  maxRounds: number
): CouncilSession {
  const id = `council_${chatId}_${Date.now()}`;
  const now = new Date();

  const session: CouncilSession = {
    id,
    chat_id: chatId,
    round: 1,
    max_rounds: maxRounds,
    agents,
    transcript: [],
    theme,
    created_at: now,
    updated_at: now,
    ttl: new Date(now.getTime() + DEFAULT_TTL_MS),
  };

  sessions.set(id, session);
  cleanupExpiredSessions();

  return session;
}

/**
 * Get a session by ID.
 */
export function getSession(id: string): CouncilSession | undefined {
  cleanupExpiredSessions();
  return sessions.get(id);
}

/**
 * Get active session for a chat.
 */
export function getActiveSession(chatId: number): CouncilSession | undefined {
  cleanupExpiredSessions();

  // Find the most recent session for this chat
  let activeSession: CouncilSession | undefined;
  let latestTime = 0;

  for (const session of sessions.values()) {
    if (
      session.chat_id === chatId &&
      session.updated_at.getTime() > latestTime
    ) {
      activeSession = session;
      latestTime = session.updated_at.getTime();
    }
  }

  return activeSession;
}

/**
 * Update a session.
 */
export function updateSession(session: CouncilSession): void {
  session.updated_at = new Date();
  sessions.set(session.id, session);
}

/**
 * Delete a session.
 */
export function deleteSession(id: string): void {
  sessions.delete(id);
}

/**
 * Delete all sessions for a chat.
 */
export function deleteSessionsForChat(chatId: number): void {
  for (const [id, session] of sessions.entries()) {
    if (session.chat_id === chatId) {
      sessions.delete(id);
    }
  }
}

/**
 * Remove expired sessions.
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();

  for (const [id, session] of sessions.entries()) {
    if (session.ttl.getTime() < now) {
      sessions.delete(id);
    }
  }
}

/**
 * Get all active sessions (for debugging).
 */
export function getAllSessions(): CouncilSession[] {
  cleanupExpiredSessions();
  return Array.from(sessions.values());
}
