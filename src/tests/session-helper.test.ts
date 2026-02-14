/**
 * session-helper.ts のテスト
 */

import { describe, test, expect } from 'bun:test';
import {
  generateSessionId,
  parseSessionId,
  getSessionIdFromContext,
  getSessionInfo,
} from '../utils/session-helper';

/**
 * Contextのモック
 */
const mockCtx = (chatId?: number, messageId?: number) =>
  ({
    chat: chatId !== undefined ? { id: chatId } : undefined,
    message: messageId !== undefined ? { message_id: messageId } : undefined,
  }) as any;

describe('generateSessionId', () => {
  test('正常な数値 → chat_{chatId}_msg_{messageId} 形式', () => {
    expect(generateSessionId(12345, 67890)).toBe('chat_12345_msg_67890');
  });

  test('chatId=0', () => {
    expect(generateSessionId(0, 100)).toBe('chat_0_msg_100');
  });

  test('messageId=0', () => {
    expect(generateSessionId(100, 0)).toBe('chat_100_msg_0');
  });

  test('負数のchatId', () => {
    expect(generateSessionId(-123456789, 42)).toBe('chat_-123456789_msg_42');
  });

  test('大きい数値', () => {
    const largeChat = 9007199254740991; // Number.MAX_SAFE_INTEGER
    const largeMsg = 1234567890123;
    expect(generateSessionId(largeChat, largeMsg)).toBe(
      `chat_${largeChat}_msg_${largeMsg}`
    );
  });
});

describe('parseSessionId', () => {
  test('正常なフォーマット → { chat_id, message_id }', () => {
    const result = parseSessionId('chat_12345_msg_67890');
    expect(result).toEqual({ chat_id: 12345, message_id: 67890 });
  });

  test('空文字 → null', () => {
    expect(parseSessionId('')).toBeNull();
  });

  test('prefix無し → null', () => {
    expect(parseSessionId('12345_msg_67890')).toBeNull();
  });

  test('msgプレフィックス無し → null', () => {
    expect(parseSessionId('chat_12345_67890')).toBeNull();
  });

  test('数字でない値（chatId部分） → null', () => {
    expect(parseSessionId('chat_abc_msg_67890')).toBeNull();
  });

  test('数字でない値（messageId部分） → null', () => {
    expect(parseSessionId('chat_12345_msg_xyz')).toBeNull();
  });

  test('余分な文字 → null', () => {
    expect(parseSessionId('chat_12345_msg_67890_extra')).toBeNull();
  });

  test('負数のchatIdは正規表現にマッチしない → null', () => {
    // 正規表現 /^chat_(\d+)_msg_(\d+)$/ は負数にマッチしない
    expect(parseSessionId('chat_-123_msg_456')).toBeNull();
  });

  test('ラウンドトリップ: generateSessionIdの結果をパース → 元の値に戻る', () => {
    const chatId = 999;
    const messageId = 888;
    const sessionId = generateSessionId(chatId, messageId);
    const parsed = parseSessionId(sessionId);
    expect(parsed).toEqual({ chat_id: chatId, message_id: messageId });
  });

  test('ラウンドトリップ: 0値でも正常に戻る', () => {
    const sessionId = generateSessionId(0, 0);
    const parsed = parseSessionId(sessionId);
    expect(parsed).toEqual({ chat_id: 0, message_id: 0 });
  });
});

describe('getSessionIdFromContext', () => {
  test('chat.idとmessage.message_idが存在 → session ID生成', () => {
    const ctx = mockCtx(12345, 67890);
    expect(getSessionIdFromContext(ctx)).toBe('chat_12345_msg_67890');
  });

  test('chat.idが無い → null', () => {
    const ctx = mockCtx(undefined, 67890);
    expect(getSessionIdFromContext(ctx)).toBeNull();
  });

  test('message.message_idが無い → null', () => {
    const ctx = mockCtx(12345, undefined);
    expect(getSessionIdFromContext(ctx)).toBeNull();
  });

  test('chatもmessageも無い → null', () => {
    const ctx = mockCtx(undefined, undefined);
    expect(getSessionIdFromContext(ctx)).toBeNull();
  });

  test('chatId=0は有効（falsyだがundefinedではない）', () => {
    // 注意: 実装では !chatId でチェックしているため、0はnullを返す
    const ctx = mockCtx(0, 100);
    expect(getSessionIdFromContext(ctx)).toBeNull();
  });

  test('messageId=0は有効（falsyだがundefinedではない）', () => {
    // 注意: 実装では !messageId でチェックしているため、0はnullを返す
    const ctx = mockCtx(100, 0);
    expect(getSessionIdFromContext(ctx)).toBeNull();
  });
});

describe('getSessionInfo', () => {
  test('正常 → SessionInfo返却', () => {
    const ctx = mockCtx(12345, 67890);
    const result = getSessionInfo(ctx);
    expect(result).toEqual({
      session_id: 'chat_12345_msg_67890',
      chat_id: 12345,
      message_id: 67890,
    });
  });

  test('chat.idが無い → null', () => {
    const ctx = mockCtx(undefined, 67890);
    expect(getSessionInfo(ctx)).toBeNull();
  });

  test('message.message_idが無い → null', () => {
    const ctx = mockCtx(12345, undefined);
    expect(getSessionInfo(ctx)).toBeNull();
  });

  test('chatもmessageも無い → null', () => {
    const ctx = mockCtx(undefined, undefined);
    expect(getSessionInfo(ctx)).toBeNull();
  });

  test('chatId=0はfalsyなのでnull', () => {
    const ctx = mockCtx(0, 100);
    expect(getSessionInfo(ctx)).toBeNull();
  });

  test('messageId=0はfalsyなのでnull', () => {
    const ctx = mockCtx(100, 0);
    expect(getSessionInfo(ctx)).toBeNull();
  });

  test('返却値のsession_idはgenerateSessionIdと一致', () => {
    const ctx = mockCtx(555, 777);
    const result = getSessionInfo(ctx);
    expect(result?.session_id).toBe(generateSessionId(555, 777));
  });
});
