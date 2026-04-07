import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// --- Mocks (before importing module under test) ---

mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  }),
}));

mock.module("../../constants", () => ({
  DEFAULT_GATEWAY_URL: "https://test-gateway.example.com",
}));

// --- Import module under test ---
import { handleTaskAdd, handleTaskList, handleTaskCallback } from "../task-command";

// Mock globalThis.fetch directly (same approach as gateway-db.test.ts)
const mockFetch = mock(async () =>
  new Response(JSON.stringify({ ok: true }), { status: 200 })
);
const originalFetch = globalThis.fetch;

function makeCtx(
  text: string,
  opts: { callbackData?: string; chatId?: number; msgId?: number } = {}
) {
  const chatId = opts.chatId ?? 111;
  const msgId = opts.msgId ?? 200;
  return {
    from: { id: 123456 },
    message: { text, message_id: msgId },
    chat: { id: chatId },
    callbackQuery: opts.callbackData
      ? {
          data: opts.callbackData,
          message: {
            message_id: msgId,
            reply_markup: {
              inline_keyboard: [[{ text: "Task", callback_data: opts.callbackData }]],
            },
          },
        }
      : undefined,
    reply: mock(() =>
      Promise.resolve({ message_id: 300, chat: { id: chatId } })
    ),
    deleteMessage: mock(() => Promise.resolve()),
    answerCallbackQuery: mock(() => Promise.resolve()),
    api: {
      deleteMessage: mock(() => Promise.resolve()),
      editMessageReplyMarkup: mock(() => Promise.resolve()),
    },
  } as any;
}

function taskListResponse(tasks: any[] = []) {
  return new Response(JSON.stringify({ ok: true, tasks }), { status: 200 });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  globalThis.fetch = mockFetch as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("handleTaskAdd", () => {
  test("shows usage help when no title is provided", async () => {
    const ctx = makeCtx("/todo");

    await handleTaskAdd(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(replyText).toContain("/todo");
  });

  test("posts task to gateway and shows task list on success", async () => {
    mockFetch
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ ok: true, id: "task-1" }), { status: 200 })
      )
      .mockImplementationOnce(async () =>
        taskListResponse([
          { id: "task-1", title: "部品発注", category: "work", priority: "mid" },
        ])
      );

    const ctx = makeCtx("/todo 部品発注");

    await handleTaskAdd(ctx);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First fetch should be the task add POST
    const addCallUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
    expect(addCallUrl).toContain("/v1/tasks/add");
    const addBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(addBody.title).toBe("部品発注");
    expect(addBody.source).toBe("telegram");
  });

  test("parses due date flag from command text", async () => {
    mockFetch
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
      .mockImplementationOnce(async () => taskListResponse());

    const ctx = makeCtx("/todo 見積り提出 due:2026-05-01");

    await handleTaskAdd(ctx);

    const addBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(addBody.due_date).toBe("2026-05-01");
    expect(addBody.title).toBe("見積り提出");
  });

  test("parses priority flag from command text", async () => {
    mockFetch
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
      .mockImplementationOnce(async () => taskListResponse());

    const ctx = makeCtx("/todo キーエンス電話 p:high");

    await handleTaskAdd(ctx);

    const addBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(addBody.priority).toBe("high");
    expect(addBody.title).toBe("キーエンス電話");
  });

  test("replies with error message when gateway returns not-ok", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ ok: false, error: "DB write failed" }), { status: 200 })
    );

    const ctx = makeCtx("/todo Something");

    await handleTaskAdd(ctx);

    const replies = ctx.reply.mock.calls.map((c: any[]) => c[0] as string) as string[];
    const errorReply = replies.find((r: string) => r.includes("失敗") || r.includes("❌"));
    expect(errorReply).toBeDefined();
  });

  test("replies with error message on network failure", async () => {
    mockFetch.mockImplementationOnce(async () => {
      throw new Error("Network unreachable");
    });

    const ctx = makeCtx("/todo Something");

    await handleTaskAdd(ctx);

    const replies = ctx.reply.mock.calls.map((c: any[]) => c[0] as string) as string[];
    const errorReply = replies.find((r: string) => r.includes("エラー") || r.includes("❌"));
    expect(errorReply).toBeDefined();
  });
});

describe("handleTaskList", () => {
  test("shows categorized task list when tasks exist", async () => {
    mockFetch.mockImplementationOnce(async () =>
      taskListResponse([
        { id: "t1", title: "発注", category: "work", priority: "high" },
        { id: "t2", title: "電話", category: "work", priority: "low" },
        { id: "t3", title: "運動", category: "personal", priority: "mid" },
      ])
    );

    const ctx = makeCtx("/todos");

    await handleTaskList(ctx);

    expect(ctx.reply).toHaveBeenCalled();
  });

  test("shows empty message when no tasks are returned", async () => {
    mockFetch.mockImplementationOnce(async () => taskListResponse([]));

    const ctx = makeCtx("/todos");

    await handleTaskList(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(replyText).toContain("タスクなし");
  });
});

describe("handleTaskCallback", () => {
  test("returns false for non-task callback data", async () => {
    const ctx = makeCtx("", { callbackData: "inbox:done:123" });

    const result = await handleTaskCallback(ctx);

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns false for malformed task callback (too few parts)", async () => {
    const ctx = makeCtx("", { callbackData: "task:x" });

    const result = await handleTaskCallback(ctx);

    expect(result).toBe(false);
  });

  test("marks task done and answers callback query with success text", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const ctx = makeCtx("", {
      callbackData: "task:done:task-abc:work",
      chatId: 111,
      msgId: 200,
    });

    const result = await handleTaskCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "✅ 完了!" });

    const postUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
    expect(postUrl).toContain("/v1/tasks/done");
    const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(body.id).toBe("task-abc");
  });

  test("postpones task to tomorrow and answers callback query", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const ctx = makeCtx("", { callbackData: "task:postpone:task-xyz:work" });

    const result = await handleTaskCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("延期") })
    );
    const postUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
    expect(postUrl).toContain("/v1/tasks/update");
    const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(body.id).toBe("task-xyz");
    expect(body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("answers with error message on gateway failure", async () => {
    mockFetch.mockImplementationOnce(async () => {
      throw new Error("Gateway down");
    });

    const ctx = makeCtx("", { callbackData: "task:done:task-fail:work" });

    const result = await handleTaskCallback(ctx);

    expect(result).toBe(true); // handled, even if errored
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "❌ エラー" });
  });
});
