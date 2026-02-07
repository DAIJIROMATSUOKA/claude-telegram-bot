/**
 * Chat History Manager
 *
 * jarvis_chat_history テーブルへの保存・取得
 */

import { callMemoryGateway } from '../handlers/ai-router';
import { ulid } from 'ulidx';

/**
 * メッセージをchat_historyに保存
 *
 * @param userId Telegram user ID
 * @param role 'user' | 'assistant'
 * @param content メッセージ内容
 */
export async function saveChatMessage(
  userId: string | number,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  try {
    const id = ulid();
    const timestamp = new Date().toISOString();
    const userIdStr = String(userId);

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `INSERT INTO jarvis_chat_history (id, user_id, timestamp, role, content)
            VALUES (?, ?, ?, ?, ?)`,
      params: [id, userIdStr, timestamp, role, content],
    });

    console.log('[Chat History] 保存成功:', { role, length: content.length });
  } catch (error) {
    console.error('[Chat History] 保存失敗:', error);
    // 保存失敗は致命的ではないので処理継続
  }
}

/**
 * 直近N件の会話履歴を取得
 *
 * @param userId Telegram user ID
 * @param limit 取得件数（デフォルト10）
 * @returns 会話履歴（時系列順）
 */
export async function getChatHistory(
  userId: string | number,
  limit: number = 50
): Promise<Array<{ role: string; content: string; timestamp: string }>> {
  try {
    const userIdStr = String(userId);

    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT role, content, timestamp
            FROM jarvis_chat_history
            WHERE user_id = ?
            ORDER BY timestamp DESC
            LIMIT ?`,
      params: [userIdStr, limit],
    });

    if (response.error || !response.data?.results) {
      console.error('[Chat History] 取得失敗:', response.error);
      return [];
    }

    // 時系列順に並び替え（降順→昇順）
    const history = response.data.results.reverse();

    console.log('[Chat History] 取得成功:', { count: history.length });
    return history;
  } catch (error) {
    console.error('[Chat History] 取得エラー:', error);
    return [];
  }
}

/**
 * 30日以前の古い履歴を削除
 *
 * 日次バッチまたは保存時に実行
 */
export async function cleanupOldHistory(): Promise<void> {
  try {
    const response = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_chat_history
            WHERE created_at < datetime('now', '-30 days')`,
      params: [],
    });

    if (response.error) {
      console.error('[Chat History] 削除失敗:', response.error);
      return;
    }

    const deletedCount = response.data?.meta?.changes || 0;
    console.log('[Chat History] 30日以前のデータ削除:', { count: deletedCount });
  } catch (error) {
    console.error('[Chat History] 削除エラー:', error);
  }
}

/**
 * 会話履歴を整形してプロンプト用文字列に変換
 *
 * @param history 会話履歴
 * @returns プロンプト用の文字列
 */
export function formatChatHistoryForPrompt(
  history: Array<{ role: string; content: string; timestamp: string }>
): string {
  if (history.length === 0) {
    return '（会話履歴なし）';
  }

  return history
    .map((msg, idx) => {
      const roleLabel = msg.role === 'user' ? 'DJ' : 'Jarvis';
      // 長すぎる内容は省略（直近15件は2000文字、古いものは1000文字）
      const isRecent = idx >= history.length - 15;
      const maxLen = isRecent ? 2000 : 1000;
      const content = msg.content.length > maxLen
        ? msg.content.slice(0, maxLen) + '...'
        : msg.content;

      return `${idx + 1}. [${roleLabel}] ${content}`;
    })
    .join('\n');
}
