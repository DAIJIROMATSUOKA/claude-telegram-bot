import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

mock.module("../../config", () => ({
  ALLOWED_USERS: [123456],
}));

mock.module("../../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
}));

mock.module("../../utils/typing", () => ({
  sendTyping: mock(() => {}),
}));

mock.module("../../constants", () => ({
  TG_MESSAGE_LIMIT: 4096,
}));

const mockAskClaude = mock(() => Promise.resolve({
  output: "Claude proposal", backend: "claude", emoji: "🧠", latency_ms: 100, error: null,
}));
const mockAskGemini = mock(() => Promise.resolve({
  output: "Gemini proposal", backend: "gemini", emoji: "🔮", latency_ms: 100, error: null,
}));
const mockAskChatGPT = mock(() => Promise.resolve({
  output: "ChatGPT proposal", backend: "chatgpt", emoji: "💬", latency_ms: 100, error: null,
}));

mock.module("../../utils/multi-ai", () => ({
  askClaude: mockAskClaude,
  askGemini: mockAskGemini,
  askChatGPT: mockAskChatGPT,
}));

mock.module("../../utils/web-search", () => ({
  maybeEnrichWithWebSearch: mock((topic: string) => Promise.resolve(topic)),
}));

// --- Import module under test ---
import { handleDebate, handleAskGPT, handleAskGemini } from "../council";

function makeMockCtx(opts: { text?: string; userId?: number; replyText?: string } = {}) {
  const userId = opts.userId ?? 123456;
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 999 },
    message: {
      text: opts.text || "/debate test topic",
      reply_to_message: opts.replyText ? { text: opts.replyText } : undefined,
    },
    reply: mock(() => Promise.resolve({ chat: { id: 999 }, message_id: 50 })),
    api: {
      editMessageText: mock(() => Promise.resolve()),
    },
  } as any;
}

beforeEach(() => {
  mockAskClaude.mockClear();
  mockAskGemini.mockClear();
  mockAskChatGPT.mockClear();
  mockAskClaude.mockImplementation(() => Promise.resolve({
    output: "Claude proposal", backend: "claude", emoji: "🧠", latency_ms: 100, error: null,
  }));
  mockAskGemini.mockImplementation(() => Promise.resolve({
    output: "Gemini proposal", backend: "gemini", emoji: "🔮", latency_ms: 100, error: null,
  }));
  mockAskChatGPT.mockImplementation(() => Promise.resolve({
    output: "ChatGPT proposal", backend: "chatgpt", emoji: "💬", latency_ms: 100, error: null,
  }));
});

// ── handleDebate: auth & usage (fast, no AI calls) ──

describe("handleDebate - auth", () => {
  test("rejects unauthorized users", async () => {
    const ctx = makeMockCtx({ userId: 999999, text: "/debate test" });
    await handleDebate(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Unauthorized.");
  });

  test("does not proceed for unauthorized user", async () => {
    const ctx = makeMockCtx({ userId: 999999, text: "/debate test" });
    await handleDebate(ctx);
    expect(mockAskClaude).not.toHaveBeenCalled();
  });
});

describe("handleDebate - usage", () => {
  test("shows usage when no topic provided", async () => {
    const ctx = makeMockCtx({ text: "/debate" });
    await handleDebate(ctx);
    const replyArg = ctx.reply.mock.calls[0]![0] as string;
    expect(replyArg).toContain("Usage:");
  });

  test("shows usage with HTML parse mode", async () => {
    const ctx = makeMockCtx({ text: "/debate" });
    await handleDebate(ctx);
    const callOpts = ctx.reply.mock.calls[0]![1] as any;
    expect(callOpts.parse_mode).toBe("HTML");
  });

  test("shows usage when only whitespace after command", async () => {
    const ctx = makeMockCtx({ text: "/debate   " });
    await handleDebate(ctx);
    const replyArg = ctx.reply.mock.calls[0]![0] as string;
    expect(replyArg).toContain("Usage:");
  });

  test("no AI calls when usage shown", async () => {
    const ctx = makeMockCtx({ text: "/debate" });
    await handleDebate(ctx);
    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(mockAskGemini).not.toHaveBeenCalled();
    expect(mockAskChatGPT).not.toHaveBeenCalled();
  });
});

// ── handleAskGPT ──

describe("handleAskGPT", () => {
  test("rejects unauthorized users", async () => {
    const ctx = makeMockCtx({ userId: 999, text: "/gpt hello" });
    await handleAskGPT(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Unauthorized.");
  });

  test("shows usage when no prompt", async () => {
    const ctx = makeMockCtx({ text: "/gpt" });
    await handleAskGPT(ctx);
    const replyArg = ctx.reply.mock.calls[0]![0] as string;
    expect(replyArg).toContain("Usage:");
  });

  test("calls ChatGPT and edits message", async () => {
    const ctx = makeMockCtx({ text: "/gpt what is AI?" });
    await handleAskGPT(ctx);
    expect(mockAskChatGPT).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  }, 15000);

  test("shows error response from AI", async () => {
    mockAskChatGPT.mockImplementation(() => Promise.resolve({
      output: "", backend: "chatgpt", emoji: "💬", latency_ms: 0, error: "rate limited" as any,
    }));
    const ctx = makeMockCtx({ text: "/gpt test" });
    await handleAskGPT(ctx);
    const editCall = ctx.api.editMessageText.mock.calls[0];
    if (editCall) {
      const text = editCall[2] as string;
      expect(text).toContain("rate limited");
    }
  }, 15000);

  test("handles thrown exception", async () => {
    mockAskChatGPT.mockImplementation(() => Promise.reject(new Error("crash")));
    const ctx = makeMockCtx({ text: "/gpt fail" });
    await handleAskGPT(ctx);
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  }, 15000);
});

// ── handleAskGemini ──

describe("handleAskGemini", () => {
  test("rejects unauthorized users", async () => {
    const ctx = makeMockCtx({ userId: 999, text: "/gem hello" });
    await handleAskGemini(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Unauthorized.");
  });

  test("shows usage when no prompt", async () => {
    const ctx = makeMockCtx({ text: "/gem" });
    await handleAskGemini(ctx);
    const replyArg = ctx.reply.mock.calls[0]![0] as string;
    expect(replyArg).toContain("Usage:");
  });

  test("calls Gemini and edits message", async () => {
    const ctx = makeMockCtx({ text: "/gem explain" });
    await handleAskGemini(ctx);
    expect(mockAskGemini).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  }, 15000);
});
