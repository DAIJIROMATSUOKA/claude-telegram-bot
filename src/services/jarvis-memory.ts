/**
 * JARVIS Memory Service v2
 *
 * ハイブリッドメモリ: D1構造化DB + ローカルベクトルRAG
 * claude.aiのuserMemories相当の文脈をClaude CLIに注入する。
 *
 * Read path (毎ターン):
 *   1. user_profile (D1) - 安定事実
 *   2. active projects (D1) - 現行案件
 *   3. relevant memories (Vector) - 意味検索
 *   4. recent decisions (D1) - 最近の決定事項
 *   5. learned memories (既存) - ルール/好み
 *
 * Write path (応答後非同期):
 *   Memory Extractor が facts/preferences/projects を抽出 → D1更新 + embedding保存
 */

import { callMemoryGateway } from '../handlers/ai-router';

const EMBED_SERVER = process.env.EMBED_SERVER_URL || 'http://127.0.0.1:19823';
const EMBED_TIMEOUT = 5000; // 5s

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
  ];

  for (const sql of tables) {
    try {
      await callMemoryGateway('/v1/db/query', 'POST', { sql, params: [] });
    } catch (e) {
      console.error('[Memory] Table creation failed:', e);
    }
  }
  console.log('[Memory] Tables ensured');
}

// ─── User Profile ───

export async function getProfile(): Promise<Record<string, string>> {
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: 'SELECT key, value FROM jarvis_user_profile WHERE confidence >= 0.5 ORDER BY category, key',
      params: [],
    });
    const rows = (res as any)?.data?.results || [];
    const profile: Record<string, string> = {};
    for (const r of rows) {
      profile[r.key] = r.value;
    }
    return profile;
  } catch (e) {
    console.error('[Memory] getProfile failed:', e);
    return {};
  }
}

export async function upsertProfile(
  key: string,
  value: string,
  category: string = 'general',
  confidence: number = 0.8,
  source: string = 'extracted'
): Promise<void> {
  await callMemoryGateway('/v1/db/query', 'POST', {
    sql: `INSERT INTO jarvis_user_profile (key, value, category, confidence, source, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            category = excluded.category,
            confidence = MAX(confidence, excluded.confidence),
            source = excluded.source,
            updated_at = datetime('now')`,
    params: [key, value, category, confidence, source],
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
    console.error('[Memory] getActiveProjects failed:', e);
    return [];
  }
}

export async function upsertProject(
  id: string,
  name: string,
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
      id, name,
      fields.status || 'active',
      fields.goals || null,
      fields.constraints ? JSON.stringify(fields.constraints) : null,
      fields.decisions ? JSON.stringify(fields.decisions) : null,
    ],
  });
}

// ─── Conversation Summaries ───

export async function saveConversationSummary(
  id: string,
  summary: string,
  topics: string[],
  decisions: string[],
  keyFacts: string[]
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
  } catch (e) {
    console.error('[Memory] getRecentSummaries failed:', e);
    return [];
  }
}

// ─── Vector Search (via Embed Server) ───

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
  sourceId: string,
  sourceType: string,
  text: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const result = await embedServerCall('/store', {
    chunks: [{ source_id: sourceId, source_type: sourceType, text, metadata }],
  });
  return result?.stored > 0;
}

export async function searchMemories(
  query: string,
  topK: number = 5,
  sourceType?: string
): Promise<Array<{ text: string; score: number; source_id: string; metadata: any }>> {
  const result = await embedServerCall('/search', {
    query,
    top_k: topK,
    source_type: sourceType,
    min_score: 0.35,
  });
  return result?.results || [];
}

// ─── Context Builder (毎ターン実行) ───

export async function buildMemoryContext(userMessage: string): Promise<string> {
  const start = Date.now();
  const parts: string[] = [];

  // 1. User Profile
  const profile = await getProfile();
  if (Object.keys(profile).length > 0) {
    const profileLines = Object.entries(profile)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    parts.push(`[DJ PROFILE]\n${profileLines}`);
  }

  // 2. Active Projects
  const projects = await getActiveProjects();
  if (projects.length > 0) {
    const projLines = projects.map((p: any) => {
      let line = `- ${p.name} (${p.status})`;
      if (p.goals) line += `: ${p.goals}`;
      return line;
    }).join('\n');
    parts.push(`[ACTIVE PROJECTS]\n${projLines}`);
  }

  // 3. Vector Search (semantic relevance)
  const vectorResults = await searchMemories(userMessage, 3);
  if (vectorResults.length > 0) {
    const memLines = vectorResults
      .map(r => `- [${r.score.toFixed(2)}] ${r.text.substring(0, 300)}`)
      .join('\n');
    parts.push(`[RELEVANT PAST CONTEXT]\n${memLines}`);
  }

  // 4. Recent Conversation Summaries
  const summaries = await getRecentSummaries(3);
  if (summaries.length > 0) {
    const sumLines = summaries.map((s: any) => {
      const topics = s.topics_json ? JSON.parse(s.topics_json).join(', ') : '';
      return `- ${s.created_at}: ${s.summary.substring(0, 200)}${topics ? ` [${topics}]` : ''}`;
    }).join('\n');
    parts.push(`[RECENT CONVERSATIONS]\n${sumLines}`);
  }

  const elapsed = Date.now() - start;
  console.log(`[Memory] Context built in ${elapsed}ms: profile=${Object.keys(profile).length} projects=${projects.length} vectors=${vectorResults.length} summaries=${summaries.length}`);

  if (parts.length === 0) return '';
  return parts.join('\n\n') + '\n';
}

// ─── Seed Profile (初回セットアップ用) ───

export async function seedDJProfile(): Promise<void> {
  const seeds: Array<[string, string, string]> = [
    ['name', '松岡大次郎（DJ）', 'identity'],
    ['company', 'キカイラボ（株式会社機械ラボ）CEO', 'identity'],
    ['domain', 'FA（ファクトリーオートメーション）設計エンジニアリング・食品機械', 'work'],
    ['ai_philosophy', '1行投げて何もしない。AIが設計・実装・テスト', 'preferences'],
    ['cost_constraint', '従量課金API絶対禁止。フラット料金のみ', 'rules'],
    ['time_cost', '¥100K/時。短いタイムアウトで失敗より長いタイムアウトで成功', 'rules'],
    ['response_style', '最小限・簡潔・スキャン可能。前置き/挨拶/繰り返し禁止', 'preferences'],
    ['brand_principle', 'DOGFOODING FIRST—実際のFA設計業務で使うツールのみ展開', 'work'],
    ['hardware_m1', 'M1 MAX 64GB（mothership）: JARVIS/Poller/ComfyUI/mflux', 'tech'],
    ['hardware_m3', 'M3 MAX 128GB: DJワークステーション', 'tech'],
    ['key_clients', 'Primaham, 伊藤ハム米久プラント', 'work'],
    ['location', '柏（千葉県）', 'identity'],
  ];

  for (const [key, value, category] of seeds) {
    await upsertProfile(key, value, category, 1.0, 'manual');
  }
  console.log('[Memory] DJ profile seeded');
}
