import { Database } from 'bun:sqlite';
import { resolve } from 'path';

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    const dbPath = resolve(process.cwd(), 'jarvis.db');
    db = new Database(dbPath, { create: true });
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}
