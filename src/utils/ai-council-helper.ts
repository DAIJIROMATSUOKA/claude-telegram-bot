/**
 * AI Council Helper - Jarvis内部から使用するためのヘルパー関数
 */

import { callAICouncil, getMemoryPack } from '../handlers/ai-router';
import type { Api } from 'grammy';

/**
 * Jarvisが内部からAI Councilに相談するヘルパー関数
 *
 * @param bot - Grammy bot instance (optional, required if sendToUser = true)
 * @param chatId - Telegram chat ID
 * @param question - AI Councilに尋ねる質問
 * @param options - オプション設定
 * @returns AI Councilの統合判断結果
 *
 * @example
 * ```typescript
 * const result = await consultAICouncil(
 *   bot.api,
 *   chatId,
 *   "Memory Gateway v1の実装を開始します。まず何から始めるべきか助言をください。"
 * );
 * ```
 */
export async function consultAICouncil(
  bot: Api | null,
  chatId: number,
  question: string,
  options: {
    sendToUser?: boolean; // ユーザーにも通知するか（デフォルト: true）
    includePrefix?: boolean; // "🏛️ AI Council" プレフィックスを付けるか（デフォルト: true）
  } = {}
): Promise<{
  advisorResponses: string;
  summary: string; // 簡潔な要約（Jarvisが判断に使う用）
}> {
  const { sendToUser = true, includePrefix = true } = options;

  try {
    // AI_MEMORYを取得
    const credentialsPath = process.env.GOOGLE_DOCS_CREDENTIALS_PATH || '';
    const documentId = process.env.AI_MEMORY_DOC_ID || '';

    const memoryPack = await getMemoryPack(credentialsPath, documentId);

    // Notification to user (optional)
    if (sendToUser && bot) {
      const prefix = includePrefix ? '🏛️ AI Council\n\n' : '';
      await bot.sendMessage(
        chatId,
        `${prefix}AI Councilに相談中...\n質問: ${question}`
      );
    }

    // Call AI Council
    const councilResult = await callAICouncil(question, memoryPack);

    // Send advisor responses to user
    if (sendToUser && bot) {
      await bot.sendMessage(chatId, councilResult.advisorResponses);
    }

    // Generate summary for Jarvis internal use
    const summary = generateSummary(councilResult.fullResponses);

    return {
      advisorResponses: councilResult.advisorResponses,
      summary,
    };
  } catch (error) {
    console.error('[AI Council Helper] Error:', error);
    throw error;
  }
}

/**
 * AI Councilの応答から簡潔な要約を生成
 */
function generateSummary(
  responses: Array<{ provider: string; content: string; error?: string }>
): string {
  const validResponses = responses.filter((r) => r.content && !r.error);

  if (validResponses.length === 0) {
    return 'AI Councilから有効な応答が得られませんでした。';
  }

  // 各AIの応答から最初の段落または最初の100文字を抽出
  const summaries = validResponses.map((r) => {
    const firstParagraph = r.content.split('\n\n')[0]!;
    const truncated =
      firstParagraph.length > 100
        ? firstParagraph.substring(0, 100) + '...'
        : firstParagraph;
    return `${getProviderName(r.provider)}: ${truncated}`;
  });

  return summaries.join('\n\n');
}

/**
 * プロバイダー名を取得
 */
function getProviderName(provider: string): string {
  switch (provider) {
    case 'gemini':
      return 'ジェミー💎';
    case 'croppy':
      return 'クロッピー🦞';
    case 'gpt':
      return 'チャッピー🧠';
    default:
      return provider;
  }
}

/**
 * AI Councilに簡単に相談するための短縮関数
 * ユーザーへの通知なしで、内部的に相談する
 */
export async function askCouncil(
  question: string,
  chatId?: number
): Promise<string> {
  const credentialsPath = process.env.GOOGLE_DOCS_CREDENTIALS_PATH || '';
  const documentId = process.env.AI_MEMORY_DOC_ID || '';

  const memoryPack = await getMemoryPack(credentialsPath, documentId);
  const result = await callAICouncil(question, memoryPack);

  return generateSummary(result.fullResponses);
}
