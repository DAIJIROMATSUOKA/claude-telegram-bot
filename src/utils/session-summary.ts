/**
 * Session Summary - セッション要約の自動生成・保存・読み込み
 *
 * セッション中の会話から要約を自動生成し、
 * 次回セッション開始時に注入することで文脈を引き継ぐ。
 *
 * テーブル: jarvis_session_summaries
 */

import { callMemoryGateway } from '../handlers/ai-router';
import { ulid } from 'ulidx';

/**
 * 会話履歴をコンパクトに整形（各メッセージ最大500文字、最大30件）
 */
function buildCompactHistory(
  messages: Array<{ role: string; content: string; timestamp: string }>
): string {
  return messages
    .slice(-30)
    .map(m => {
      const role = m.role === 'user' ? 'DJ' : 'Jarvis';
      const content = m.content.slice(0, 500);
      return `[${role}] ${content}`;
    })
    .join('\n');
}

/**
 * AI要約用のプロンプトを構築
 */
function buildSummaryPrompt(compactHistory: string): string {
  return `以下はDJ（ユーザー）とJarvis（AIアシスタント）の会話履歴だ。
これを次回セッションで使える形に要約しろ。

## 出力フォーマット（JSON）
{
  "summary": "何をしていたかの要約（200文字以内）",
  "topics": ["トピック1", "トピック2"],
  "key_decisions": ["決定事項1", "決定事項2"],
  "unfinished_tasks": ["未完了1", "未完了2"]
}

## ルール
- 日本語で書け
- 技術的な文脈（ファイル名、コマンド、設計判断）を保持しろ
- 感想や挨拶は省け
- JSON以外の出力は不要

## 会話履歴
${compactHistory}`;
}

export interface SessionSummary {
  id: string;
  user_id: string;
  session_id: string;
  summary: string;
  topics: string;
  key_decisions: string;
  unfinished_tasks: string;
  created_at: string;
}

/**
 * テーブル作成（初回のみ）
 */
export async function ensureSessionSummaryTable(): Promise<void> {
  try {
    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `CREATE TABLE IF NOT EXISTS jarvis_session_summaries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        summary TEXT NOT NULL,
        topics TEXT,
        key_decisions TEXT,
        unfinished_tasks TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      params: [],
    });
    console.log('[Session Summary] Table ensured');
  } catch (error) {
    console.error('[Session Summary] Table creation error:', error);
  }
}

/**
 * 会話履歴からセッション要約を生成（ローカルで処理、API不使用）
 *
 * Gemini等を使わず、ルールベースで要約を作る。
 * - ユーザーメッセージからトピックを抽出
 * - コマンドや決定事項を検出
 * - 未完了タスクを推定
 */
export function generateSessionSummary(
  messages: Array<{ role: string; content: string; timestamp: string }>
): {
  summary: string;
  topics: string[];
  keyDecisions: string[];
  unfinishedTasks: string[];
} {
  const topics = new Set<string>();
  const keyDecisions: string[] = [];
  const unfinishedTasks: string[] = [];
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      userMessages.push(msg.content);

      // トピック抽出: コマンドや主要な話題
      if (msg.content.startsWith('/')) {
        topics.add(`コマンド: ${msg.content.split(' ')[0]}`);
      }
      if (/タスク|task/i.test(msg.content)) topics.add('タスク管理');
      if (/コード|code|実装|implement/i.test(msg.content)) topics.add('コーディング');
      if (/設計|design|architect/i.test(msg.content)) topics.add('設計');
      if (/バグ|bug|エラー|error|fix/i.test(msg.content)) topics.add('デバッグ');
      if (/テスト|test/i.test(msg.content)) topics.add('テスト');
      if (/デプロイ|deploy|リリース|release/i.test(msg.content)) topics.add('デプロイ');
      if (/状況|ステータス|status/i.test(msg.content)) topics.add('状況確認');
      if (/記憶|memory|覚え/i.test(msg.content)) topics.add('記憶・コンテキスト');
      if (/imagine|animate|画像|image/i.test(msg.content)) topics.add('画像生成');
    } else {
      assistantMessages.push(msg.content);

      // 決定事項の検出
      const decisionMatch = msg.content.match(/(?:決定|決まった|Decision|decided)[:：]\s*(.+)/i);
      if (decisionMatch && decisionMatch[1]) {
        keyDecisions.push(decisionMatch[1].trim().slice(0, 200));
      }

      // Phase完了の検出
      const phaseMatch = msg.content.match(/Phase\s*\d+.*?(?:完了|complete)/i);
      if (phaseMatch) {
        keyDecisions.push(phaseMatch[0]);
      }
    }
  }

  // 未完了タスク: 最後のアシスタントメッセージから推定
  const lastAssistant = assistantMessages[assistantMessages.length - 1] || '';
  const todoMatch = lastAssistant.match(/(?:次[はに]|TODO|残り|未完了|next)[:：]?\s*(.+)/i);
  if (todoMatch && todoMatch[1]) {
    unfinishedTasks.push(todoMatch[1].trim().slice(0, 200));
  }

  // 要約の生成
  const topicList = Array.from(topics);
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const timeRange = firstMsg && lastMsg
    ? `${firstMsg.timestamp.slice(0, 16)} ~ ${lastMsg.timestamp.slice(0, 16)}`
    : '不明';

  const summaryParts: string[] = [];
  summaryParts.push(`期間: ${timeRange}`);
  summaryParts.push(`メッセージ数: ${messages.length}件`);
  if (topicList.length > 0) {
    summaryParts.push(`トピック: ${topicList.join(', ')}`);
  }

  // 主要なユーザーメッセージを要約に含める（最大5件、各100文字）
  const importantUserMsgs = userMessages
    .filter(m => m.length > 10 && !m.startsWith('/'))
    .slice(-5)
    .map(m => m.slice(0, 100));

  if (importantUserMsgs.length > 0) {
    summaryParts.push(`主な会話: ${importantUserMsgs.join(' | ')}`);
  }

  return {
    summary: summaryParts.join('\n'),
    topics: topicList,
    keyDecisions,
    unfinishedTasks,
  };
}

/**
 * Gemini CLIで会話履歴からスマート要約を生成
 *
 * Gemini CLI経由（Google AI Pro定額サブスク）。従量課金ゼロ。
 * 失敗時はルールベース要約にフォールバック。
 */
async function generateSummaryWithGemini(
  messages: Array<{ role: string; content: string; timestamp: string }>
): Promise<{
  summary: string;
  topics: string[];
  keyDecisions: string[];
  unfinishedTasks: string[];
}> {
  try {
    const { askGemini } = await import('./multi-ai');

    const compactHistory = buildCompactHistory(messages);
    const prompt = buildSummaryPrompt(compactHistory);

    const result = await askGemini(prompt, 60_000);

    if (result.error) throw new Error(`Gemini CLI error: ${result.error}`);

    const text = result.output;

    // JSONを抽出（コードブロック内でも対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Gemini response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      topics?: string[];
      key_decisions?: string[];
      unfinished_tasks?: string[];
    };

    console.log('[Session Summary] Gemini CLI summary generated successfully');

    return {
      summary: parsed.summary || '',
      topics: parsed.topics || [],
      keyDecisions: parsed.key_decisions || [],
      unfinishedTasks: parsed.unfinished_tasks || [],
    };
  } catch (error) {
    console.warn('[Session Summary] Gemini CLI failed, falling back to rule-based:', error);
    return generateSessionSummary(messages);
  }
}

/**
 * Claude CLI（クロッピー🦞）で会話要約を生成
 *
 * Claude Codeサブスクで動作（追加課金なし）。
 * Geminiより高品質な要約が可能。
 */
async function generateSummaryWithCroppy(
  messages: Array<{ role: string; content: string; timestamp: string }>
): Promise<{
  summary: string;
  topics: string[];
  keyDecisions: string[];
  unfinishedTasks: string[];
}> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs/promises');
  const path = await import('path');
  const execPromise = promisify(exec);

  const compactHistory = buildCompactHistory(messages);
  const prompt = buildSummaryPrompt(compactHistory);

  const tempFile = path.join('/tmp', `croppy-summary-${Date.now()}.txt`);

  try {
    await fs.writeFile(tempFile, prompt, 'utf-8');

    const { stdout } = await execPromise(
      `claude --model claude-opus-4-6 --print < ${tempFile}`,
      {
        timeout: 60000,
        cwd: '/Users/daijiromatsuokam1',
        env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + (process.env.PATH || '') },
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Croppy response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      topics?: string[];
      key_decisions?: string[];
      unfinished_tasks?: string[];
    };

    console.log('[Session Summary] 🦞 Croppy summary generated successfully');

    return {
      summary: parsed.summary || '',
      topics: parsed.topics || [],
      keyDecisions: parsed.key_decisions || [],
      unfinishedTasks: parsed.unfinished_tasks || [],
    };
  } finally {
    try { await fs.unlink(tempFile); } catch {}
  }
}

/**
 * セッション要約をMemory Gatewayに保存
 *
 * 要約生成の優先順: クロッピー🦞 → ジェミー💎 → ルールベース
 */
export async function saveSessionSummary(
  userId: string | number,
  sessionId: string,
  messages: Array<{ role: string; content: string; timestamp: string }>
): Promise<void> {
  if (messages.length < 3) {
    console.log('[Session Summary] Too few messages, skipping summary');
    return;
  }

  try {
    // クロッピー🦞 → ジェミー💎 → ルールベースの順でフォールバック
    let result: { summary: string; topics: string[]; keyDecisions: string[]; unfinishedTasks: string[] };
    try {
      result = await generateSummaryWithCroppy(messages);
    } catch (croppyErr) {
      console.warn('[Session Summary] 🦞 Croppy failed, trying Gemini:', croppyErr);
      result = await generateSummaryWithGemini(messages);
    }
    const { summary, topics, keyDecisions, unfinishedTasks } = result;

    const id = ulid();
    const userIdStr = String(userId);

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `INSERT INTO jarvis_session_summaries (id, user_id, session_id, summary, topics, key_decisions, unfinished_tasks)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        userIdStr,
        sessionId,
        summary,
        topics.join(', '),
        keyDecisions.join('; '),
        unfinishedTasks.join('; '),
      ],
    });

    console.log(`[Session Summary] Saved: ${topics.join(', ')}`);
  } catch (error) {
    console.error('[Session Summary] Save error:', error);
  }
}

/**
 * 直近のセッション要約を取得（2秒タイムアウト付き）
 */
export async function getRecentSessionSummaries(
  userId: string | number,
  limit: number = 5
): Promise<SessionSummary[]> {
  try {
    const userIdStr = String(userId);

    const timeoutPromise = new Promise<{ error: string }>((resolve) =>
      setTimeout(() => resolve({ error: 'timeout' }), 2000)
    );

    const fetchPromise = callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, user_id, session_id, summary, topics, key_decisions, unfinished_tasks, created_at
            FROM jarvis_session_summaries
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      params: [userIdStr, limit],
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if ('error' in response && response.error) {
      if (response.error === 'timeout') {
        console.warn('[Session Summary] Fetch timed out (2s)');
      }
      return [];
    }

    if (!('data' in response) || !response.data?.results) {
      return [];
    }

    return response.data.results as SessionSummary[];
  } catch (error) {
    console.error('[Session Summary] Fetch error:', error);
    return [];
  }
}

/**
 * セッション要約をプロンプト用に整形
 */
export function formatSessionSummariesForPrompt(summaries: SessionSummary[]): string {
  if (summaries.length === 0) return '';

  const parts: string[] = ['[PAST SESSION SUMMARIES - 直近のセッション要約。これを読んで過去の文脈を理解しろ]'];

  for (const s of summaries) {
    parts.push(`--- ${s.created_at} ---`);
    parts.push(s.summary);
    if (s.topics) {
      parts.push(`トピック: ${s.topics}`);
    }
    if (s.key_decisions) {
      parts.push(`決定事項: ${s.key_decisions}`);
    }
    if (s.unfinished_tasks) {
      parts.push(`未完了: ${s.unfinished_tasks}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
