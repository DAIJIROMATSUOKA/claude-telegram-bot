/**
 * Croppy Context Manager
 *
 * croppy呼び出し時に文脈を注入
 */

import { createLogger } from "./logger";
const log = createLogger("croppy-context");

import { getJarvisContext, formatContextForPrompt } from './jarvis-context';
import { getChatHistory, formatChatHistoryForPrompt } from './chat-history';
import { getMemoryPack } from '../handlers/ai-router';

/**
 * croppy用の完全な文脈を取得
 *
 * 並列処理で高速化
 */
export async function getCroppyContext(userId: string | number): Promise<{
  context: string;
  history: string;
  aiMemory: string;
  error?: string;
}> {
  const userIdStr = String(userId);

  try {
    // 並列取得で高速化
    const credentialsPath = process.env.GOOGLE_DOCS_CREDENTIALS_PATH || '';
    const documentId = process.env.AI_MEMORY_DOC_ID || '';

    const [context, history, aiMemory] = await Promise.all([
      getJarvisContext(userIdStr),
      getChatHistory(userIdStr, 10),
      getMemoryPack(credentialsPath, documentId).catch(() => '（AI_MEMORY取得失敗）'),
    ]);

    return {
      context: formatContextForPrompt(context),
      history: formatChatHistoryForPrompt(history),
      aiMemory: typeof aiMemory === 'string' ? aiMemory : '（AI_MEMORYなし）',
    };
  } catch (error) {
    log.error('[Croppy Context] 文脈取得エラー:', error);

    // Degraded mode: エラーでも続行
    return {
      context: '（取得失敗）',
      history: '（取得失敗）',
      aiMemory: '（取得失敗）',
      error: String(error),
    };
  }
}

/**
 * croppy用プロンプトを構築
 *
 * @param originalPrompt 元のcroppy:メッセージ
 * @param userId ユーザーID
 * @returns 文脈付きプロンプト
 */
export async function buildCroppyPrompt(
  originalPrompt: string,
  userId: string | number
): Promise<string> {
  const croppyContext = await getCroppyContext(userId);

  let prompt = '';

  // Degraded mode警告
  if (croppyContext.error) {
    prompt += '⚠️ 注意: 一部の文脈取得に失敗しています。この返答は限定的な前提に基づきます。\n\n';
  }

  // 文脈セクション
  prompt += '=== 📋 現在の状態 ===\n';
  prompt += croppyContext.context;
  prompt += '\n\n';

  // 会話履歴セクション
  prompt += '=== 💬 直近の会話（10件） ===\n';
  prompt += croppyContext.history;
  prompt += '\n\n';

  // AI_MEMORYセクション
  if (croppyContext.aiMemory && croppyContext.aiMemory !== '（AI_MEMORYなし）') {
    prompt += '=== 🧠 AI_MEMORY ===\n';
    prompt += croppyContext.aiMemory;
    prompt += '\n\n';
  }

  // ユーザーの質問
  prompt += '=== ❓ DJの質問 ===\n';
  prompt += originalPrompt;

  return prompt;
}

/**
 * croppy: debug 用の文脈表示
 */
export async function formatCroppyDebugOutput(userId: string | number): Promise<string> {
  const croppyContext = await getCroppyContext(userId);

  let output = '📊 <b>croppy文脈デバッグ</b>\n\n';

  // jarvis_context
  output += '<b>[jarvis_context]</b>\n';
  output += '<pre>';
  output += croppyContext.context.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  output += '</pre>\n\n';

  // chat_history
  output += '<b>[chat_history] 直近10件</b>\n';
  output += '<pre>';
  output += croppyContext.history.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  output += '</pre>\n\n';

  // AI_MEMORY
  output += '<b>[AI_MEMORY]</b>\n';
  output += '<pre>';
  const memoryPreview = croppyContext.aiMemory.length > 500
    ? croppyContext.aiMemory.slice(0, 500) + '...'
    : croppyContext.aiMemory;
  output += memoryPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  output += '</pre>\n\n';

  // ステータス
  output += '<b>[status]</b>\n';
  output += `- context: ${croppyContext.context !== '（取得失敗）' ? 'OK' : 'ERROR'}\n`;
  output += `- history: ${croppyContext.history !== '（取得失敗）' ? 'OK' : 'ERROR'}\n`;
  output += `- ai_memory: ${croppyContext.aiMemory !== '（取得失敗）' ? 'OK' : 'ERROR'}\n`;

  if (croppyContext.error) {
    output += `\n⚠️ <b>Error:</b> ${croppyContext.error}`;
  }

  return output;
}
