/**
 * Archived Mail Log - lightweight SQLite log of triage archive/delete actions
 *
 * Best-effort logging used by the daily summary script
 * (scripts/daily-archive-summary.ts). Failures are swallowed so they never
 * affect the main archive/delete flow.
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { homedir } from "os";
import { createLogger } from "./logger";

const log = createLogger("archived-mail-log");

const DB_PATH =
  process.env.ARCHIVED_MAIL_LOG_PATH ||
  resolve(homedir(), ".claude/archived_mail_log.db");

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS archived_mail (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        archived_at INTEGER NOT NULL,
        action TEXT NOT NULL,
        sender TEXT,
        subject TEXT,
        reason TEXT,
        gmail_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_archived_at ON archived_mail(archived_at);
    `);
  }
  return db;
}

export interface ArchivedMailEntry {
  action: "archive" | "delete";
  sender: string;
  subject: string;
  reason: string;
  gmailId?: string;
}

export function logArchivedMail(entry: ArchivedMailEntry): void {
  try {
    const d = getDb();
    d.prepare(
      `INSERT INTO archived_mail (archived_at, action, sender, subject, reason, gmail_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      Math.floor(Date.now() / 1000),
      entry.action,
      entry.sender,
      entry.subject,
      entry.reason,
      entry.gmailId || null,
    );
  } catch (e) {
    log.error("logArchivedMail failed (non-fatal):", e);
  }
}
