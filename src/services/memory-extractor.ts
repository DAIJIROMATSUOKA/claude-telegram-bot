/**
 * Memory Extractor v2 — Improved Accuracy
 *
 * Gemini CLI で会話から構造化情報を抽出。
 * 改善点:
 *   - 既存プロファイルとの重複排除
 *   - confidence-based routing (high→直接保存, low→pending)
 *   - カテゴリ検証
 *   - ノイズフィルタリング（Gemini deprecation warnings等）
 *   - 日本語最適化プロンプト
 */

import { createLogger } from "../utils/logger";
const log = createLogger("memory-extractor");

import { spawn } from 'node:child_process';
import { ulid } from 'ulidx';
import {
  getProfile,
  routeMemoryByConfidence,
  upsertProject,
  saveConversationSummary,
  storeEmbedding,
} from './jarvis-memory';

const EXTRACTION_TIMEOUT = 60_000;
const MIN_MESSAGE_LENGTH = 20;
const VALID_CATEGORIES = ['identity', 'work', 'tech', 'rules', 'preferences', 'general'];

interface ExtractionResult {
  facts: Array<{ key: string; value: string; category: string; confidence: number }>;
  projects: Array<{ id: string; name: string; goals?: string; status?: string; decisions?: string[] }>;
  summary: string;
  topics: string[];
  decisions: string[];
}

/**
 * Gemini CLI で構造化抽出
 */
async function extractWithGemini(
  userMessage: string,
  assistantResponse: string,
  existingKeys: string[]
): Promise<ExtractionResult | null> {
  const existingKeysStr = existingKeys.length > 0
    ? `\n既存プロファイルキー（これらと重複する情報は抽出しない）:\n${existingKeys.join(', ')}`
    : '';

  const prompt = `DJのTelegram会話からDJに関する新規事実のみ抽出。JSON以外出力禁止。
${existingKeysStr}

<user_message>
${userMessage.substring(0, 2000)}
</user_message>

<assistant_response>
${assistantResponse.substring(0, 1000)}
</assistant_response>

出力形式:
{"facts": [{"key": "english_snake_case", "value": "値", "category": "identity|work|tech|rules|preferences", "confidence": 0.0-1.0}], "projects": [{"id": "snake_case", "name": "名前", "goals": "目標", "status": "active|done"}], "summary": "日本語1文要約", "topics": ["topic"], "decisions": ["決定事項"]}

【最重要ルール — 違反は致命的エラー】
1. DJが自分の言葉で述べた新事実のみ抽出せよ。Assistantの応答内容・過去の話題・技術的説明は絶対に抽出するな
2. Assistant応答はDJの発言を理解する文脈としてのみ使え。Assistantが言及した機能名・コマンド名・技術用語をfactsに入れるな
3. 既存キーと同じ情報は含めるな
4. 雑談・挨拶・コマンド・テスト目的の発言 → 全て空配列を返せ: {"facts":[],"projects":[],"summary":"","topics":[],"decisions":[]}
5. confidence基準: DJが明言した事実=0.9、文脈から推測可能=0.6、曖昧・仮定=0.4
6. categoryは5種限定:
   - identity: 名前、場所、所属（人物情報）
   - work: 会社、顧客、案件、業界（仕事情報）
   - tech: ハードウェア、ソフトウェア、インフラ（技術情報）
   - rules: 「〜禁止」「〜必須」「〜しない」等の制約・ルール
   - preferences: 「〜にして」「〜が好き」「もっと〜」等の好み・スタイル指示
7. keyは英語snake_case、valueは元の言語のまま`;

  return new Promise((resolve) => {
    const child = spawn('/opt/homebrew/bin/gemini', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill('SIGTERM'); } catch {} resolve(null); }
    }, EXTRACTION_TIMEOUT);

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (code !== 0) {
        log.error('[Memory Extractor] Gemini failed:', code, stderr.substring(0, 200));
        resolve(null);
        return;
      }

      try {
        // Filter Gemini noise (DeprecationWarning, Loaded cached credentials, etc.)
        let cleaned = stdout.trim();
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          // Try stripping markdown fences
          cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        } else {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }

        log.info('[Memory Extractor] Raw length:', stdout.length, 'cleaned:', cleaned.substring(0, 80));
        const result = JSON.parse(cleaned);
        resolve(result as ExtractionResult);
      } catch (e) {
        log.error('[Memory Extractor] JSON parse failed:', (e as Error).message);
        log.error('[Memory Extractor] Raw:', stdout.substring(0, 300));
        resolve(null);
      }
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/**
 * 抽出結果を検証・保存
 */
async function storeExtractionResults(
  result: ExtractionResult,
  userMessage: string,
  conversationId: string
): Promise<{ facts: number; pending: number; projects: number; embedded: boolean }> {
  let factsStored = 0;
  let factsPending = 0;
  let projectsStored = 0;

  // 1. Facts → route by confidence (high→profile, low→pending)
  for (const fact of result.facts || []) {
    if (!fact.key || !fact.value || fact.confidence < 0.3) continue;

    // Validate category
    const category = VALID_CATEGORIES.includes(fact.category) ? fact.category : 'general';

    const outcome = await routeMemoryByConfidence(
      fact.key, fact.value, category, fact.confidence, conversationId
    );
    if (outcome === 'stored') factsStored++;
    else if (outcome === 'pending') factsPending++;
  }

  // 2. Projects
  for (const proj of result.projects || []) {
    if (!proj.id || !proj.name) continue;
    try {
      await upsertProject(proj.id, proj.name, {
        goals: proj.goals, decisions: proj.decisions, status: proj.status,
      });
      projectsStored++;
    } catch (e) {
      log.error('[Memory Extractor] Project store failed:', proj.id, e);
    }
  }

  // 3. Summary
  if (result.summary) {
    try {
      await saveConversationSummary(
        conversationId, result.summary, result.topics || [],
        result.decisions || [],
        (result.facts || []).map(f => `${f.key}: ${f.value}`)
      );
    } catch {}
  }

  // 4. Embedding
  let embedded = false;
  const textToEmbed = [
    result.summary || '',
    ...(result.topics || []),
    ...(result.decisions || []),
    userMessage.substring(0, 500),
  ].filter(Boolean).join(' | ');

  if (textToEmbed.length > 20) {
    try {
      embedded = await storeEmbedding(conversationId, 'conversation', textToEmbed, {
        topics: result.topics,
        has_decisions: (result.decisions || []).length > 0,
      });
    } catch {}
  }

  return { facts: factsStored, pending: factsPending, projects: projectsStored, embedded };
}

/**
 * メインエントリ: post-process.ts → BgTaskManager 経由
 */
export async function extractAndStoreMemories(
  userId: number | string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  if (userMessage.length < MIN_MESSAGE_LENGTH && assistantResponse.length < MIN_MESSAGE_LENGTH) return;
  if (userMessage.trim().startsWith('/')) return;

  const conversationId = `conv_${ulid()}`;
  const start = Date.now();
  log.info('[Memory Extractor] Starting extraction...');

  // Get existing profile keys for dedup
  let existingKeys: string[] = [];
  try {
    const profile = await getProfile();
    existingKeys = Object.keys(profile);
  } catch {}

  const result = await extractWithGemini(userMessage, assistantResponse, existingKeys);
  if (!result) {
    log.info('[Memory Extractor] No result (timeout or error)');
    return;
  }

  const stored = await storeExtractionResults(result, userMessage, conversationId);
  const elapsed = Date.now() - start;

  log.info(
    `[Memory Extractor] Done in ${elapsed}ms: facts=${stored.facts} pending=${stored.pending} projects=${stored.projects} embedded=${stored.embedded} summary=${result.summary ? 'yes' : 'no'}`
  );
}
