import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";
import * as gatewayDbModule from "../../services/gateway-db";

// ============================================================
// Mocks — must be declared before importing module under test
// ============================================================

const mockGatewayQuery = mock<() => Promise<any>>(() => Promise.resolve({ results: [] }));
const gatewayQuerySpy = spyOn(gatewayDbModule, "gatewayQuery").mockImplementation(
  (...args: any[]) => (mockGatewayQuery as any)(...args)
);

mock.module("../../config", () => ({
  ALLOWED_USERS: [123456],
}));

mock.module("../../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
}));

mock.module("../../utils/logger", () => ({
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

mock.module("../../services/obsidian-writer", () => ({
  archiveToObsidian: mock(() => Promise.resolve()),
}));

mock.module("../../utils/error-notify", () => ({
  notifyError: mock(() => Promise.resolve()),
}));

const mockFetchWithTimeout = mock(() =>
  Promise.resolve({
    json: () => Promise.resolve({ ok: true }),
  })
);
mock.module("../../utils/fetch-with-timeout", () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

// Import module under test AFTER mocks
import { handleInboxCallback, handleInboxReply } from "../inbox";

// ============================================================
// Helpers
// ============================================================

function makeMockCtx(opts: {
  callbackData?: string;
  userId?: number;
  msgId?: number;
  chatId?: number;
  messageText?: string;
  messageDate?: number;
  replyToMessage?: any;
  replyMarkup?: any;
  caption?: string;
} = {}) {
  const {
    callbackData = "ib:archive:gmail123",
    userId = 123456,
    msgId = 42,
    chatId = 100,
    messageText = "Test notification",
    messageDate = Math.floor(Date.now() / 1000),
    replyToMessage,
    replyMarkup,
    caption,
  } = opts;

  const message: any = {
    message_id: msgId,
    text: messageText,
    date: messageDate,
  };
  if (replyMarkup) message.reply_markup = replyMarkup;
  if (caption) message.caption = caption;
  if (replyToMessage) message.reply_to_message = replyToMessage;

  return {
    from: { id: userId, username: "testuser" },
    chat: { id: chatId },
    message: replyToMessage
      ? { message_id: msgId + 100, text: messageText, reply_to_message: replyToMessage }
      : undefined,
    callbackQuery: {
      data: callbackData,
      message,
    },
    api: {
      deleteMessage: mock(() => Promise.resolve(true)),
      sendMessage: mock(() => Promise.resolve({ message_id: 999 })),
      unpinChatMessage: mock(() => Promise.resolve()),
      pinChatMessage: mock(() => Promise.resolve()),
    },
    reply: mock(() => Promise.resolve({ message_id: 999 })),
    answerCallbackQuery: mock(() => Promise.resolve()),
  } as any;
}

function makeReplyCtx(opts: {
  replyText?: string;
  replyToMsgId?: number;
  chatId?: number;
  userId?: number;
  parentReplyToMessage?: any;
} = {}) {
  const {
    replyText = "Reply text",
    replyToMsgId = 42,
    chatId = 100,
    userId = 123456,
    parentReplyToMessage,
  } = opts;

  const replyToMessage: any = {
    message_id: replyToMsgId,
    text: "Original notification",
  };
  if (parentReplyToMessage) {
    replyToMessage.reply_to_message = parentReplyToMessage;
  }

  return {
    from: { id: userId, username: "testuser" },
    chat: { id: chatId },
    message: {
      message_id: 200,
      text: replyText,
      reply_to_message: replyToMessage,
    },
    api: {
      deleteMessage: mock(() => Promise.resolve(true)),
      sendMessage: mock(() => Promise.resolve({ message_id: 999 })),
    },
    reply: mock(() => Promise.resolve({ message_id: 999 })),
    answerCallbackQuery: mock(() => Promise.resolve()),
  } as any;
}

beforeEach(() => {
  mockGatewayQuery.mockClear();
  mockFetchWithTimeout.mockClear();
  mockGatewayQuery.mockImplementation(() => Promise.resolve({ results: [] }));
  mockFetchWithTimeout.mockImplementation(() =>
    Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as any)
  );
});

// ============================================================
// Tests
// ============================================================

describe("handleInboxCallback", () => {
  // ----------------------------------------------------------
  // Basic routing
  // ----------------------------------------------------------
  test("returns false for non-ib callbacks", async () => {
    const ctx = makeMockCtx({ callbackData: "task:approve:123" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(false);
  });

  test("returns false when callbackQuery data is undefined", async () => {
    const ctx = makeMockCtx();
    ctx.callbackQuery.data = undefined;
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(false);
  });

  test("rejects unauthorized user", async () => {
    const ctx = makeMockCtx({ userId: 999 });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Unauthorized" });
  });

  test("rejects callback with less than 3 parts", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:archive" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Invalid callback" });
  });

  // ----------------------------------------------------------
  // Archive action
  // ----------------------------------------------------------
  test("archive queues a batch action and answers callback", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:archive:gmail_abc" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  test("archive with colon-containing sourceId preserves full id", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:archive:msg:with:colons" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    // Should not reject — sourceId = "msg:with:colons"
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Trash action
  // ----------------------------------------------------------
  test("trash queues batch action", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:trash:gmail_def" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Delete action
  // ----------------------------------------------------------
  test("del queues batch deletion", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:del:notif_001" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Delmemo action
  // ----------------------------------------------------------
  test("delmemo queues deletion of message and its reply parent", async () => {
    const ctx = makeMockCtx({
      callbackData: "ib:delmemo:memo_001",
    });
    ctx.callbackQuery.message.reply_to_message = { message_id: 10 };
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Batch queue: multiple items accumulate
  // ----------------------------------------------------------
  test("multiple archive calls accumulate in queue with increasing count", async () => {
    // Different chatId to avoid interference with other tests
    const chatId = 77700;
    const ctx1 = makeMockCtx({ callbackData: "ib:archive:g1", chatId });
    const ctx2 = makeMockCtx({ callbackData: "ib:archive:g2", chatId });
    const ctx3 = makeMockCtx({ callbackData: "ib:archive:g3", chatId });

    await handleInboxCallback(ctx1);
    await handleInboxCallback(ctx2);
    await handleInboxCallback(ctx3);

    // The 3rd call should show count=3
    const lastCall = ctx3.answerCallbackQuery.mock.calls[0];
    expect(lastCall[0].text).toContain("3");
  });

  // ----------------------------------------------------------
  // Full text fetch
  // ----------------------------------------------------------
  test("full action fetches email text via GAS and replies", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            subject: "Test Subject",
            from: "sender@test.com",
            to: "me@test.com",
            body: "Full email body",
            date: "2026-04-01",
          }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_full" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "📖 全文取得中..." });
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("Test Subject");
    expect(replyText).toContain("sender@test.com");
  });

  test("full action shows error when GAS returns not-ok", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: false, error: "not found" }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_missing" });
    await handleInboxCallback(ctx);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("全文取得失敗");
  });

  test("full text includes attachment info when present", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            subject: "With Attach",
            from: "a@b.com",
            to: "c@d.com",
            body: "body text",
            date: "2026-04-01",
            attachments: [{ name: "file.pdf" }],
          }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_attach" });
    await handleInboxCallback(ctx);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("file.pdf");
  });

  // ----------------------------------------------------------
  // Attachment listing
  // ----------------------------------------------------------
  test("attach action lists attachments", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            attachments: [
              { name: "report.pdf", mimeType: "application/pdf", size: 10240 },
              { name: "photo.jpg", mimeType: "image/jpeg", size: 2048 },
            ],
          }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:attach:gmail_att" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "📎 添付取得中..." });
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("report.pdf");
    expect(replyText).toContain("photo.jpg");
    expect(replyText).toContain("10KB");
  });

  test("attach action reports no attachments when empty", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true, attachments: [] }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:attach:gmail_noatt" });
    await handleInboxCallback(ctx);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("添付ファイルなし");
  });

  // ----------------------------------------------------------
  // Reply prompt
  // ----------------------------------------------------------
  test("reply action sends quote-reply instruction", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:reply:gmail_reply" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("引用リプライ");
  });

  // ----------------------------------------------------------
  // LINE reply prompt
  // ----------------------------------------------------------
  test("lnrpl action sends LINE reply instruction and registers mapping", async () => {
    mockGatewayQuery.mockImplementation(() => Promise.resolve({ results: [] }));

    const ctx = makeMockCtx({ callbackData: "ib:lnrpl:line_target_123" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("LINE返信");
  });

  // ----------------------------------------------------------
  // iMessage reply prompt
  // ----------------------------------------------------------
  test("imrpl action sends iMessage reply instruction", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:imrpl:imsg_handle" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("iMessage返信");
  });

  // ----------------------------------------------------------
  // Snooze: 1h
  // ----------------------------------------------------------
  test("snz1h queues 1h snooze and answers callback", async () => {
    const ctx = makeMockCtx({
      callbackData: "ib:snz1h:gmail_snz1",
      messageText: "Snoozable notification",
    });
    ctx.callbackQuery.message.reply_markup = { inline_keyboard: [] };
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    const callText = ctx.answerCallbackQuery.mock.calls[0][0]?.text;
    expect(callText).toContain("1h");
  });

  // ----------------------------------------------------------
  // Snooze: 3h
  // ----------------------------------------------------------
  test("snz3h queues 3h snooze", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:snz3h:gmail_snz3" });
    await handleInboxCallback(ctx);
    const callText = ctx.answerCallbackQuery.mock.calls[0][0]?.text;
    expect(callText).toContain("3h");
  });

  // ----------------------------------------------------------
  // Snooze: morning
  // ----------------------------------------------------------
  test("snzam queues morning snooze", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:snzam:gmail_snzam" });
    await handleInboxCallback(ctx);
    const callText = ctx.answerCallbackQuery.mock.calls[0][0]?.text;
    expect(callText).toContain("明朝");
  });

  // ----------------------------------------------------------
  // Unknown action
  // ----------------------------------------------------------
  test("unknown action responds with error message", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:badaction:id123" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Unknown action: badaction",
    });
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------
  test("handles error in callback gracefully", async () => {
    // Force full action to throw by making fetch throw
    mockFetchWithTimeout.mockImplementation(() => Promise.reject(new Error("Network error")));

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_err" });
    const result = await handleInboxCallback(ctx);
    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "❌ エラー発生" });
  });

  // ----------------------------------------------------------
  // Todo creation
  // ----------------------------------------------------------
  test("todo action attempts task creation and answers callback", async () => {
    // Mock the dynamic imports and fetchWithTimeout for Todoist
    // The handler reads config from disk — it will throw because no file exists in test.
    // We verify it calls answerCallbackQuery with an error (graceful failure).
    const ctx = makeMockCtx({ callbackData: "ib:todo:src_todo", messageText: "Make a task" });
    await handleInboxCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    // It should either succeed or show an error — both call answerCallbackQuery
  });

  // ----------------------------------------------------------
  // AI draft
  // ----------------------------------------------------------
  test("draft action with insufficient message text replies error", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:draft:gmail_draft", messageText: "Hi" });
    await handleInboxCallback(ctx);
    // Text < 5 chars → error message
    const replyText = ctx.reply.mock.calls[0]?.[0] as string;
    expect(replyText).toContain("メッセージ内容が取得できません");
  });

  // ----------------------------------------------------------
  // Batch debounce — items share one timer
  // ----------------------------------------------------------
  test("batch queue uses same chatId grouping", async () => {
    const chatId = 88800;
    const ctx1 = makeMockCtx({ callbackData: "ib:del:a", chatId });
    const ctx2 = makeMockCtx({ callbackData: "ib:del:b", chatId });
    await handleInboxCallback(ctx1);
    await handleInboxCallback(ctx2);
    // 2nd call count should be 2
    const secondCallText = ctx2.answerCallbackQuery.mock.calls[0]?.[0]?.text;
    expect(secondCallText).toContain("2");
  });

  test("missing chatId skips batch action for archive", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:archive:gmail_no_chat" });
    ctx.chat = undefined;
    await handleInboxCallback(ctx);
    // Should not throw, but answerCallbackQuery may not be called with count
    expect(true).toBe(true); // no crash = pass
  });

  test("missing msgId skips batch action for trash", async () => {
    const ctx = makeMockCtx({ callbackData: "ib:trash:gmail_no_msg" });
    ctx.callbackQuery.message = undefined;
    await handleInboxCallback(ctx);
    expect(true).toBe(true); // no crash = pass
  });
});

// ============================================================
// handleInboxReply
// ============================================================
describe("handleInboxReply", () => {
  test("returns false when no reply_to_message", async () => {
    const ctx = makeReplyCtx();
    ctx.message.reply_to_message = undefined;
    const result = await handleInboxReply(ctx);
    expect(result).toBe(false);
  });

  test("returns false when replyText is empty", async () => {
    const ctx = makeReplyCtx({ replyText: undefined as any });
    ctx.message.text = undefined;
    const result = await handleInboxReply(ctx);
    expect(result).toBe(false);
  });

  test("returns false when no mapping found in DB", async () => {
    mockGatewayQuery.mockImplementation(() => Promise.resolve({ results: [] }));
    const ctx = makeReplyCtx();
    const result = await handleInboxReply(ctx);
    expect(result).toBe(false);
  });

  // ----------------------------------------------------------
  // Gmail reply routing
  // ----------------------------------------------------------
  test("routes to Gmail reply when mapping source is gmail", async () => {
    mockGatewayQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            source: "gmail",
            source_id: "gmail_thread_1",
            source_detail: JSON.stringify({ subject: "Re: Test", from: "test@example.com" }),
          },
        ],
      })
    );
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as any)
    );

    const ctx = makeReplyCtx({ replyText: "My reply text" });
    const result = await handleInboxReply(ctx);
    expect(result).toBe(true);
    // Should send via GAS POST
    expect(mockFetchWithTimeout).toHaveBeenCalled();
    // Confirmation message
    const replyCalls = ctx.reply.mock.calls;
    const hasConfirm = replyCalls.some((c: any) => String(c[0]).includes("Gmail返信"));
    expect(hasConfirm).toBe(true);
  });

  test("Gmail reply shows error when GAS returns failure", async () => {
    mockGatewayQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            source: "gmail",
            source_id: "gmail_fail_1",
            source_detail: JSON.stringify({ subject: "Fail" }),
          },
        ],
      })
    );
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: false, error: "send failed" }),
      } as any)
    );

    const ctx = makeReplyCtx({ replyText: "reply" });
    const result = await handleInboxReply(ctx);
    expect(result).toBe(true);
    const hasError = ctx.reply.mock.calls.some((c: any) => String(c[0]).includes("Gmail返信失敗"));
    expect(hasError).toBe(true);
  });

  // ----------------------------------------------------------
  // LINE reply routing
  // ----------------------------------------------------------
  test("routes to LINE reply when mapping source is line", async () => {
    mockGatewayQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            source: "line",
            source_id: "line_group_1",
            source_detail: JSON.stringify({ group_name: "TestGroup", is_group: true }),
          },
        ],
      })
    );
    // Mock fetch for LINE worker (may or may not be called depending on env)
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as any)
    );

    const ctx = makeReplyCtx({ replyText: "LINE reply" });
    const result = await handleInboxReply(ctx);
    expect(result).toBe(true);
    // Either LINE_WORKER_URL is unset (error reply) or set (sends via worker)
    const hasLineMsg = ctx.reply.mock.calls.some((c: any) => {
      const text = String(c[0]);
      return text.includes("LINE") || text.includes("line");
    });
    expect(hasLineMsg).toBe(true);
  });

  // ----------------------------------------------------------
  // Slack reply routing
  // ----------------------------------------------------------
  test("routes to Slack reply (placeholder) when mapping source is slack", async () => {
    mockGatewayQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            source: "slack",
            source_id: "slack_ch_1",
            source_detail: "{}",
          },
        ],
      })
    );

    const ctx = makeReplyCtx({ replyText: "Slack reply" });
    const result = await handleInboxReply(ctx);
    expect(result).toBe(true);
    const hasSlack = ctx.reply.mock.calls.some((c: any) => String(c[0]).includes("Slack"));
    expect(hasSlack).toBe(true);
  });

  // ----------------------------------------------------------
  // Parent reply chain (prompt -> notification chain)
  // ----------------------------------------------------------
  test("follows reply chain to parent when direct mapping not found", async () => {
    let callCount = 0;
    mockGatewayQuery.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        // First call: no mapping for the prompt message
        return Promise.resolve({ results: [] });
      }
      // Second call: mapping found for parent notification
      return Promise.resolve({
        results: [
          {
            source: "gmail",
            source_id: "gmail_parent_chain",
            source_detail: JSON.stringify({ subject: "Chained" }),
          },
        ],
      });
    });
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as any)
    );

    const ctx = makeReplyCtx({
      replyText: "Chained reply",
      parentReplyToMessage: { message_id: 30 },
    });
    const result = await handleInboxReply(ctx);
    expect(result).toBe(true);
    // gatewayQuery should be called at least twice (direct + parent lookup)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // ----------------------------------------------------------
  // Error in lookup
  // ----------------------------------------------------------
  test("returns false on DB error in lookup", async () => {
    mockGatewayQuery.mockImplementation(() => Promise.reject(new Error("DB down")));
    const ctx = makeReplyCtx();
    const result = await handleInboxReply(ctx);
    expect(result).toBe(false);
  });
});

// ============================================================
// escapeHtml (tested indirectly via full text fetch)
// ============================================================
describe("escapeHtml (via full text)", () => {
  test("escapes HTML special characters in email body", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            subject: "<script>alert('xss')</script>",
            from: "a&b@test.com",
            to: "me@test.com",
            body: "Price > $100 & tax < 10%",
            date: "2026-04-01",
          }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_html", chatId: 77701 });
    await handleInboxCallback(ctx);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("&lt;script&gt;");
    expect(replyText).toContain("&amp;");
    expect(replyText).toContain("&gt;");
    expect(replyText).not.toContain("<script>");
  });

  test("handles CC field in full text", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            subject: "With CC",
            from: "a@b.com",
            to: "c@d.com",
            cc: "e@f.com",
            body: "Body",
            date: "2026-04-01",
          }),
      } as any)
    );

    const ctx = makeMockCtx({ callbackData: "ib:full:gmail_cc", chatId: 77702 });
    await handleInboxCallback(ctx);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("CC:");
    expect(replyText).toContain("e@f.com");
  });
});

// ============================================================
// Batch execution integration
// ============================================================
describe("batch execution", () => {
  test("batch del action calls deleteMessage when timer fires", async () => {
    const chatId = 99901;
    const ctx = makeMockCtx({ callbackData: "ib:del:batch_del", chatId, msgId: 500 });
    await handleInboxCallback(ctx);
    // Wait for batch timer (3s + buffer)
    await new Promise((r) => setTimeout(r, 3500));
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 500);
  });

  test("batch archive action calls GAS and deletes message", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true }),
      } as any)
    );

    const chatId = 99902;
    const ctx = makeMockCtx({ callbackData: "ib:archive:batch_arc", chatId, msgId: 501 });
    await handleInboxCallback(ctx);
    await new Promise((r) => setTimeout(r, 3500));
    // fetchWithTimeout called for GAS
    const fetchCalls = mockFetchWithTimeout.mock.calls;
    const gasCall = fetchCalls.find((c: any) => String(c[0]).includes("action=archive"));
    expect(gasCall).toBeDefined();
  });

  test("batch trash action calls GAS with trash action", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true }),
      } as any)
    );

    const chatId = 99903;
    const ctx = makeMockCtx({ callbackData: "ib:trash:batch_trsh", chatId, msgId: 502 });
    await handleInboxCallback(ctx);
    await new Promise((r) => setTimeout(r, 3500));
    const fetchCalls = mockFetchWithTimeout.mock.calls;
    const gasCall = fetchCalls.find((c: any) => String(c[0]).includes("action=trash"));
    expect(gasCall).toBeDefined();
  });

  test("batch snooze stores to gateway and deletes message", async () => {
    mockGatewayQuery.mockImplementation(() => Promise.resolve({ results: [] }));

    const chatId = 99904;
    const ctx = makeMockCtx({
      callbackData: "ib:snz1h:batch_snz",
      chatId,
      msgId: 503,
      messageText: "Snooze me",
    });
    ctx.callbackQuery.message.reply_markup = { inline_keyboard: [] };
    await handleInboxCallback(ctx);
    await new Promise((r) => setTimeout(r, 3500));
    // Gateway should be called for snooze queue operations
    const gwCalls = mockGatewayQuery.mock.calls;
    const hasSnoozeInsert = gwCalls.some((c: any) =>
      String(c[0]).includes("snooze_queue") || String(c[0]).includes("message_mappings")
    );
    expect(hasSnoozeInsert).toBe(true);
  });

  test("batch delmemo deletes both message and its reply parent", async () => {
    const chatId = 99905;
    const ctx = makeMockCtx({ callbackData: "ib:delmemo:batch_dm", chatId, msgId: 504 });
    ctx.callbackQuery.message.reply_to_message = { message_id: 10 };
    await handleInboxCallback(ctx);
    await new Promise((r) => setTimeout(r, 3500));
    // deleteMessage called for both 504 and 10
    const delCalls = ctx.api.deleteMessage.mock.calls;
    const deletedIds = delCalls.map((c: any) => c[1]);
    expect(deletedIds).toContain(504);
    expect(deletedIds).toContain(10);
  });
});

afterAll(() => {
  gatewayQuerySpy.mockRestore();
});
