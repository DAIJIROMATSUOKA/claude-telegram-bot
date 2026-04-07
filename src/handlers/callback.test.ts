import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";
import * as streamingModule from "./streaming";
import * as gatewayDbModule from "../services/gateway-db";
import * as inboxTriageModule from "../services/inbox-triage";
import * as taskCommandModule from "./task-command";

// Mock all heavy dependencies before importing
mock.module("../session", () => ({
  session: {
    isRunning: false,
    isActive: false,
    stop: mock(() => Promise.resolve()),
    sendMessageStreaming: mock(() => Promise.resolve("response")),
    consumeInterruptFlag: mock(() => false),
    resumeSession: mock((id: string) => [true, `Resumed session ${id}`]),
  },
}));

mock.module("../config", () => ({
  ALLOWED_USERS: [123456],
}));

mock.module("../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
}));

mock.module("../utils", () => ({
  auditLog: mock(() => Promise.resolve()),
  startTypingIndicator: mock(() => ({ stop: mock(() => {}) })),
}));

const createStatusCallbackSpy = spyOn(streamingModule, "createStatusCallback").mockImplementation(
  () => mock(() => {})
);

const handleTriageCallbackSpy = spyOn(inboxTriageModule, "handleTriageCallback").mockImplementation(
  () => Promise.resolve(false)
);

const handleTaskCallbackSpy = spyOn(taskCommandModule, "handleTaskCallback").mockImplementation(
  () => Promise.resolve(false)
);

const gatewayQuerySpy = spyOn(gatewayDbModule, "gatewayQuery").mockImplementation(
  () => Promise.resolve()
);

import { handleCallback } from "./callback";

function makeMockCtx(callbackData: string, userId: number = 123456) {
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 100 },
    callbackQuery: {
      data: callbackData,
      message: { message_id: 42 },
    },
    reply: mock(() => Promise.resolve()),
    answerCallbackQuery: mock(() => Promise.resolve()),
    deleteMessage: mock(() => Promise.resolve()),
    editMessageText: mock(() => Promise.resolve()),
    editMessageReplyMarkup: mock(() => Promise.resolve()),
    api: {
      raw: { unpinChatMessage: mock(() => Promise.resolve()) },
      deleteMessage: mock(() => Promise.resolve()),
    },
  } as any;
}

describe("handleCallback", () => {
  test("ib:del:sys deletes message and answers callback", async () => {
    const ctx = makeMockCtx("ib:del:sys");
    await handleCallback(ctx);
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  test("missing userId/chatId/callbackData answers empty callback", async () => {
    const ctx = {
      from: undefined,
      chat: { id: 100 },
      callbackQuery: { data: "something" },
      answerCallbackQuery: mock(() => Promise.resolve()),
    } as any;
    await handleCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  test("unauthorized user gets 'Unauthorized' callback answer", async () => {
    const ctx = makeMockCtx("askuser:req1:0", 999);
    await handleCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Unauthorized" });
  });

  test("unknown callback data (not askuser) answers empty", async () => {
    const ctx = makeMockCtx("unknown:data");
    await handleCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  test("askuser with wrong parts count answers 'Invalid callback data'", async () => {
    const ctx = makeMockCtx("askuser:only_two");
    await handleCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Invalid callback data" });
  });

  test("tt_done updates timer and deletes message", async () => {
    const { gatewayQuery } = await import("../services/gateway-db");
    const ctx = makeMockCtx("tt_done:timer123");
    await handleCallback(ctx);
    expect(gatewayQuery).toHaveBeenCalled();
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "\u2705 Timer stopped" });
  });

  test("jn_done marks notification done and deletes message", async () => {
    const { gatewayQuery } = await import("../services/gateway-db");
    (gatewayQuery as any).mockClear();
    const ctx = makeMockCtx("jn_done:notif456");
    await handleCallback(ctx);
    expect(gatewayQuery).toHaveBeenCalled();
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "\u2705 完了" });
  });

  test("jn_stop removes buttons but keeps message", async () => {
    const ctx = makeMockCtx("jn_stop:notif789");
    await handleCallback(ctx);
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "\u23f8 スヌーズ停止" });
  });
});

afterAll(() => {
  createStatusCallbackSpy.mockRestore();
  gatewayQuerySpy.mockRestore();
  handleTriageCallbackSpy.mockRestore();
  handleTaskCallbackSpy.mockRestore();
});
