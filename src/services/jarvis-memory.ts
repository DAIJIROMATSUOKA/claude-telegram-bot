/**
 * JARVIS Memory Service v2 — Full Implementation
 *
 * ハイブリッドメモリ: D1構造化DB + ローカルベクトルRAG
 *
 * Features:
 *   - User Profile (stable facts, manual > extracted)
 *   - Active Projects tracking
 *   - Conversation Summaries
 *   - Vector semantic search (local embed server)
 *   - Pending Memory (low-confidence → DJ approval)
 *   - Conflict Resolution (manual > extracted, higher confidence wins)
 *   - Vector GC (age + cap)
 *   - Delete operations for /forget command
 */

import { createLogger } from "../utils/logger";
const log = createLogger("jarvis-memory");

import { callMemoryGateway } from '../handlers/ai-router';

import { EMBED_SERVER, EMBED_TIMEOUT, PENDING_CONFIDENCE_THRESHOLD } from '../constants';

// ─── D1 Schema Initialization ───

export async function ensureMemoryTables(): Promise<void> {
  const tables = [
    `CREATE TABLE IF NOT EXISTS jarvis_user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      confidence REAL DEFAULT 1.0,
      source TEXT DEFAULT 'extracted',
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS jarvis_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      goals TEXT,
      constraints_json TEXT,
      decisions_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS jarvis_conversation_summaries (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      topics_json TEXT,
      decisions_json TEXT,
      key_facts_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS jarvis_pending_memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'fact',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      confidence REAL DEFAULT 0.5,
      source_conversation TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    try {
      await callMemoryGateway('/v1/db/query', 'POST', { sql, params: [] });
    } catch (e) {
      log.error('[Memory] Table creation failed:', e);
    }
  }
  log.info('[Memory] Tables initialized');
}

// ─── User Profile ───

export async function getProfileFull(): Promise<Array<{key: string; value: string; category: string; source: string; confidence: number}>> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'SELECT key, value, category, source, confidence FROM jarvis_user_profile WHERE confidence >= 0.5 ORDER BY category, key',
      params: [],
    });
    return (res as any)?.data?.results || [];
  } catch (e) {
    log.error('[Memory] getProfileFull failed:', e);
    return [];
  }
}

export async function getProfile(): Promise<Record<string, string>> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'SELECT key, value, source, confidence FROM jarvis_user_profile WHERE confidence >= 0.5 ORDER BY category, key',
      params: [],
    });
    const rows = (res as any)?.data?.results || [];
    const profile: Record<string, string> = {};
    for (const r of rows) profile[r.key] = r.value;
    return profile;
  } catch (e) {
    log.error('[Memory] getProfile failed:', e);
    return {};
  }
}

/**
 * Conflict-aware upsert:
 * - source='manual' always wins over 'extracted'
 * - Same source: higher confidence wins
 */
export async function upsertProfile(
  key: string, value: string, category: string = 'general',
  confidence: number = 0.8, source: string = 'extracted'
): Promise<boolean> {
  if (source === 'extracted') {
    try {
      const existing = await callMemoryGateway('/v1/db/query', 'POST', {
        sql: 'SELECT source, confidence FROM jarvis_user_profile WHERE key = ?',
        params: [key],
      });
      const rows = (existing as any)?.data?.results || [];
      if (rows.length > 0) {
        const ex = rows[0];
        if (ex.source === 'manual') {
          log.info(`[Memory] Skip: ${key} (manual protected)`);
          return false;
        }
        if (ex.confidence > confidence) {
          log.info(`[Memory] Skip: ${key} (confidence ${ex.confidence} > ${confidence})`);
          return false;
        }
      }
    } catch {}
  }

  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: `INSERT INTO jarvis_user_profile (key, value, category, confidence, source, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value, category = excluded.category,
            confidence = excluded.confidence, source = excluded.source,
            updated_at = datetime('now')`,
    params: [key, value, category, confidence, source],
  });
  return true;
}

export async function deleteProfileKey(key: string): Promise<void> {
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: 'DELETE FROM jarvis_user_profile WHERE key = ?', params: [key],
  });
}

// ─── Projects ───

export async function getActiveProjects(): Promise<any[]> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, name, status, goals, constraints_json, decisions_json, updated_at
            FROM jarvis_projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 10`,
      params: [],
    });
    return (res as any)?.data?.results || [];
  } catch (e) {
    log.error('[Memory] getActiveProjects failed:', e);
    return [];
  }
}

export async function upsertProject(
  id: string, name: string,
  fields: { goals?: string; constraints?: string[]; decisions?: string[]; status?: string }
): Promise<void> {
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: `INSERT INTO jarvis_projects (id, name, status, goals, constraints_json, decisions_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            status = COALESCE(excluded.status, status),
            goals = COALESCE(excluded.goals, goals),
            constraints_json = COALESCE(excluded.constraints_json, constraints_json),
            decisions_json = COALESCE(excluded.decisions_json, decisions_json),
            updated_at = datetime('now')`,
    params: [
      id, name, fields.status || 'active', fields.goals || null,
      fields.constraints ? JSON.stringify(fields.constraints) : null,
      fields.decisions ? JSON.stringify(fields.decisions) : null,
    ],
  });
}

export async function deleteProject(id: string): Promise<void> {
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: 'DELETE FROM jarvis_projects WHERE id = ?', params: [id],
  });
}

// ─── Pending Memory ───

export async function addPendingMemory(
  type: string, key: string, value: string, category: string,
  confidence: number, sourceConversation?: string
): Promise<void> {
  const id = `pm_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: `INSERT INTO jarvis_pending_memory (id, type, key, value, category, confidence, source_conversation, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    params: [id, type, key, value, category, confidence, sourceConversation || null],
  });
  log.info(`[Memory] Pending: ${type}/${key} (confidence=${confidence})`);
}

export async function getPendingMemories(): Promise<any[]> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'SELECT id, type, key, value, category, confidence, created_at FROM jarvis_pending_memory ORDER BY created_at DESC LIMIT 20',
      params: [],
    });
    return (res as any)?.data?.results || [];
  } catch { return []; }
}

export async function approvePendingMemory(id: string): Promise<boolean> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'SELECT type, key, value, category, confidence FROM jarvis_pending_memory WHERE id = ?',
      params: [id],
    });
    const rows = (res as any)?.data?.results || [];
    if (rows.length === 0) return false;
    const item = rows[0];
    if (item.type === 'fact' || item.type === 'preference') {
      await upsertProfile(item.key, item.value, item.category, Math.max(item.confidence, 0.8), 'approved');
    } else if (item.type === 'project') {
      await upsertProject(item.key, item.value, { status: 'active' });
    }
    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'DELETE FROM jarvis_pending_memory WHERE id = ?', params: [id],
    });
    return true;
  } catch { return false; }
}

export async function rejectPendingMemory(id: string): Promise<boolean> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'DELETE FROM jarvis_pending_memory WHERE id = ?', params: [id],
    });
    return ((res as any)?.data?.meta?.changes || 0) > 0;
  } catch { return false; }
}

/**
 * Route fact to profile or pending based on confidence
 */
export async function routeMemoryByConfidence(
  key: string, value: string, category: string, confidence: number, sourceConversation?: string
): Promise<'stored' | 'pending' | 'skipped'> {
  // Preferences/rules bypass pending — behavioral directives apply immediately
  if (category === 'preferences' || category === 'rules') {
    if (confidence >= 0.5) {
      const stored = await upsertProfile(key, value, category, confidence, 'extracted');
      return stored ? 'stored' : 'skipped';
    }
    return 'skipped';
  }
  if (confidence >= PENDING_CONFIDENCE_THRESHOLD) {
    const stored = await upsertProfile(key, value, category, confidence, 'extracted');
    return stored ? 'stored' : 'skipped';
  } else if (confidence >= 0.4) {
    await addPendingMemory('fact', key, value, category, confidence, sourceConversation);
    return 'pending';
  }
  return 'skipped';
}

// ─── Conversation Summaries ───

export async function saveConversationSummary(
  id: string, summary: string, topics: string[], decisions: string[], keyFacts: string[]
): Promise<void> {
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: `INSERT OR REPLACE INTO jarvis_conversation_summaries
          (id, summary, topics_json, decisions_json, key_facts_json, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    params: [id, summary, JSON.stringify(topics), JSON.stringify(decisions), JSON.stringify(keyFacts)],
  });
}

export async function getRecentSummaries(limit: number = 5): Promise<any[]> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT summary, topics_json, decisions_json, key_facts_json, created_at
            FROM jarvis_conversation_summaries ORDER BY created_at DESC LIMIT ?`,
      params: [limit],
    });
    return (res as any)?.data?.results || [];
  } catch { return []; }
}

// ─── Vector Search ───

async function embedServerCall(path: string, body: any): Promise<any> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT);
    const res = await fetch(`${EMBED_SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    console.warn('[Memory] Embed server unreachable:', (e as Error).message);
    return null;
  }
}

export async function storeEmbedding(
  sourceId: string, sourceType: string, text: string, metadata?: Record<string, any>
): Promise<boolean> {
  const result = await embedServerCall('/store', {
    chunks: [{ source_id: sourceId, source_type: sourceType, text, metadata }],
  });
  return result?.stored > 0;
}

export async function searchMemories(
  query: string, topK: number = 5, sourceType?: string
): Promise<Array<{ text: string; score: number; source_id: string; metadata: any }>> {
  const result = await embedServerCall('/search', {
    query, top_k: topK, source_type: sourceType, min_score: 0.35,
  });
  return result?.results || [];
}

// ─── GC Functions ───

export async function runVectorGC(maxAgeDays: number = 90, maxEntries: number = 5000): Promise<number> {
  try {
    const res = await fetch(`${EMBED_SERVER}/gc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_age_days: maxAgeDays, max_entries: maxEntries }),
    });
    const data = await res.json() as any;
    return data?.deleted || 0;
  } catch { return 0; }
}

export async function runSummaryGC(maxDays: number = 180): Promise<number> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_conversation_summaries WHERE created_at < datetime('now', ?)`,
      params: [`-${maxDays} days`],
    });
    return (res as any)?.data?.meta?.changes || 0;
  } catch { return 0; }
}

export async function runPendingGC(maxDays: number = 30): Promise<number> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_pending_memory WHERE created_at < datetime('now', ?)`,
      params: [`-${maxDays} days`],
    });
    return (res as any)?.data?.meta?.changes || 0;
  } catch { return 0; }
}

// ─── Context Builder ───

export async function buildMemoryContext(userMessage: string): Promise<string> {
  const start = Date.now();
  const parts: string[] = [];

  const [_, projects, vectorResults, summaries, pending] = await Promise.all([
    Promise.resolve(null),
    getActiveProjects(),
    searchMemories(userMessage, 3),
    getRecentSummaries(3),
    getPendingMemories(),
  ]);

  // Split profile into facts vs preferences/rules
  const profileFull = await getProfileFull();
  const facts: string[] = [];
  const prefs: string[] = [];
  for (const r of profileFull) {
    const line = `- ${r.key}: ${r.value}`;
    if (r.category === 'preferences' || r.category === 'rules') {
      prefs.push(line);
    } else {
      facts.push(line);
    }
  }
  if (facts.length > 0) {
    parts.push(`[DJ PROFILE]\n${facts.join('\n')}`);
  }
  if (prefs.length > 0) {
    parts.push(`[DJ PREFERENCES — Jarvisはこれに従え]\n${prefs.join('\n')}`);
  }

  if (projects.length > 0) {
    parts.push(`[ACTIVE PROJECTS]\n${projects.map((p: any) => {
      let line = `- ${p.name} (${p.status})`;
      if (p.goals) line += `: ${p.goals}`;
      return line;
    }).join('\n')}`);
  }

  if (vectorResults.length > 0) {
    parts.push(`[RELEVANT PAST CONTEXT]\n${vectorResults.map(r => `- [${r.score.toFixed(2)}] ${r.text.substring(0, 300)}`).join('\n')}`);
  }

  if (summaries.length > 0) {
    parts.push(`[RECENT CONVERSATIONS]\n${summaries.map((s: any) => {
      const topics = s.topics_json ? JSON.parse(s.topics_json).join(', ') : '';
      return `- ${s.created_at}: ${s.summary.substring(0, 200)}${topics ? ` [${topics}]` : ''}`;
    }).join('\n')}`);
  }

  if (pending.length > 0) {
    parts.push(`[PENDING MEMORIES: ${pending.length}件 — DJに /memory pending を促せ]`);
  }

  const elapsed = Date.now() - start;
  log.info(`[Memory] Context built in ${elapsed}ms: facts=${facts.length} prefs=${prefs.length} projects=${projects.length} vectors=${vectorResults.length} summaries=${summaries.length} pending=${pending.length}`);

  return parts.length === 0 ? '' : parts.join('\n\n') + '\n';
}

// ─── Seed Profile ───

export async function seedDJProfile(): Promise<void> {
  const seeds: Array<[string, string, string]> = [
    ['name', '松岡大次郎（DJ）', 'identity'],
    ['company', 'キカイラボ（株式会社機械ラボ）CEO', 'identity'],
    ['domain', 'FA設計エンジニアリング・食品機械', 'work'],
    ['ai_philosophy', '1行投げて何もしない', 'preferences'],
    ['cost_constraint', '従量課金API絶対禁止', 'rules'],
    ['time_cost', '¥100K/時', 'rules'],
    ['response_style', '最小限・簡潔・スキャン可能', 'preferences'],
    ['brand_principle', 'DOGFOODING FIRST', 'work'],
    ['key_clients', 'Primaham, 伊藤ハム米久プラント', 'work'],
    ['location', '柏（千葉県）', 'identity'],
  ];
  for (const [key, value, category] of seeds) {
    await upsertProfile(key, value, category, 1.0, 'manual');
  }
  log.info('[Memory] DJ profile seeded');
}
