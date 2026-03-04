/**
 * Memory Extractor v2
 *
 * 会話からfacts/preferences/projects/decisionsを自動抽出し、
 * D1 + ベクトルDBに保存する。
 *
 * 既存のlearned-memory.ts（regex方式）を補完・強化する。
 * AI駆動抽出で、regexでは捉えられない暗黙の情報も取得。
 *
 * 実行タイミング: 応答送信後、BgTaskManager経由で非同期
 */

import { spawn } from 'node:child_process';
import { ulid } from 'ulidx';
import {
  upsertProfile,
  upsertProject,
  saveConversationSummary,
  storeEmbedding,
} from './jarvis-memory';

const EXTRACTION_TIMEOUT = 60_000; // 30s
const MIN_MESSAGE_LENGTH = 20; // 短すぎるメッセージはスキップ

interface ExtractionResult {
  facts: Array<{ key: string; value: string; category: string; confidence: number }>;
  projects: Array<{ id: string; name: string; goals?: string; status?: string; decisions?: string[] }>;
  summary: string;
  topics: string[];
  decisions: string[];
}

/**
 * Claude CLIを使って会話から構造化情報を抽出
 */
async function extractWithClaude(
  userMessage: string,
  assistantResponse: string
): Promise<ExtractionResult | null> {
  const prompt = `以下の会話から情報を抽出してJSON形式で返せ。前置き不要、JSONのみ。

<conversation>
User: ${userMessage.substring(0, 2000)}
Assistant: ${assistantResponse.substring(0, 2000)}
</conversation>

以下のJSON形式で返せ:
{
  "facts": [{"key": "英語キー", "value": "値", "category": "identity|work|tech|rules|preferences", "confidence": 0.0-1.0}],
  "projects": [{"id": "snake_case_id", "name": "名前", "goals": "目標", "status": "active|done", "decisions": ["決定事項"]}],
  "summary": "この会話の1-2文要約",
  "topics": ["トピック1", "トピック2"],
  "decisions": ["この会話で決まったこと"]
}

ルール:
- factsは新しい事実のみ（「DJの名前は松岡」のような既知情報は不要）
- 確信度の低い推測は含めない (confidence < 0.5 は除外)
- 雑談・挨拶からは何も抽出しない（空配列を返す）
- summaryは必ず日本語
- JSON以外は出力しない`;

  return new Promise((resolve) => {
    const child = spawn('/opt/homebrew/bin/claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve(null);
      }
    }, EXTRACTION_TIMEOUT);

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (code !== 0) {
        console.error('[Memory Extractor] Claude CLI failed:', code, 'stderr:', stderr.substring(0, 300));
        resolve(null);
        return;
      }

      try {
        console.log('[Memory Extractor] Raw output length:', stdout.length, 'first 100:', stdout.substring(0, 100));
        // Strip markdown code fences if present
        let cleaned = stdout.trim();
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const result = JSON.parse(cleaned);
        resolve(result as ExtractionResult);
      } catch (e) {
        console.error('[Memory Extractor] JSON parse failed:', (e as Error).message);
        console.error('[Memory Extractor] Raw output:', stdout.substring(0, 500));
        resolve(null);
      }
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/**
 * 抽出結果をD1 + ベクトルDBに保存
 */
async function storeExtractionResults(
  result: ExtractionResult,
  userMessage: string,
  conversationId: string
): Promise<{ facts: number; projects: number; embedded: boolean }> {
  let factsStored = 0;
  let projectsStored = 0;

  // 1. Facts → user_profile
  for (const fact of result.facts || []) {
    if (fact.confidence >= 0.6 && fact.key && fact.value) {
      try {
        await upsertProfile(fact.key, fact.value, fact.category || 'general', fact.confidence);
        factsStored++;
      } catch (e) {
        console.error('[Memory Extractor] Fact store failed:', fact.key, e);
      }
    }
  }

  // 2. Projects → jarvis_projects
  for (const proj of result.projects || []) {
    if (proj.id && proj.name) {
      try {
        await upsertProject(proj.id, proj.name, {
          goals: proj.goals,
          decisions: proj.decisions,
          status: proj.status,
        });
        projectsStored++;
      } catch (e) {
        console.error('[Memory Extractor] Project store failed:', proj.id, e);
      }
    }
  }

  // 3. Summary → conversation_summaries
  if (result.summary) {
    try {
      await saveConversationSummary(
        conversationId,
        result.summary,
        result.topics || [],
        result.decisions || [],
        (result.facts || []).map(f => `${f.key}: ${f.value}`)
      );
    } catch (e) {
      console.error('[Memory Extractor] Summary store failed:', e);
    }
  }

  // 4. Embedding → vector DB
  let embedded = false;
  const textToEmbed = [
    result.summary || '',
    ...(result.topics || []),
    ...(result.decisions || []),
    userMessage.substring(0, 500),
  ].filter(Boolean).join(' | ');

  if (textToEmbed.length > 20) {
    try {
      embedded = await storeEmbedding(
        conversationId,
        'conversation',
        textToEmbed,
        {
          topics: result.topics,
          has_decisions: (result.decisions || []).length > 0,
        }
      );
    } catch (e) {
      console.warn('[Memory Extractor] Embedding failed (server down?):', (e as Error).message);
    }
  }

  return { facts: factsStored, projects: projectsStored, embedded };
}

/**
 * メインエントリポイント: 会話後のメモリ抽出+保存
 * post-process.ts から BgTaskManager 経由で呼ばれる
 */
export async function extractAndStoreMemories(
  userId: number | string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  // 短すぎるメッセージはスキップ
  if (userMessage.length < MIN_MESSAGE_LENGTH && assistantResponse.length < MIN_MESSAGE_LENGTH) {
    return;
  }

  // コマンド（/で始まる）はスキップ
  if (userMessage.trim().startsWith('/')) {
    return;
  }

  const conversationId = `conv_${ulid()}`;
  const start = Date.now();

  console.log('[Memory Extractor] Starting extraction...');

  // AI抽出
  const result = await extractWithClaude(userMessage, assistantResponse);
  if (!result) {
    console.log('[Memory Extractor] No extraction result (timeout or error)');
    return;
  }

  // 保存
  const stored = await storeExtractionResults(result, userMessage, conversationId);
  const elapsed = Date.now() - start;

  console.log(
    `[Memory Extractor] Done in ${elapsed}ms: facts=${stored.facts} projects=${stored.projects} embedded=${stored.embedded} summary=${result.summary ? 'yes' : 'no'}`
  );
}
