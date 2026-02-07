/**
 * Learned Memory - DJの指示・好み・修正を自動学習して永続保存
 *
 * ユーザーの会話から「ルール」「好み」「修正」を自動抽出し、
 * Memory Gatewayに保存する。全エージェントが毎回これを読み込むことで
 * 「同じことを二度言わなくていい」を実現する。
 *
 * テーブル: jarvis_learned_memory
 */

import { callMemoryGateway } from '../handlers/ai-router';
import { ulid } from 'ulidx';

export interface LearnedMemory {
  id: string;
  user_id: string;
  category: 'rule' | 'preference' | 'correction' | 'fact' | 'workflow';
  content: string;
  source_message: string;
  confidence: number;
  created_at: string;
  active: number; // 1=active, 0=revoked
}

/**
 * テーブル作成（初回のみ）
 */
export async function ensureLearnedMemoryTable(): Promise<void> {
  try {
    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `CREATE TABLE IF NOT EXISTS jarvis_learned_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        source_message TEXT,
        confidence REAL DEFAULT 0.8,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      )`,
      params: [],
    });
    console.log('[Learned Memory] Table ensured');
  } catch (error) {
    console.error('[Learned Memory] Table creation error:', error);
  }
}

/**
 * ユーザーメッセージから学習すべき内容を自動抽出
 *
 * 以下のパターンを検出:
 * - 明示的な指示: 「〜するな」「〜禁止」「〜使え」「〜にしろ」
 * - 修正: 「違う」「そうじゃない」「〜じゃなくて〜」
 * - 好み: 「〜がいい」「〜の方が好き」「〜にして」
 * - ワークフロー: 「いつも〜」「毎回〜」「必ず〜」
 * - 事実: 「俺は〜」「うちは〜」「このプロジェクトは〜」
 */
export function extractLearnableContent(
  userMessage: string,
  assistantResponse: string
): Array<{ category: LearnedMemory['category']; content: string; confidence: number }> {
  const results: Array<{ category: LearnedMemory['category']; content: string; confidence: number }> = [];
  const msg = userMessage.trim();

  // 1. 明示的なルール・禁止事項
  const rulePatterns = [
    // 禁止系
    { regex: /(?:絶対|必ず)?(.+?)(?:するな|しないで|禁止|やめて|やめろ|使うな)/, category: 'rule' as const, confidence: 0.95 },
    // 命令系
    { regex: /(?:必ず|絶対に|常に)(.+?)(?:しろ|して|すること|使え|使って)/, category: 'rule' as const, confidence: 0.95 },
    // 文体指示
    { regex: /(敬語|丁寧語|タメ口|である調|ですます).*(使え|使うな|禁止|にしろ|にして)/, category: 'rule' as const, confidence: 0.95 },
    // 〜は禁止
    { regex: /(.+?)は(?:禁止|NG|ダメ|使わない|やらない)/, category: 'rule' as const, confidence: 0.9 },
  ];

  for (const { regex, category, confidence } of rulePatterns) {
    const match = msg.match(regex);
    if (match) {
      results.push({ category, content: msg, confidence });
      break; // ルールは1つだけ
    }
  }

  // 2. 修正・訂正
  const correctionPatterns = [
    /(?:違う|そうじゃない|それ違う|間違い|修正して)/,
    /(?:じゃなくて|ではなく|instead of)/i,
    /(?:なにこれ|何これ|は？|はぁ？)/,
  ];

  for (const pattern of correctionPatterns) {
    if (pattern.test(msg)) {
      // 修正の場合、ユーザーメッセージと直前のアシスタント応答のペアで学習
      if (assistantResponse) {
        results.push({
          category: 'correction',
          content: `DJ「${msg}」→ 前回の応答が不適切だった。改善点を記憶。`,
          confidence: 0.85,
        });
      }
      break;
    }
  }

  // 3. 好み
  const preferencePatterns = [
    { regex: /(.+?)(?:がいい|の方がいい|にして|にしてくれ|がいいな)/, confidence: 0.8 },
    { regex: /(.+?)(?:嫌い|嫌だ|好きじゃない|苦手)/, confidence: 0.8 },
    { regex: /(.+?)(?:好き|好む|気に入|推し)/, confidence: 0.75 },
  ];

  for (const { regex, confidence } of preferencePatterns) {
    if (regex.test(msg) && results.length === 0) {
      results.push({ category: 'preference', content: msg, confidence });
      break;
    }
  }

  // 4. ワークフロー
  const workflowPatterns = [
    /(?:いつも|毎回|必ず|毎日|ルーチン|習慣)(.+)/,
    /(?:まず|最初に|その後|次に)(.+?)(?:して|する|やる)/,
  ];

  for (const pattern of workflowPatterns) {
    if (pattern.test(msg) && results.length === 0) {
      results.push({ category: 'workflow', content: msg, confidence: 0.7 });
      break;
    }
  }

  // 5. 事実（自己紹介・プロジェクト情報）
  const factPatterns = [
    /(?:俺は|私は|僕は|うちは|ウチは)(.+)/,
    /(?:このプロジェクトは|このアプリは|このBotは)(.+)/,
  ];

  for (const pattern of factPatterns) {
    if (pattern.test(msg) && results.length === 0) {
      results.push({ category: 'fact', content: msg, confidence: 0.7 });
      break;
    }
  }

  // 6. もっと深い検出: 「もう嫌だ」「何度も言ってる」系 = 最重要ルール
  const frustrationPatterns = [
    /(?:もう嫌|何度も|毎回|もうやだ|いい加減)(.+)/,
    /(?:覚えて|忘れるな|覚えろ|記憶して)(.+)?/,
  ];

  for (const pattern of frustrationPatterns) {
    const match = msg.match(pattern);
    if (match) {
      results.push({
        category: 'rule',
        content: `【重要】${msg}`,
        confidence: 1.0,
      });
      break;
    }
  }

  return results;
}

/**
 * 学習内容をMemory Gatewayに保存
 */
export async function saveLearnedMemory(
  userId: string | number,
  items: Array<{ category: LearnedMemory['category']; content: string; confidence: number }>,
  sourceMessage: string
): Promise<void> {
  const userIdStr = String(userId);

  for (const item of items) {
    try {
      // 重複チェック: 同じ内容が既にあるか
      const existing = await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `SELECT id FROM jarvis_learned_memory
              WHERE user_id = ? AND content = ? AND active = 1`,
        params: [userIdStr, item.content],
      });

      if (existing.data?.results?.length > 0) {
        console.log('[Learned Memory] Duplicate skipped:', item.content.slice(0, 50));
        continue;
      }

      const id = ulid();
      await callMemoryGateway('/v1/db/query', 'POST', {
        sql: `INSERT INTO jarvis_learned_memory (id, user_id, category, content, source_message, confidence, active)
              VALUES (?, ?, ?, ?, ?, ?, 1)`,
        params: [id, userIdStr, item.category, item.content, sourceMessage.slice(0, 500), item.confidence],
      });

      console.log(`[Learned Memory] Saved: [${item.category}] ${item.content.slice(0, 80)}`);
    } catch (error) {
      console.error('[Learned Memory] Save error:', error);
    }
  }
}

/**
 * ユーザーの学習済みメモリを取得（2秒タイムアウト付き）
 */
export async function getLearnedMemories(
  userId: string | number,
  limit: number = 30
): Promise<LearnedMemory[]> {
  try {
    const userIdStr = String(userId);

    const timeoutPromise = new Promise<{ error: string }>((resolve) =>
      setTimeout(() => resolve({ error: 'timeout' }), 2000)
    );

    const fetchPromise = callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, user_id, category, content, source_message, confidence, created_at, active
            FROM jarvis_learned_memory
            WHERE user_id = ? AND active = 1
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?`,
      params: [userIdStr, limit],
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if ('error' in response && response.error) {
      if (response.error === 'timeout') {
        console.warn('[Learned Memory] Fetch timed out (2s)');
      }
      return [];
    }

    if (!('data' in response) || !response.data?.results) {
      return [];
    }

    return response.data.results as LearnedMemory[];
  } catch (error) {
    console.error('[Learned Memory] Fetch error:', error);
    return [];
  }
}

/**
 * 学習メモリをプロンプト用に整形
 */
export function formatLearnedMemoryForPrompt(memories: LearnedMemory[]): string {
  if (memories.length === 0) return '';

  const ruleItems = memories.filter(m => m.category === 'rule');
  const prefItems = memories.filter(m => m.category === 'preference');
  const corrItems = memories.filter(m => m.category === 'correction');
  const factItems = memories.filter(m => m.category === 'fact');
  const workItems = memories.filter(m => m.category === 'workflow');

  const parts: string[] = ['[DJ LEARNED PREFERENCES - これらは過去にDJが教えたルール。絶対に守れ]'];

  if (ruleItems.length > 0) {
    parts.push('ルール:');
    ruleItems.forEach(m => parts.push(`- ${m.content}`));
  }

  if (prefItems.length > 0) {
    parts.push('好み:');
    prefItems.forEach(m => parts.push(`- ${m.content}`));
  }

  if (corrItems.length > 0) {
    parts.push('過去の修正:');
    corrItems.forEach(m => parts.push(`- ${m.content}`));
  }

  if (factItems.length > 0) {
    parts.push('DJについて:');
    factItems.forEach(m => parts.push(`- ${m.content}`));
  }

  if (workItems.length > 0) {
    parts.push('ワークフロー:');
    workItems.forEach(m => parts.push(`- ${m.content}`));
  }

  return parts.join('\n');
}

/**
 * メッセージを処理して学習する（text.tsから呼ぶメイン関数）
 */
export async function processAndLearn(
  userId: string | number,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const items = extractLearnableContent(userMessage, assistantResponse);

    if (items.length > 0) {
      await saveLearnedMemory(userId, items, userMessage);
    }
  } catch (error) {
    console.error('[Learned Memory] Process error:', error);
  }
}
